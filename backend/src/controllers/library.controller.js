import Session from "../models/Session.js";
import { getDownloadUrl, deleteFromB2, streamFileToResponse } from "../utils/b2.js";
import { translateTranscriptAndSummary } from "../services/translation.service.js";

/**
 * GET all finalized meeting videos
 */
export const getVideoLibrary = async (req, res) => {
  try {
    const sessions = await Session.find({
      finalMeetingFileId: { $exists: true },
    }).sort({ createdAt: -1 });

    const videos = await Promise.all(
      sessions.map(async (s) => ({
        sessionId: s._id,
        fileId: s.finalMeetingFileId,
        // IMPORTANT:
        // Avoid calling B2 for signed URLs during library load.
        // B2 download/transaction caps can cause 403 "download_cap_exceeded"
        // and break the entire Library UI (including transcript view).
        url: null,
        createdAt: s.createdAt,
        duration: s.duration,
        transcriptFileId: s.transcriptFileId || null,
      }))
    );


    return res.json({ videos });
  } catch (err) {
    console.error("❌ Library fetch error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * DELETE a final meeting video
 */
export const deleteVideo = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({ message: "fileId required" });
    }

    await deleteFromB2(fileId);

    await Session.updateMany(
      { finalMeetingFileId: fileId },
      { $unset: { finalMeetingFileId: "" } }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete video error:", err);
    res.status(500).json({ message: err?.message || "Delete failed" });
  }
};

/**
 * GET download stream (for "Save to device" — triggers download, not open in tab)
 */
export const downloadVideoStream = async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({ message: "fileId required" });
    }
    await streamFileToResponse(fileId, res);
  } catch (err) {
    console.error("❌ Download stream error:", err);
    const msg = String(err?.message || "");
    const status =
      err?.response?.status ||
      err?.statusCode ||
      (msg.toLowerCase().includes("download_cap_exceeded") ? 403 : 500);
    res.status(status).json({ message: err?.message || "Download failed" });
  }
};

/**
 * GET inline stream for video player (plays in <video> tag)
 */
export const inlineVideoStream = async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({ message: "fileId required" });
    }
    await streamFileToResponse(fileId, res, { download: false });
  } catch (err) {
    console.error("❌ Inline stream error:", err);
    const msg = String(err?.message || "");
    const status =
      err?.response?.status ||
      err?.statusCode ||
      (msg.toLowerCase().includes("download_cap_exceeded") ? 403 : 500);
    res.status(status).json({ message: err?.message || "Stream failed" });
  }
};

/**
 * GET transcript sentences for a given session
 */
export const getTranscriptForSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const targetLanguage = String(req.query?.lang || "original");
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId required" });
    }

    const session = await Session.findById(sessionId).select("transcript meetingSummary");
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    try {
      const translated = await translateTranscriptAndSummary({
        transcript: session.transcript || [],
        meetingSummary: session.meetingSummary || null,
        targetLanguage,
      });
      return res.json(translated);
    } catch (transErr) {
      console.error("❌ Translation pipeline error:", transErr);
      return res.status(200).json({
        transcript: session.transcript || [],
        meetingSummary: session.meetingSummary || null,
        language: targetLanguage,
        translated: false,
        translationError:
          transErr?.message ||
          "Translation failed; showing original transcript.",
      });
    }
  } catch (err) {
    console.error("❌ Get transcript error:", err);
    return res.status(500).json({ message: err.message });
  }
};
