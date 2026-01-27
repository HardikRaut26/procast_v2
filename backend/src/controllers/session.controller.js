import Session from "../models/Session.js";
import { rebuildParticipant } from "./rebuildParticipant.controller.js";
import { finalizeSession } from "./finalize.controller.js";
import Chunk from "../models/Chunk.js";

/**
 * Start a new live session
 */
export const startSession = async (req, res) => {
  try {
    const { channelName } = req.body;

    if (!channelName) {
      return res.status(400).json({ message: "Channel name is required" });
    }

    const session = await Session.create({
      channelName,
      host: req.user._id,

      // ✅ ENSURE HOST IS FIRST PARTICIPANT
      participants: [req.user._id],

      startTime: new Date(),
      status: "LIVE",
    });

    console.log("🎥 Session created:", session._id);
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
 * Stop an active session
 */
export const stopSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.status === "ENDED") {
      return res.status(400).json({ message: "Session already ended" });
    }

    // End session
    session.endTime = new Date();
    session.duration = Math.floor(
      (session.endTime - session.startTime) / 1000
    );
    session.status = "ENDED";

    await session.save();

    console.log("🛑 Session ended — auto rebuilding videos");

    // ✅ Get all participant IDs from chunks
    const participantIds = await Chunk.distinct("userId", { sessionId });

    // ✅ Auto rebuild each participant
    for (const userId of participantIds) {
      await rebuildParticipant(
        { body: { sessionId, userId } },
        { json: () => {} }
      );
    }

    console.log("🎬 All participant videos rebuilt — merging final");

    // ✅ Auto finalize meeting
    await finalizeSession(
      { body: { sessionId } },
      { json: () => {} }
    );

    res.status(200).json({
      success: true,
      message: "Session ended, rebuild + finalize started",
      session,
    });

  } catch (error) {
    console.error("❌ Stop session error:", error);
    res.status(500).json({
      message: "Failed to stop session",
      error: error.message,
    });
  }
};

/**
 * Add participant to a live session
 */
export const addParticipant = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.status !== "LIVE") {
      return res.status(400).json({ message: "Session is not live" });
    }

    // ✅ Ensure participants array exists
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
 * Remove participant from a live session
 */
export const removeParticipant = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // 🚫 DO NOT REMOVE from participants
    // Participants = history, not live state

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

// Host broadcasts recording state
export const broadcastRecording = async (req, res) => {
  try {
    const { sessionId, action } = req.body;

    if (!sessionId || !action) {
      return res.status(400).json({ message: "sessionId & action required" });
    }

    await Session.findByIdAndUpdate(sessionId, {
      recordingState: action,
    });

    console.log(`📡 Recording state updated → ${action}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Broadcast recording error:", err);
    res.status(500).json({ message: err.message });
  }
};

// Participants read recording state
export const getRecordingState = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    res.json({
      state: session.recordingState || "IDLE",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
