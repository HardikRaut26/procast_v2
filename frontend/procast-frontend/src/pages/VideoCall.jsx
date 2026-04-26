import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import AgoraRTC from "agora-rtc-sdk-ng";
import { AGORA_APP_ID } from "../utils/agoraConfig";
import { getAgoraToken } from "../api/agora";
import { uploadChunkToBackend } from "../api/upload";
import api from "../api/axios";

import {
  startSession,
  joinSession,
  leaveSession,
  stopSession,
  getSession,
} from "../api/session";

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

/** Dedupe invite-link auto-join across React Strict Mode remounts */
const autoJoinOnceBySession = new Map();

/* ─── Auto-detect camera quality ─────────────────────────────────────────── */

/**
 * Resolution tiers ordered from highest to lowest.
 * The detector picks the best tier that fits the camera's actual output.
 */
const QUALITY_TIERS = [
  { label: "4K",    width: 3840, height: 2160, bitrateMin: 8000,  bitrateMax: 15000 },
  { label: "1440p", width: 2560, height: 1440, bitrateMin: 6000,  bitrateMax: 10000 },
  { label: "1080p", width: 1920, height: 1080, bitrateMin: 4000,  bitrateMax: 6000  },
  { label: "720p",  width: 1280, height: 720,  bitrateMin: 2500,  bitrateMax: 4000  },
  { label: "480p",  width: 854,  height: 480,  bitrateMin: 800,   bitrateMax: 1500  },
  { label: "360p",  width: 640,  height: 360,  bitrateMin: 400,   bitrateMax: 800   },
];

/**
 * One single getUserMedia probe — ask for the maximum, then read what the
 * browser actually negotiated with the camera. Maps the result to the best
 * matching quality tier. This avoids multiple open/close cycles that cause
 * the camera LED to flash repeatedly.
 */
async function detectBestEncoderConfig() {
  try {
    // Single probe: request the highest possible — browser will clamp to the camera's real max
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:     { ideal: 3840 },
        height:    { ideal: 2160 },
        frameRate: { ideal: 120 },
      },
    });

    const track    = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    // Release the probe stream immediately
    stream.getTracks().forEach((t) => t.stop());

    const actualW   = settings?.width     ?? 640;
    const actualH   = settings?.height    ?? 360;
    const actualFps = Math.round(settings?.frameRate ?? 30);

    // Find the best tier the camera can handle (≥80 % of tier resolution)
    const tier = QUALITY_TIERS.find(
      (t) => actualW >= t.width * 0.8 && actualH >= t.height * 0.8
    ) || QUALITY_TIERS[QUALITY_TIERS.length - 1]; // fallback to 360p

    // Cap FPS at 60 for WebRTC
    const frameRate = Math.min(actualFps, 60);

    // Scale bitrate for high frame rates (60 fps ≈ 1.5× bandwidth of 30 fps)
    const fpsFactor  = frameRate > 30 ? frameRate / 30 : 1;
    const bitrateMin = Math.round(tier.bitrateMin * fpsFactor);
    const bitrateMax = Math.round(tier.bitrateMax * fpsFactor);

    console.log(
      `[VideoCall] Camera detected: ${actualW}×${actualH} @ ${actualFps}fps → using ${tier.label} @ ${frameRate}fps`
    );

    return {
      width:  tier.width,
      height: tier.height,
      frameRate,
      bitrateMin,
      bitrateMax,
    };
  } catch (err) {
    console.warn("[VideoCall] Camera probe failed:", err.message, "— using Agora default");
    return "480p_1";
  }
}

/* ─── End auto-detect ────────────────────────────────────────────────────── */

/** Extract meeting selector from URL/query/raw value (Mongo id or 5-digit meeting code) */
function parseSessionIdFromInput(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const id = u.searchParams.get("sessionId");
    if (id) return id.trim();
  } catch {
    const m = s.match(/[?&]sessionId=([^&]+)/i);
    if (m) {
      try {
        return decodeURIComponent(m[1].trim());
      } catch {
        return m[1].trim();
      }
    }
  }
  if (/^[a-f0-9]{24}$/i.test(s)) return s;
  if (/^\d{5}$/.test(s)) return s;
  return null;
}

const getGridColumns = (count) => {
  if (count === 1) return "1fr";
  if (count === 2) return "repeat(2, 1fr)";
  if (count === 3) return "repeat(3, 1fr)";
  if (count === 4) return "repeat(2, 1fr)";
  return "repeat(3, 1fr)";
};

const keyframes = `
  @keyframes videoFadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.7} }

  .pc-ctrl-btn { position:relative; outline:none; transition:background .15s,transform .15s; }
  .pc-ctrl-btn:hover { transform:scale(1.06)!important; }
  .pc-ctrl-btn:active { transform:scale(.95)!important; }
  .pc-ctrl-btn::after {
    content:attr(data-tip); position:absolute; bottom:calc(100% + 8px); left:50%;
    transform:translateX(-50%) translateY(3px); padding:5px 10px; border-radius:4px;
    background:#303134; color:#e8eaed; font-size:12px; font-weight:500;
    white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .12s,transform .12s; z-index:300;
  }
  .pc-ctrl-btn:hover::after { opacity:1; transform:translateX(-50%) translateY(0); }
  .pc-ctrl-danger:hover { background:#c5221f!important; }
  .pc-ctrl-divider { width:1px; height:24px; background:rgba(255,255,255,.1); margin:0 6px; }

  .video-tile video,.video-tile canvas,#local-player video,#local-player canvas {
    width:100%!important; height:100%!important; object-fit:cover!important; display:block!important;
  }
  #local-player { position:absolute; inset:0; }
`;

function VideoCall() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const existingSessionId = searchParams.get("sessionId");
  const isHost = !existingSessionId;

  const [sessionId, setSessionId] = useState(existingSessionId);
  /** Session id that was in the URL on first paint (invite links only; not manual join field) */
  const [sessionIdFromInitialUrl] = useState(() => searchParams.get("sessionId"));
  const [joinCode, setJoinCode] = useState("");
  const [meetingCode, setMeetingCode] = useState(null);
  const [joined, setJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  /** Which control started the current join (for button labels only) */
  const [pendingAction, setPendingAction] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [callDuration, setCallDuration] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showMeetingEndedModal, setShowMeetingEndedModal] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [agoraUidMapping, setAgoraUidMapping] = useState({});
  const [userProfile, setUserProfile] = useState(null);

  const shareMenuRef = useRef(null);
  const audioTrackRef = useRef(null);
  const videoTrackRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunkIndexRef = useRef(0);
  /** Wall-clock ms for `new Date(session.startTime)` — used for per-chunk `startTimeMs` on the server */
  const meetingEpochMsRef = useRef(null);
  /** ms from meeting start when recording began (chunk 1 ≈ this + 0–5s window) */
  const recordingOffsetMsRef = useRef(null);

  const lastRecordingStateRef = useRef(null);
  const lastSessionStatusRef = useRef(null);

  /** Track all remote users and their media state: Map<uid, { uid, hasVideo, hasAudio, videoTrack, audioTrack }> */
  const remoteUsersRef = useRef(new Map());

  // Fetch current user profile (for camera-off avatar)
  useEffect(() => {
    api.get("/auth/me")
      .then((res) => setUserProfile(res.data.user || null))
      .catch(() => {});
  }, []);

  const userInitials = userProfile?.name
    ? userProfile.name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join("")
    : "?";

  /**
   * @param {{ forceCreate?: boolean; sessionIdOverride?: string | null }} [opts]
   * @returns {Promise<boolean>}
   */
  const joinChannel = async (opts = {}) => {
    let activeSessionId =
      opts.sessionIdOverride ?? sessionId ?? existingSessionId ?? null;

    setJoinError("");
    setIsJoining(true);
    console.log("[VideoCall] joinChannel", {
      forceCreate: !!opts.forceCreate,
      existingSessionId: existingSessionId || null,
      initialSessionId: sessionId || null,
      activeSessionId: activeSessionId || null,
    });

    try {
      if (opts.forceCreate) {
        console.log("[VideoCall] Creating new session…");
        const session = await startSession();
        activeSessionId = session._id;
        setSessionId(activeSessionId);
        setMeetingCode(session.meetingCode || null);
        console.log("[VideoCall] Session created", {
          sessionId: activeSessionId,
          meetingCode: session.meetingCode || null,
          channelName: session.channelName,
        });
      }

      if (!activeSessionId) {
        setJoinError(
          "Add a meeting link or ID to join, or create a new meeting."
        );
        return false;
      }

      console.log("[VideoCall] Joining backend session record…", {
        sessionId: activeSessionId,
      });
      const joinRes = await joinSession(activeSessionId);
      const canonicalFromJoin = joinRes?.sessionId ? String(joinRes.sessionId) : null;

      const meta = await getSession(activeSessionId);
      const channelName = meta?.channelName;
      if (!channelName) {
        throw new Error("Session has no Agora channel — cannot join call.");
      }
      const canonicalSessionId = meta?._id
        ? String(meta._id)
        : canonicalFromJoin || String(activeSessionId);
      setSessionId(canonicalSessionId);
      setMeetingCode(meta?.meetingCode || joinRes?.meetingCode || null);
      const st = meta?.startTime;
      meetingEpochMsRef.current = st ? new Date(st).getTime() : Date.now();

      const token = await getAgoraToken(channelName);
      console.log("[VideoCall] Agora token fetched");
      await client.join(AGORA_APP_ID, channelName, token, null);
      console.log("[VideoCall] Agora joined", { channelName });

      const mic = await AgoraRTC.createMicrophoneAudioTrack();

      // Auto-detect camera capabilities and pick the best quality tier
      const encoderConfig = await detectBestEncoderConfig();
      console.log("[VideoCall] Using encoder config:", encoderConfig);
      const cam = await AgoraRTC.createCameraVideoTrack({ encoderConfig });

      await client.publish([mic, cam]);
      audioTrackRef.current = mic;
      videoTrackRef.current = cam;
      console.log("[VideoCall] Published mic+cam tracks");

      // Register this client's Agora UID with the backend so others can identify us
      try {
        const localUserInfo = client.uid;
        if (localUserInfo && activeSessionId) {
          await api.post(`/sessions/${activeSessionId}/register-agora-uid`, {
            agoraUid: String(localUserInfo),
          });
          console.log("[VideoCall] Registered Agora UID", { agoraUid: localUserInfo });

          // Immediately fetch the updated mapping so our UID is known
          try {
            const mapRes = await api.get(`/sessions/${activeSessionId}/agora-uid-mapping`);
            if (mapRes.data.mapping) {
              setAgoraUidMapping(mapRes.data.mapping);
              console.log("[VideoCall] Fetched initial Agora UID mapping after registration:", mapRes.data.mapping);
            }
          } catch (mapErr) {
            console.warn("[VideoCall] Failed to fetch initial mapping", mapErr.message);
          }
        }
      } catch (err) {
        console.warn("[VideoCall] Failed to register Agora UID", err.message);
      }

      setJoined(true);
      console.log("[VideoCall] UI setJoined(true)");
      return true;
    } catch (err) {
      console.error("Join failed", err);
      console.error("[VideoCall] joinChannel error", {
        message: err?.message,
        response: err?.response?.data,
      });
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Could not join the call. Check your connection and try again.";
      setJoinError(msg);
      setJoined(false);
      return false;
    } finally {
      setIsJoining(false);
    }
  };

  const createMeeting = async () => {
    setJoinCode("");
    navigate("/call", { replace: true });
    setSessionId(null);
    setMeetingCode(null);
    setPendingAction("create");
    try {
      await joinChannel({ forceCreate: true });
    } finally {
      setPendingAction(null);
    }
  };

  const joinWithInviteCode = async () => {
    const parsed = parseSessionIdFromInput(joinCode);
    if (!parsed) {
      setJoinError("Paste a valid invite link or meeting ID.");
      return;
    }
    setJoinError("");
    setSessionId(parsed);
    setMeetingCode(null);
    setSearchParams({ sessionId: parsed }, { replace: true });
    setPendingAction("join");
    try {
      const ok = await joinChannel({ sessionIdOverride: parsed });
      if (ok) setJoinCode("");
    } finally {
      setPendingAction(null);
    }
  };

  // Invite link: auto-join only when user opened the page with ?sessionId= (not after pasting in the form)
  useEffect(() => {
    if (joined || !existingSessionId) return;
    if (existingSessionId !== sessionIdFromInitialUrl) return;
    if (autoJoinOnceBySession.get(existingSessionId)) return;
    autoJoinOnceBySession.set(existingSessionId, true);
    void joinChannel({ sessionIdOverride: existingSessionId }).then((ok) => {
      if (!ok) autoJoinOnceBySession.delete(existingSessionId);
    });
  }, [existingSessionId, joined, sessionIdFromInitialUrl]);

  useEffect(() => {
    console.log("[VideoCall] joined state changed", {
      joined,
      isHost,
      sessionId,
    });
  }, [joined]);

  useEffect(() => {
    console.log("[VideoCall] recording UI state changed", {
      isRecording,
      isHost,
      sessionId,
    });
  }, [isRecording]);

  useEffect(() => {
    if (!showShareMenu) return;
    const onDown = (e) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target)) {
        setShowShareMenu(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setShowShareMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showShareMenu]);

  // Play local video after DOM is ready (local-player must exist)
  useEffect(() => {
    if (!joined || !videoTrackRef.current) return;
    const playLocal = () => {
      try {
        const el = document.getElementById("local-player");
        if (el && videoTrackRef.current) videoTrackRef.current.play("local-player");
      } catch (e) {
        console.warn("Local video play failed", e);
      }
    };
    const el = document.getElementById("local-player");
    if (el && el.offsetWidth > 0) {
      playLocal();
    } else {
      const t = setTimeout(playLocal, 100);
      return () => clearTimeout(t);
    }
  }, [joined]);

  const toggleMic = async () => {
    const track = audioTrackRef.current;
    if (!track) return;
    const nextMuted = !micMuted;
    try {
      // setMuted keeps the mic capturing (sends silence); setEnabled stops capture and can
      // briefly disturb the browser media pipeline / local video on some systems.
      await track.setMuted(nextMuted);
      setMicMuted(nextMuted);
    } catch (e) {
      console.warn("[VideoCall] toggleMic failed", e);
    }
  };

  const toggleVideo = () => {
    if (videoTrackRef.current) {
      videoTrackRef.current.setEnabled(videoOff);
      setVideoOff(!videoOff);
    }
  };

  const startRecording = async () => {
    if (!audioTrackRef.current || !videoTrackRef.current || !sessionId) {
      console.warn("[VideoCall] startRecording: recording not ready", {
        hasAudio: !!audioTrackRef.current,
        hasVideo: !!videoTrackRef.current,
        sessionId,
      });
      alert("Recording not ready");
      return;
    }
    if (mediaRecorderRef.current) return;

    console.log("[VideoCall] startRecording clicked/triggered", {
      isHost,
      sessionId,
    });

    if (isHost) {
      console.log("[VideoCall] broadcasting recording START…", { sessionId });
      await api.post("/sessions/broadcast-recording", {
        sessionId,
        action: "START",
      });
      console.log("[VideoCall] broadcast START done", { sessionId });
    }

    const stream = new MediaStream([
      audioTrackRef.current.getMediaStreamTrack(),
      videoTrackRef.current.getMediaStreamTrack(),
    ]);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm; codecs=vp8,opus",
    });
    recorder.onstart = () => {
      console.log("[VideoCall] MediaRecorder onstart", { sessionId });
    };
    recorder.onstop = () => {
      console.log("[VideoCall] MediaRecorder onstop", { sessionId });
    };
    recorder.onerror = (e) => {
      console.error("[VideoCall] MediaRecorder error", { sessionId, e });
    };
    recorder.onwarning = (e) => {
      console.warn("[VideoCall] MediaRecorder warning", { sessionId, e });
    };
    chunkIndexRef.current = 0;
    // Recording starts now; relative offset is 0. Chunks are timestamped relative to THIS recording start.
    // The server/transcription service will use alignment to map to the final merged video timeline.
    recordingOffsetMsRef.current = 0;

    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      chunkIndexRef.current += 1;
      const currentChunkIndex = chunkIndexRef.current;
      console.log("[VideoCall] chunk dataavailable", {
        sessionId,
        chunkIndex: currentChunkIndex,
        bytes: e.data.size,
      });
      try {
        const sliceMs = 5000;
        const base =
          recordingOffsetMsRef.current != null &&
          Number.isFinite(recordingOffsetMsRef.current)
            ? recordingOffsetMsRef.current
            : 0;
        const chunkStartMs = Math.max(0, base + (currentChunkIndex - 1) * sliceMs);
        await uploadChunkToBackend({
          file: e.data,
          sessionId,
          chunkIndex: currentChunkIndex,
          chunkStartMs,
        });
        console.log("[VideoCall] chunk upload success", {
          sessionId,
          chunkIndex: currentChunkIndex,
        });
      } catch (err) {
        console.error("[VideoCall] chunk upload failed", {
          sessionId,
          chunkIndex: currentChunkIndex,
          message: err?.message,
          response: err?.response?.data,
        });
      }
    };

    recorder.start(5000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    console.log("[VideoCall] MediaRecorder started", { sessionId });
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
    if (isHost) {
      console.log("[VideoCall] broadcasting recording STOP…", { sessionId });
      await api.post("/sessions/broadcast-recording", {
        sessionId,
        action: "STOP",
      });
      console.log("[VideoCall] broadcast STOP done", { sessionId });
    }
  };

  const leaveChannel = async () => {
    try {
      console.log("[VideoCall] leaveChannel clicked", {
        isHost,
        sessionId,
      });
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        setIsRecording(false);
      }
      const sidLeaving = sessionId;
      if (sidLeaving) {
        try {
          if (isHost) {
            await stopSession(sidLeaving);
          } else {
            await leaveSession(sidLeaving);
          }
        } catch (e) {
          console.warn("Session leave/stop failed", e);
        }
        autoJoinOnceBySession.delete(sidLeaving);
      }
      await client.leave();
      audioTrackRef.current?.close();
      videoTrackRef.current?.close();
      audioTrackRef.current = null;
      videoTrackRef.current = null;
      setJoined(false);
      setJoinError("");
      setSessionId(null);
      setMeetingCode(null);
      navigate("/call", { replace: true });
      chunkIndexRef.current = 0;
      meetingEpochMsRef.current = null;
      recordingOffsetMsRef.current = null;
      lastRecordingStateRef.current = null;
      lastSessionStatusRef.current = null;
      remoteUsersRef.current.clear();
    } catch (err) {
      console.error("Leave failed", err);
      setJoined(false);
    }
  };

  useEffect(() => {
    if (!sessionId || !joined) return;

    // Fetch participants list and Agora UID mapping when joined
    const fetchParticipantData = async () => {
      try {
        // Fetch participants
        const res = await api.get(`/sessions/${sessionId}/participants`);
        if (res.data.participants) {
          setParticipants(res.data.participants);
          console.log("[VideoCall] Loaded participants:", res.data.participants);
        }

        // Fetch Agora UID to user mapping
        const mapRes = await api.get(`/sessions/${sessionId}/agora-uid-mapping`);
        if (mapRes.data.mapping) {
          console.log("[VideoCall] Mapping response from server:", mapRes.data.mapping);
          setAgoraUidMapping(mapRes.data.mapping);
          console.log("[VideoCall] Loaded Agora UID mapping - keys:", Object.keys(mapRes.data.mapping), "data:", mapRes.data.mapping);

          // Update any placeholder tiles with the new mapping
          updatePlaceholdersWithMapping(mapRes.data.mapping);
        } else {
          console.warn("[VideoCall] No mapping data in response", mapRes.data);
        }
      } catch (err) {
        console.error("Failed to fetch participant data:", err.message, err.response?.data);
      }
    };

    // Fetch immediately on join
    fetchParticipantData();
    // Then fetch every 2 seconds (instead of 5) to get updates faster
    const interval = setInterval(fetchParticipantData, 2000);
    return () => clearInterval(interval);
  }, [sessionId, joined]);

  // When mapping is updated, refresh all placeholder tiles with real user info
  useEffect(() => {
    if (!agoraUidMapping || Object.keys(agoraUidMapping).length === 0) return;

    console.log("[VideoCall] agoraUidMapping updated, refreshing placeholders:", agoraUidMapping);
    updatePlaceholdersWithMapping(agoraUidMapping);
  }, [agoraUidMapping]);

  /**
   * Update placeholders that are showing with real user info from mapping
   */
  const updatePlaceholdersWithMapping = (mapping) => {
    if (!mapping || Object.keys(mapping).length === 0) {
      console.log("[VideoCall] No mapping available to update placeholders");
      return;
    }

    console.log("[VideoCall] updatePlaceholdersWithMapping called with", Object.keys(mapping).length, "users");

    for (const [agoraUid, userData] of Object.entries(mapping)) {
      const div = document.getElementById(`remote-${agoraUid}`);
      console.log("[VideoCall] Checking tile for UID", agoraUid, "- tile exists:", !!div, "userData:", userData);

      if (div) {
        const hasVideo = !!div.querySelector("video");
        console.log("[VideoCall] Tile for", agoraUid, "has video:", hasVideo);

        if (!hasVideo) {
          // This tile has no video (is a placeholder)
          const userInfo = { name: userData.name, profilePhoto: userData.profilePhoto };
          console.log("[VideoCall] Updating placeholder for", agoraUid, 'with user:', userData.name);
          renderCameraOffPlaceholder(div, userInfo);
        }
      }
    }
  };

  useEffect(() => {
    if (!sessionId || !joined || isHost) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/sessions/recording-state/${sessionId}`);
        const state = res.data.state;
        if (state !== lastRecordingStateRef.current) {
          console.log("[VideoCall] participant recordingState changed", {
            sessionId,
            state,
          });
          lastRecordingStateRef.current = state;
        }
        if (state === "START" && !mediaRecorderRef.current) startRecording();
        if (state === "STOP" && mediaRecorderRef.current) stopRecording();
      } catch (err) {
        console.warn("Recording poll failed", err.message);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId, joined]);

  // When host ends meeting, show modal and leave for everyone
  useEffect(() => {
    if (!sessionId || !joined || isHost) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}`);
        const status = res.data.session?.status;

        if (status === "ENDED") {
          if (lastSessionStatusRef.current !== "ENDED") {
            console.log("[VideoCall] participant detected session ENDED", { sessionId });
            lastSessionStatusRef.current = "ENDED";
          }
          try {
            await client.leave();
          } catch (e) {
            console.warn("client.leave failed", e);
          }
          audioTrackRef.current?.close();
          videoTrackRef.current?.close();
          audioTrackRef.current = null;
          videoTrackRef.current = null;
          setJoined(false);
          setSessionId(null);
          setMeetingCode(null);
          navigate("/call", { replace: true });
          chunkIndexRef.current = 0;
          meetingEpochMsRef.current = null;
          recordingOffsetMsRef.current = null;
          setShowMeetingEndedModal(true);
        }
      } catch (err) {
        console.warn("Session status check failed", err.message);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId, joined, isHost]);

  useEffect(() => {
    const handleUserPublished = async (user, mediaType) => {
      console.log("[VideoCall] user-published event", {
        uid: user.uid,
        mediaType,
        hasVideoTrack: !!user.videoTrack,
        hasAudioTrack: !!user.audioTrack,
      });
      await client.subscribe(user, mediaType);

      // Update remoteUsersRef tracking
      const userRecord = remoteUsersRef.current.get(user.uid) || {
        uid: user.uid,
        name: `Participant ${remoteUsersRef.current.size + 1}`,
      };
      if (mediaType === "video") {
        userRecord.hasVideo = true;
        userRecord.videoTrack = user.videoTrack;
      } else if (mediaType === "audio") {
        userRecord.hasAudio = true;
        userRecord.audioTrack = user.audioTrack;
        userRecord.isMuted = false; // Audio is published, so not muted
      }
      remoteUsersRef.current.set(user.uid, userRecord);

      if (mediaType === "video") {
        console.log("[VideoCall] subscribing/playing remote video", {
          uid: user.uid,
        });
        const container = document.getElementById("remote-playerlist");
        if (!container) return;

        // Check if tile already exists (e.g., was showing placeholder)
        let div = document.getElementById(`remote-${user.uid}`);
        if (!div) {
          // Create new tile if it doesn't exist
          div = document.createElement("div");
          div.id = `remote-${user.uid}`;
          div.className = "video-tile";
          div.style.cssText = `
            width: 100%; height: 100%; min-height: 160px;
            background: linear-gradient(145deg, #18181f 0%, #0f0f14 100%);
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 24px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
            animation: videoFadeIn 0.4s ease-out;
          `;
          container.appendChild(div);
          setParticipantCount((c) => Math.min(5, c + 1));
        }

        // Clear any placeholder and play the video
        div.innerHTML = "";
        user.videoTrack.play(div);

        // Remove muted indicator when video is active (they might still be muted audio-wise, but video is on)
        removeMutedIndicator(div);
      }

      if (mediaType === "audio") {
        console.log("[VideoCall] subscribing/playing remote audio", {
          uid: user.uid,
        });
        user.audioTrack.play();

        // Remove muted indicator when audio is published
        const div = document.getElementById(`remote-${user.uid}`);
        if (div) removeMutedIndicator(div);
      }
    };

    const handleUserUnpublished = (user, mediaType) => {
      console.log("[VideoCall] user-unpublished event", {
        uid: user.uid,
        mediaType,
        hasVideo: user.hasVideo,
        hasAudio: user.hasAudio,
      });

      // Update remoteUsersRef
      const userRecord = remoteUsersRef.current.get(user.uid);
      if (userRecord) {
        if (mediaType === "video") {
          userRecord.hasVideo = false;
          userRecord.videoTrack = null;
        } else if (mediaType === "audio") {
          userRecord.hasAudio = false;
          userRecord.audioTrack = null;
          userRecord.isMuted = true; // Audio unpublished means muted
        }

        // Only remove tile if user has no more media tracks at all
        if (!userRecord.hasVideo && !userRecord.hasAudio) {
          console.log("[VideoCall] removing tile (user has no media)", { uid: user.uid });
          document.getElementById(`remote-${user.uid}`)?.remove();
          remoteUsersRef.current.delete(user.uid);
          setParticipantCount((c) => Math.max(1, c - 1));
        } else if (mediaType === "video" && !userRecord.hasVideo) {
          // Keep tile but show placeholder
          console.log("[VideoCall] showing placeholder (video off)", { uid: user.uid });
          const div = document.getElementById(`remote-${user.uid}`);
          if (div) {
            const userInfo = getUserInfoByAgoraUid(user.uid);
            renderCameraOffPlaceholder(div, userInfo);
          }
          // Show muted indicator if audio is also not available
          if (!userRecord.hasAudio && div) {
            renderMutedIndicator(div);
          }
        } else if (mediaType === "audio" && userRecord.hasVideo) {
          // Video is still on but audio was muted - show muted indicator
          console.log("[VideoCall] showing muted indicator (audio off)", { uid: user.uid });
          const div = document.getElementById(`remote-${user.uid}`);
          if (div) {
            renderMutedIndicator(div);
          }
        } else if (mediaType === "audio" && !userRecord.hasVideo) {
          // Both video and audio are off - show placeholder with muted
          const div = document.getElementById(`remote-${user.uid}`);
          if (div) {
            const userInfo = getUserInfoByAgoraUid(user.uid);
            renderCameraOffPlaceholder(div, userInfo);
            renderMutedIndicator(div);
          }
        }
      }
    };

    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", handleUserUnpublished);

    return () => {
      client.off("user-published", handleUserPublished);
      client.off("user-unpublished", handleUserUnpublished);
    };
  }, []);

  // Sync remote users to DOM: run once after join, then on interval (so host sees participants who join later)
  const syncRemoteUsersToDom = async () => {
    const container = document.getElementById("remote-playerlist");
    if (!container) return;

    for (const user of client.remoteUsers) {
      const uid = user.uid;
      let tileCreated = false;

      // Update remoteUsersRef
      const userRecord = remoteUsersRef.current.get(uid) || { uid };
      if (user.hasVideo) {
        userRecord.hasVideo = true;
        userRecord.videoTrack = user.videoTrack;
      }
      if (user.hasAudio) {
        userRecord.hasAudio = true;
        userRecord.audioTrack = user.audioTrack;
        userRecord.isMuted = false;
      } else {
        userRecord.isMuted = true;
      }
      remoteUsersRef.current.set(uid, userRecord);

      // Check if tile already exists
      let div = document.getElementById(`remote-${uid}`);

      try {
        if (user.hasVideo) {
          await client.subscribe(user, "video");
          if (!div) {
            // Create new tile
            div = document.createElement("div");
            div.id = `remote-${uid}`;
            div.className = "video-tile";
            div.style.cssText = `
              width: 100%; height: 100%; min-height: 160px;
              background: linear-gradient(145deg, #18181f 0%, #0f0f14 100%);
              border-radius: 16px;
              overflow: hidden;
              position: relative;
              border: 1px solid rgba(255,255,255,0.08);
              box-shadow: 0 24px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
              animation: videoFadeIn 0.4s ease-out;
            `;
            container.appendChild(div);
            tileCreated = true;
            setParticipantCount((c) => Math.min(5, c + 1));
          }
          // Play video in the tile
          if (user.videoTrack) {
            div.innerHTML = "";
            user.videoTrack.play(div);
          }
          // Show muted indicator if audio is muted but video is on
          if (!user.hasAudio) {
            renderMutedIndicator(div);
          } else {
            removeMutedIndicator(div);
          }
        } else if (!div) {
          // User has no video but hasn't been added yet; create placeholder tile
          div = document.createElement("div");
          div.id = `remote-${uid}`;
          div.className = "video-tile";
          div.style.cssText = `
            width: 100%; height: 100%; min-height: 160px;
            background: linear-gradient(145deg, #18181f 0%, #0f0f14 100%);
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 24px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
            animation: videoFadeIn 0.4s ease-out;
          `;
          container.appendChild(div);
          tileCreated = true;
          const userInfo = getUserInfoByAgoraUid(uid);
          renderCameraOffPlaceholder(div, userInfo);
          setParticipantCount((c) => Math.min(5, c + 1));
          // Show muted indicator if also no audio
          if (!user.hasAudio) {
            renderMutedIndicator(div);
          }
        }

        if (user.hasAudio) {
          await client.subscribe(user, "audio");
          if (user.audioTrack) user.audioTrack.play();
        }
      } catch (e) {
        console.warn("Subscribe remote user failed", e);
      }
    }
  };

  useEffect(() => {
    if (!joined) return;

    const initialTimer = setTimeout(syncRemoteUsersToDom, 400);
    const interval = setInterval(syncRemoteUsersToDom, 2500);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [joined, agoraUidMapping]);

  const inviteUrl =
    sessionId && typeof window !== "undefined"
      ? `${window.location.origin}/call?sessionId=${sessionId}`
      : "";

  const copyLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const copyMeetingCodeDigits = () => {
    if (!meetingCode) return;
    navigator.clipboard.writeText(meetingCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: getGridColumns(participantCount),
    gridAutoRows: "1fr",
    gap: 14,
    width: "100%",
    height: "100%",
    minHeight: 200,
  };

  /**
   * Render a "camera off" placeholder in a video tile container
   * This is used when a user's video is disabled but they still have audio
   */
  const renderCameraOffPlaceholder = (container, userInfo = {}) => {
    if (!container) return;
    container.style.background = "linear-gradient(145deg, #18181f 0%, #0f0f14 100%)";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.position = "relative";

    const placeholder = document.createElement("div");
    placeholder.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: rgba(148, 163, 184, 0.8);
      text-align: center;
    `;

    // Profile photo or avatar with initials
    const avatarDiv = document.createElement("div");
    const { name = "User", profilePhoto } = userInfo;
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    if (profilePhoto) {
      avatarDiv.style.cssText = `
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background-image: url('${profilePhoto}');
        background-size: cover;
        background-position: center;
        border: 3px solid rgba(255, 255, 255, 0.2);
      `;
    } else {
      avatarDiv.style.cssText = `
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: 600;
        color: white;
        border: 3px solid rgba(255, 255, 255, 0.2);
      `;
      avatarDiv.textContent = initials;
    }

    // User name
    const nameDiv = document.createElement("div");
    nameDiv.style.cssText = `
      font-size: 14px;
      font-weight: 500;
      color: rgba(228, 228, 231, 0.8);
      max-width: 140px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    nameDiv.textContent = name;

    placeholder.appendChild(avatarDiv);
    placeholder.appendChild(nameDiv);

    container.innerHTML = "";
    container.appendChild(placeholder);
  };

  /**
   * Add muted mic indicator overlay to a tile
   */
  const renderMutedIndicator = (container) => {
    if (!container) return;

    // Remove existing mic indicator if present
    const existingIndicator = container.querySelector("[data-mic-indicator]");
    if (existingIndicator) existingIndicator.remove();

    const indicator = document.createElement("div");
    indicator.setAttribute("data-mic-indicator", "true");
    indicator.style.cssText = `
      position: absolute;
      bottom: 12px;
      right: 12px;
      width: 36px;
      height: 36px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      backdropFilter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 18px;
      z-index: 10;
    `;
    indicator.textContent = "🔇";
    container.appendChild(indicator);
  };

  /**
   * Remove muted mic indicator overlay from a tile
   */
  const removeMutedIndicator = (container) => {
    if (!container) return;
    const indicator = container.querySelector("[data-mic-indicator]");
    if (indicator) indicator.remove();
  };

  /**
   * Get user info for a remote user by Agora UID
   */
  const getUserInfoByAgoraUid = (agoraUid) => {
    const mapping = agoraUidMapping[String(agoraUid)];
    if (mapping && mapping.name) {
      return {
        name: mapping.name,
        profilePhoto: mapping.profilePhoto || null,
      };
    }
    // Fallback to participants list by index
    return {
      name: `Participant ${remoteUsersRef.current.size}`,
      profilePhoto: null,
    };
  };

  /** In-call control — Google Meet style circular buttons */
  const meetingControlBtn = (on, opts = {}) => {
    const { danger, recording, wide } = opts;
    if (danger) {
      return {
        minWidth: wide ? 88 : 48,
        height: 48,
        padding: wide ? "0 20px" : 0,
        borderRadius: 24,
        border: "none",
        cursor: "pointer",
        background: "#ea4335",
        color: "#fff",
        fontSize: wide ? 14 : 20,
        fontWeight: wide ? 500 : 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background .15s, transform .15s",
        fontFamily: "inherit",
      };
    }

    const offState = !on && !recording;
    return {
      width: 48,
      height: 48,
      borderRadius: "50%",
      border: "none",
      cursor: "pointer",
      background: offState ? "#ea4335" : recording && on ? "#ea4335" : "#3c4043",
      color: "#e8eaed",
      fontSize: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background .15s, transform .15s",
      fontFamily: "inherit",
    };
  };

  /* SVG icon helpers for the control buttons */
  const MicOnIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  );

  const MicOffIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22"/>
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/>
      <path d="M5 10v2a7 7 0 0 0 12 5.66"/>
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  );

  const CamOnIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>
      <rect x="2" y="6" width="14" height="12" rx="2"/>
    </svg>
  );

  const CamOffIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="22" y2="22"/>
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/>
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/>
    </svg>
  );

  const RecordIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="7" fill="currentColor" opacity="0.3"/>
      <circle cx="12" cy="12" r="7"/>
    </svg>
  );

  const StopRecordIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" opacity="0.3"/>
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  );

  const PhoneOffIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/>
      <line x1="23" y1="1" x2="1" y2="23"/>
    </svg>
  );

  // ─── Call duration timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (!joined) { setCallDuration(0); return; }
    const t = setInterval(() => setCallDuration((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [joined]);

  const fmtDur = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#202124",
        fontFamily: '"Google Sans", "Segoe UI", Roboto, sans-serif',
        color: "#e8eaed",
        display: "flex",
        flexDirection: "column",
        paddingTop: 70,
      }}
    >
      <style>{keyframes}</style>

      {showMeetingEndedModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowMeetingEndedModal(false)}
        >
          <div
            style={{
              background: "#fff",
              color: "#111",
              padding: 32,
              borderRadius: 16,
              maxWidth: 360,
              textAlign: "center",
              boxShadow: "0 24px 48px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              Meeting ended
            </p>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
              The host has ended the meeting. Recording may be available in Library.
            </p>
            <button
              onClick={() => setShowMeetingEndedModal(false)}
              style={{
                padding: "12px 32px",
                fontSize: 15,
                fontWeight: 600,
                background: "#000",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {!joined ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              marginBottom: 8,
              color: "#fff",
              letterSpacing: "-0.5px",
            }}
          >
            ProCast Meeting
          </h1>

          {joinError && (
            <p
              style={{
                marginBottom: 20,
                padding: "12px 20px",
                background: "rgba(229, 57, 53, 0.15)",
                color: "#ffcdd2",
                borderRadius: 12,
                fontSize: 14,
                maxWidth: 400,
                textAlign: "center",
              }}
            >
              {joinError}
            </p>
          )}

          {existingSessionId && sessionIdFromInitialUrl ? (
            <p
              style={{
                fontSize: 16,
                color: "rgba(255,255,255,0.75)",
                marginBottom: 24,
              }}
            >
              {isJoining
                ? "Connecting to meeting…"
                : joinError
                  ? "Could not connect."
                  : "Preparing…"}
            </p>
          ) : null}

          {existingSessionId && sessionIdFromInitialUrl && joinError && !isJoining ? (
            <button
              type="button"
              onClick={() => joinChannel({ sessionIdOverride: existingSessionId })}
              style={{
                padding: "14px 40px",
                fontSize: 15,
                fontWeight: 600,
                background: "#fff",
                color: "#000",
                border: "none",
                borderRadius: 50,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          ) : null}

          {!existingSessionId ? (
            <>
              <p
                style={{
                  fontSize: 16,
                  color: "rgba(255,255,255,0.6)",
                  marginBottom: 28,
                  textAlign: "center",
                  maxWidth: 420,
                }}
              >
                Create a new meeting as host, or join with an invite link or meeting ID.
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <button
                  type="button"
                  onClick={createMeeting}
                  disabled={isJoining}
                  style={{
                    padding: "16px 36px",
                    fontSize: 16,
                    fontWeight: 600,
                    background: isJoining ? "#888" : "#fff",
                    color: "#000",
                    border: "none",
                    borderRadius: 50,
                    cursor: isJoining ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 24px rgba(255,255,255,0.15)",
                  }}
                >
                  {pendingAction === "create" ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={joinWithInviteCode}
                  disabled={isJoining || !parseSessionIdFromInput(joinCode)}
                  style={{
                    padding: "16px 36px",
                    fontSize: 16,
                    fontWeight: 600,
                    background: "transparent",
                    color: "#fff",
                    border: "2px solid rgba(255,255,255,0.35)",
                    borderRadius: 50,
                    cursor:
                      isJoining || !parseSessionIdFromInput(joinCode)
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      isJoining && pendingAction === "create" ? 0.45 : 1,
                  }}
                >
                  {pendingAction === "join" ? "Joining…" : "Join"}
                </button>
              </div>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Paste invite link or meeting ID"
                style={{
                  width: "100%",
                  maxWidth: 400,
                  padding: "14px 18px",
                  fontSize: 15,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  outline: "none",
                  marginBottom: 10,
                }}
              />
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.45)",
                  margin: 0,
                }}
              >
                Paste invite URL, session ID, or 5-digit meeting code.
              </p>
            </>
          ) : null}

          {existingSessionId && !sessionIdFromInitialUrl ? (
            <>
              <p
                style={{
                  fontSize: 16,
                  color: "rgba(255,255,255,0.75)",
                  marginTop: 8,
                }}
              >
                {isJoining
                  ? "Joining meeting…"
                  : joinError
                    ? "Could not join."
                    : ""}
              </p>
              {joinError && !isJoining ? (
                <button
                  type="button"
                  onClick={joinWithInviteCode}
                  style={{
                    marginTop: 16,
                    padding: "14px 40px",
                    fontSize: 15,
                    fontWeight: 600,
                    background: "#fff",
                    color: "#000",
                    border: "none",
                    borderRadius: 50,
                    cursor: "pointer",
                  }}
                >
                  Try again
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <>
          {/* ── Full-viewport video area (Meet-style) ── */}
          <div style={{
            position: "fixed", top: 70, left: 0, right: 0, bottom: 0,
            display: "flex", flexDirection: "column", background: "#202124",
          }}>
            {/* Video grid */}
            <div style={{ flex: 1, padding: 8, display: "flex", minHeight: 0 }}>
              <div style={{ ...gridStyle, width: "100%", height: "100%" }}>
                <div className="video-tile" style={{
                  position: "relative", borderRadius: 12, overflow: "hidden",
                  background: "#3c4043", width: "100%", height: "100%",
                  animation: "videoFadeIn 0.3s ease",
                }}>
                  <div id="local-player" style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%", background: "#3c4043",
                  }} />

                  {/* Camera-off avatar overlay */}
                  {videoOff && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#3c4043", zIndex: 2,
                    }}>
                      {userProfile?.profilePhoto ? (
                        <img
                          src={userProfile.profilePhoto}
                          alt={userProfile.name || "You"}
                          style={{
                            width: 96, height: 96, borderRadius: "50%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 96, height: 96, borderRadius: "50%",
                          background: "#5f6368",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 36, fontWeight: 600, color: "#e8eaed",
                          letterSpacing: 2, userSelect: "none",
                        }}>
                          {userInitials}
                        </div>
                      )}
                    </div>
                  )}

                  <span style={{
                    position: "absolute", bottom: 8, left: 8, padding: "4px 8px",
                    background: "rgba(0,0,0,0.6)", borderRadius: 4,
                    fontSize: 13, fontWeight: 500, color: "#e8eaed", zIndex: 3,
                  }}>You</span>
                  {micMuted && (
                    <div style={{
                      position: "absolute", bottom: 8, right: 8,
                      width: 28, height: 28, borderRadius: "50%", background: "#ea4335",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3,
                    }}><MicOffIcon /></div>
                  )}
                </div>
                <div id="remote-playerlist" style={{ display: "contents" }} />
              </div>
            </div>

            {/* Meeting info overlay (top-left) */}
            <div style={{
              position: "absolute", top: 12, left: 16,
              display: "flex", alignItems: "center", gap: 14,
              padding: "8px 16px",
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderRadius: 10,
              zIndex: 10,
            }}>
              {/* Timer */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#e8eaed", fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>
                  {fmtDur(callDuration)}
                </span>
              </div>

              <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />

              {/* Participant count */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>
                  {participantCount}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#9aa0a6" }}>
                  {participantCount === 1 ? "Person" : "People"}
                </span>
              </div>

              {isRecording && (
                <>
                  <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "3px 10px", borderRadius: 6,
                    background: "#ea4335", fontSize: 12, fontWeight: 600, color: "#fff",
                    animation: "pulse 2s infinite",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
                    REC
                  </div>
                </>
              )}
            </div>

            {/* Share button (top-right) */}
            {isHost && sessionId ? (
              <div ref={shareMenuRef} style={{ position: "absolute", top: 12, right: 16, zIndex: 10 }}>
                <button type="button" aria-label="Meeting info"
                  onClick={() => setShowShareMenu((v) => !v)}
                  style={{
                    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    border: "none", borderRadius: 10,
                    background: showShareMenu ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.65)",
                    backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                    color: "#e8eaed", cursor: "pointer", transition: "background .15s",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                  </svg>
                </button>
                {showShareMenu && (
                  <div role="dialog" style={{
                    position: "absolute", top: "calc(100% + 4px)", right: 0,
                    width: "min(calc(100vw - 32px), 360px)", padding: 16,
                    background: "#2d2e31", borderRadius: 8,
                    boxShadow: "0 8px 28px rgba(0,0,0,0.5)", zIndex: 200,
                  }}>
                    <div style={{ marginBottom: 10, fontSize: 14, fontWeight: 500, color: "#e8eaed" }}>Share meeting</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 4px 12px", borderRadius: 8, background: "#3c4043", marginBottom: meetingCode ? 10 : 0 }}>
                      <p title={inviteUrl} onClick={(e) => { const s = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e.currentTarget); s?.removeAllRanges(); s?.addRange(r); }}
                        style={{ flex: 1, minWidth: 0, margin: 0, padding: "8px 0", fontSize: 13, color: "#bdc1c6", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text", userSelect: "all" }}
                      >{inviteUrl}</p>
                      <button type="button" onClick={copyLink} style={{ flexShrink: 0, padding: "8px 14px", fontSize: 13, fontWeight: 500, border: "none", borderRadius: 6, cursor: "pointer", background: linkCopied ? "#1b7a41" : "#8ab4f8", color: linkCopied ? "#fff" : "#202124", transition: "background .15s" }}>{linkCopied ? "Copied!" : "Copy"}</button>
                    </div>
                    {meetingCode && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "#3c4043" }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 500, color: "#9aa0a6", marginBottom: 2 }}>Meeting code</div>
                          <div style={{ fontSize: 18, fontWeight: 500, color: "#e8eaed", letterSpacing: "0.15em" }}>{meetingCode}</div>
                        </div>
                        <button type="button" onClick={copyMeetingCodeDigits} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 500, border: "none", borderRadius: 6, cursor: "pointer", background: codeCopied ? "#1b7a41" : "rgba(255,255,255,0.1)", color: codeCopied ? "#fff" : "#e8eaed" }}>{codeCopied ? "Copied!" : "Copy"}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {/* Bottom controls */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 16px 16px", background: "#202124" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button type="button" className="pc-ctrl-btn" onClick={toggleMic}
                  data-tip={micMuted ? "Unmute" : "Mute"} aria-label={micMuted ? "Unmute" : "Mute"}
                  style={meetingControlBtn(!micMuted)}
                >{micMuted ? <MicOffIcon /> : <MicOnIcon />}</button>

                <button type="button" className="pc-ctrl-btn" onClick={toggleVideo}
                  data-tip={videoOff ? "Camera on" : "Camera off"} aria-label={videoOff ? "Camera on" : "Camera off"}
                  style={meetingControlBtn(!videoOff)}
                >{videoOff ? <CamOffIcon /> : <CamOnIcon />}</button>

                {isHost && (
                  <>
                    <div className="pc-ctrl-divider" />
                    {!isRecording ? (
                      <button type="button" className="pc-ctrl-btn" onClick={startRecording}
                        data-tip="Record" aria-label="Record" style={meetingControlBtn(false, { recording: true })}
                      ><RecordIcon /></button>
                    ) : (
                      <button type="button" className="pc-ctrl-btn" onClick={stopRecording}
                        data-tip="Stop recording" aria-label="Stop recording"
                        style={{ ...meetingControlBtn(true, { recording: true }), animation: "pulse 2s infinite" }}
                      ><StopRecordIcon /></button>
                    )}
                  </>
                )}

                <div className="pc-ctrl-divider" />

                <button type="button" className="pc-ctrl-btn pc-ctrl-danger" onClick={leaveChannel}
                  data-tip={isHost ? "End meeting" : "Leave call"} aria-label={isHost ? "End meeting" : "Leave call"}
                  style={meetingControlBtn(false, { danger: true, wide: true })}
                >
                  <PhoneOffIcon />
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{isHost ? "End" : "Leave"}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default VideoCall;
