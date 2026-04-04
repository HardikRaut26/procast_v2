import { randomUUID } from "crypto";
import mongoose from "mongoose";
import Session from "../models/Session.js";
import { rebuildParticipant } from "./rebuildParticipant.controller.js";
import { finalizeSessionService } from "../services/finalize.service.js";
import Chunk from "../models/Chunk.js";

// Avoid noisy logs from polling. We log only when a session's state changes.
const lastRecordingStateBySessionId = new Map();
const lastEndedBySessionId = new Map();

const MEETING_CODE_REGEX = /^\d{5}$/;

const generateMeetingCode = () =>
  String(Math.floor(10000 + Math.random() * 90000));

const createUniqueMeetingCode = async (maxAttempts = 20) => {
  for (let i = 0; i < maxAttempts; i += 1) {
    const code = generateMeetingCode();
    const exists = await Session.exists({ meetingCode: code });
    if (!exists) return code;
  }
  throw new Error("Could not allocate unique meeting code");
};

const findSessionBySelector = async (selector) => {
  if (!selector) return null;
  const value = String(selector).trim();
  if (!value) return null;

  if (MEETING_CODE_REGEX.test(value)) {
    return Session.findOne({ meetingCode: value });
  }
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return null;
  }
  return Session.findById(value);
};

/**
 * Start a new live session
 */
export const startSession = async (req, res) => {
  try {
    // One Agora channel per meeting — never reuse a global name (enables unlimited concurrent rooms).
    const channelName = `pc-${randomUUID()}`;
    const meetingCode = await createUniqueMeetingCode();

    const session = await Session.create({
      channelName,
      meetingCode,
      host: req.user._id,
      participants: [req.user._id],
      startTime: new Date(),
      status: "LIVE",
    });

    console.log("🎥 Session created:", session._id);
    console.log("🔢 Meeting code:", meetingCode);
    console.log("👤 Host added to participants");

    res.status(201).json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("❌ Start session error:", error);
    res.status(500).json({
      message: "Failed to start session",
      error: error.message,
    });
  }
};

/**
 * Stop an active session (Host leaves → meeting ends)
 */
export const stopSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID or code is required" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const canonicalSessionId = String(session._id);

    if (session.status === "ENDED") {
      return res.status(400).json({ message: "Session already ended" });
    }

    // Mark session ended
    session.endTime = new Date();
    session.duration = Math.floor(
      (session.endTime - session.startTime) / 1000
    );
    session.status = "ENDED";

    await session.save();

    console.log("🛑 Session ended — rebuild & finalize scheduled (waiting for in-flight uploads)");

    // Respond immediately so host gets a fast response
    res.status(200).json({
      success: true,
      message: "Session ended and finalized successfully",
      session,
    });

    // Run rebuild + finalize after a delay so participant chunk uploads can finish
    const delayMs = 18 * 1000; // 18s — chunks upload every 5s, give time for last round
    setTimeout(async () => {
      try {
        const participantIds = await Chunk.distinct("userId", {
          sessionId: canonicalSessionId,
        });
        console.log("🎬 Delayed rebuild — participants with chunks:", participantIds.length);

        for (const userId of participantIds) {
          const mockRes = {
            _status: 200,
            _payload: null,
            status(code) {
              this._status = code;
              return this;
            },
            json(payload) {
              this._payload = payload;
              return this;
            },
          };

          try {
            await rebuildParticipant(
              { body: { sessionId: canonicalSessionId, userId } },
              mockRes
            );
          } catch (err) {
            console.warn("⚠️ Rebuild threw for participant, skipping:", {
              sessionId: canonicalSessionId,
              userId: String(userId),
              message: err?.message || String(err),
            });
            continue;
          }

          if (mockRes._status >= 400) {
            console.warn("⚠️ Rebuild skipped participant:", {
              sessionId: canonicalSessionId,
              userId: String(userId),
              status: mockRes._status,
              response: mockRes._payload || null,
            });
          }
        }

        console.log("🎬 All participant videos rebuilt — merging final");
        await finalizeSessionService(canonicalSessionId);
      } catch (err) {
        console.error("❌ Delayed rebuild/finalize error:", err);
      }
    }, delayMs);

  } catch (error) {
    console.error("❌ Stop session error:", error);
    res.status(500).json({
      message: "Failed to stop session",
      error: error.message,
    });
  }
};

/**
 * Get session by ID (for participants to poll status, e.g. detect ENDED)
 */
export const getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID or code is required" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const status = session.status;
    const canonicalSessionId = String(session._id);
    if (
      status === "ENDED" &&
      lastEndedBySessionId.get(canonicalSessionId) !== "ENDED"
    ) {
      console.log(`🛑 getSession detected ENDED for session`, {
        sessionId: canonicalSessionId,
      });
      lastEndedBySessionId.set(canonicalSessionId, "ENDED");
    }

    res.status(200).json({
      session: {
        _id: session._id,
        meetingCode: session.meetingCode || null,
        status,
        channelName: session.channelName,
        startTime: session.startTime,
      },
    });
  } catch (error) {
    console.error("❌ getSession error:", error);
    res.status(500).json({
      message: "Failed to get session",
      error: error.message,
    });
  }
};

/**
 * Add participant to live session
 */
export const addParticipant = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID or code is required" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.status !== "LIVE") {
      return res.status(400).json({ message: "Session is not live" });
    }

    if (!Array.isArray(session.participants)) {
      session.participants = [];
    }

    const userId = req.user._id.toString();

    const alreadyJoined = session.participants.some(
      (id) => id.toString() === userId
    );

    if (!alreadyJoined) {
      session.participants.push(req.user._id);
      await session.save();
      console.log("➕ Participant added:", userId);
    } else {
      console.log("⚠️ Participant already exists:", userId);
    }

    return res.status(200).json({
      success: true,
      sessionId: session._id,
      meetingCode: session.meetingCode || null,
      participants: session.participants,
    });

  } catch (error) {
    console.error("❌ addParticipant error:", error);
    return res.status(500).json({
      message: "Failed to add participant",
      error: error.message,
    });
  }
};

/**
 * Remove participant (history preserved)
 */
export const removeParticipant = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID or code is required" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    console.log("👋 Participant left (history preserved):", req.user._id);

    return res.status(200).json({
      success: true,
      participants: session.participants,
    });

  } catch (error) {
    console.error("❌ removeParticipant error:", error);
    return res.status(500).json({
      message: "Failed to leave session",
      error: error.message,
    });
  }
};

/**
 * Host broadcasts recording state
 */
export const broadcastRecording = async (req, res) => {
  try {
    const { sessionId, action } = req.body;

    if (!sessionId || !action) {
      return res.status(400).json({ message: "sessionId & action required" });
    }

    const session = await findSessionBySelector(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    session.recordingState = action;
    await session.save();

    console.log(`📡 Recording state updated → ${action}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Broadcast recording error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * Participants read recording state
 */
export const getRecordingState = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const state = session.recordingState || "IDLE";
    const canonicalSessionId = String(session._id);
    const prev = lastRecordingStateBySessionId.get(canonicalSessionId);
    if (prev !== state) {
      console.log(`📡 getRecordingState changed → ${state}`, {
        sessionId: canonicalSessionId,
      });
      lastRecordingStateBySessionId.set(canonicalSessionId, state);
    }

    res.json({ state });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get participants with their user details (name, profile photo)
 */
export const getParticipants = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    // Find session first
    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Now populate the participants using the session's _id
    const populatedSession = await Session.findById(session._id).populate(
      "participants",
      "name email profilePhoto"
    );

    const participants = populatedSession?.participants || [];
    const participantList = participants.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      profilePhoto: user.profilePhoto || null,
    }));

    res.status(200).json({
      success: true,
      participants: participantList,
    });
  } catch (error) {
    console.error("❌ getParticipants error:", error);
    res.status(500).json({
      message: "Failed to get participants",
      error: error.message,
    });
  }
};

/**
 * Register Agora UID for a participant when they join the Agora channel
 */
export const registerAgoraUid = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { agoraUid } = req.body;

    if (!sessionId || !agoraUid) {
      return res.status(400).json({ message: "Session ID and Agora UID are required" });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    console.log("[registerAgoraUid] Registering Agora UID mapping", {
      sessionId: session._id,
      agoraUid,
      userId: req.user._id,
      userName: req.user.name || req.user.email,
      userProfilePhoto: !!req.user.profilePhoto,
    });

    // Initialize agoraUidMap if not exists
    if (!Array.isArray(session.agoraUidMap)) {
      session.agoraUidMap = [];
    }

    // Remove existing entry for this UID if it exists
    session.agoraUidMap = session.agoraUidMap.filter(
      (entry) => entry.agoraUid !== String(agoraUid)
    );

    // Add the new mapping
    session.agoraUidMap.push({
      agoraUid: String(agoraUid),
      userId: req.user._id,
      name: req.user.name || req.user.email || "User",
      profilePhoto: req.user.profilePhoto || null,
    });

    await session.save();

    console.log("[registerAgoraUid] Successfully registered Agora UID mapping", {
      sessionId: session._id,
      agoraUid,
      userId: req.user._id,
      mappingSize: session.agoraUidMap.length,
    });

    res.status(200).json({
      success: true,
      message: "Agora UID registered",
    });
  } catch (error) {
    console.error("❌ registerAgoraUid error:", error);
    res.status(500).json({
      message: "Failed to register Agora UID",
      error: error.message,
    });
  }
};

/**
 * Get Agora UID to user mapping for a session
 */
export const getAgoraUidMapping = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const session = await findSessionBySelector(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const mapping = {};
    if (Array.isArray(session.agoraUidMap) && session.agoraUidMap.length > 0) {
      // Convert array to object keyed by agoraUid
      for (const entry of session.agoraUidMap) {
        mapping[String(entry.agoraUid)] = {
          userId: entry.userId ? entry.userId.toString() : null,
          name: entry.name || "User",
          profilePhoto: entry.profilePhoto || null,
        };
      }
    }

    console.log("[getAgoraUidMapping] Returning mapping for session", {
      sessionId: session._id,
      mappingCount: Object.keys(mapping).length,
    });

    res.status(200).json({
      success: true,
      mapping,
    });
  } catch (error) {
    console.error("❌ getAgoraUidMapping error:", error);
    res.status(500).json({
      message: "Failed to get Agora UID mapping",
      error: error.message,
    });
  }
};