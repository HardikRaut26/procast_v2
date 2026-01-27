import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
} from "../api/session";

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

function VideoCall() {
  const [searchParams] = useSearchParams();
  const existingSessionId = searchParams.get("sessionId");

  const isHost = !existingSessionId;

  const [sessionId, setSessionId] = useState(existingSessionId);
  const [joined, setJoined] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const audioTrackRef = useRef(null);
  const videoTrackRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunkIndexRef = useRef(0);

  /* ================= JOIN CHANNEL ================= */
  const joinChannel = async () => {
    const channelName = "procast-room";
    let activeSessionId = sessionId;

    // HOST creates session ONCE
    if (isHost && !sessionId) {
      const session = await startSession(channelName);
      activeSessionId = session._id;
      setSessionId(activeSessionId);
      console.log("🎥 Host created session:", activeSessionId);
    }

    // ALL users join SAME session
    await joinSession(activeSessionId);

    const token = await getAgoraToken(channelName);
    await client.join(AGORA_APP_ID, channelName, token, null);

    const mic = await AgoraRTC.createMicrophoneAudioTrack();
    const cam = await AgoraRTC.createCameraVideoTrack({
      encoderConfig: {
        width: 1280,
        height: 720,
        frameRate: 30,
        bitrateMin: 2500,
        bitrateMax: 4000,
      },
    });

    await client.publish([mic, cam]);
    cam.play("local-player");

    audioTrackRef.current = mic;
    videoTrackRef.current = cam;

    setJoined(true);
  };

  /* ================= START RECORDING (ALL USERS) ================= */
  const startRecording = async () => {
    if (!audioTrackRef.current || !videoTrackRef.current || !sessionId) {
      alert("Recording not ready");
      return;
    }

    if (mediaRecorderRef.current) return;

    // HOST broadcasts START signal
    if (isHost) {
      await api.post("/sessions/broadcast-recording", {
        sessionId,
        action: "START",
      });
      console.log("📡 Host broadcast START recording");
    }

    const stream = new MediaStream([
      audioTrackRef.current.getMediaStreamTrack(),
      videoTrackRef.current.getMediaStreamTrack(),
    ]);

    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm; codecs=vp8,opus",
    });

    chunkIndexRef.current = 0;

    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;

      chunkIndexRef.current += 1;

      await uploadChunkToBackend({
        file: e.data,
        sessionId,
        chunkIndex: chunkIndexRef.current,
      });

      console.log("⬆️ Chunk uploaded:", chunkIndexRef.current);
    };

    recorder.start(5000); // slice every 5s
    mediaRecorderRef.current = recorder;
    setIsRecording(true);

    console.log("🎬 Recording started locally");
  };

  /* ================= STOP RECORDING ================= */
  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      console.log("🛑 Recording stopped");
    }

    // HOST broadcasts STOP
    if (isHost) {
      await api.post("/sessions/broadcast-recording", {
        sessionId,
        action: "STOP",
      });
      console.log("📡 Host broadcast STOP recording");
    }
  };

  /* ================= PARTICIPANT AUTO-LISTENER ================= */
  useEffect(() => {
    if (!sessionId || !joined || isHost) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/sessions/recording-state/${sessionId}`);
        const state = res.data.state;

        if (state === "START" && !mediaRecorderRef.current) {
          console.log("🎬 Participant auto-starting recording");
          startRecording();
        }

        if (state === "STOP" && mediaRecorderRef.current) {
          console.log("🛑 Participant auto-stopping recording");
          stopRecording();
        }

      } catch (err) {
        console.warn("Recording poll failed", err.message);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId, joined]);

  /* ================= LEAVE CHANNEL ================= */
  const leaveChannel = async () => {
    if (isRecording) stopRecording();

    audioTrackRef.current?.stop();
    audioTrackRef.current?.close();
    videoTrackRef.current?.stop();
    videoTrackRef.current?.close();

    await client.leave();

    if (sessionId) {
      await leaveSession(sessionId);
      if (isHost) {
        await stopSession(sessionId);
      }
    }

    setJoined(false);
  };

  /* ================= REMOTE USERS ================= */
  useEffect(() => {
    const handleUserPublished = async (user, mediaType) => {
      await client.subscribe(user, mediaType);

      if (mediaType === "video") {
        const container = document.getElementById("remote-playerlist");
        if (!container) return;

        const div = document.createElement("div");
        div.id = `remote-${user.uid}`;
        div.style.width = "300px";
        div.style.height = "200px";
        div.style.background = "#000";
        container.appendChild(div);

        user.videoTrack.play(div);
      }

      if (mediaType === "audio") {
        user.audioTrack.play();
      }
    };

    const handleUserUnpublished = (user) => {
      document.getElementById(`remote-${user.uid}`)?.remove();
    };

    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", handleUserUnpublished);

    return () => {
      client.off("user-published", handleUserPublished);
      client.off("user-unpublished", handleUserUnpublished);
    };
  }, []);

  /* ================= UI ================= */
  return (
    <div style={{ padding: 20 }}>
      <h2>{isHost ? "Host Call" : "Participant Call"}</h2>

      {!joined ? (
        <button onClick={joinChannel}>Join Call</button>
      ) : (
        <button onClick={leaveChannel}>Leave Call</button>
      )}

      {joined && isHost && (
        <div style={{ marginTop: 10 }}>
          {!isRecording ? (
            <button onClick={startRecording}>Start Recording</button>
          ) : (
            <button onClick={stopRecording}>Stop Recording</button>
          )}
        </div>
      )}

      {/* SHARE LINK */}
      {joined && isHost && sessionId && (
        <div style={{ marginTop: 12 }}>
          <p><strong>Invite participants</strong></p>
          <input
            type="text"
            readOnly
            value={`${window.location.origin}/call?sessionId=${sessionId}`}
            style={{ width: "100%", padding: "6px" }}
            onClick={(e) => e.target.select()}
          />
        </div>
      )}

      <div id="local-player" style={{ width: 400, height: 300, background: "#000", marginTop: 12 }} />
      <div id="remote-playerlist" style={{ display: "flex", gap: 10, marginTop: 10 }} />
    </div>
  );
}

export default VideoCall;
