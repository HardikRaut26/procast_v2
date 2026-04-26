import Session from "../models/Session.js";
import { deleteFromB2, streamFileToResponse } from "../utils/b2.js";
import { translateTranscriptAndSummary } from "../services/translation.service.js";

/**
 * GET video library items.
 * Includes:
 * - Ready recordings (final file available)
 * - Processing recordings (session ended, file not ready yet)
 */
export const getVideoLibrary = async (req, res) => {
  try {
    // Only return sessions where the logged-in user is the host
    const sessions = await Session.find({
      host: req.user._id,
      $or: [
        { finalMeetingFileId: { $exists: true, $ne: null } },
        {
          status: "ENDED",
          $or: [
            { finalMeetingFileId: { $exists: false } },
            { finalMeetingFileId: null },
            { finalMeetingFileId: "" },
          ],
        },
      ],
    }).sort({ createdAt: -1, _id: -1 });

    const getPipelineLogs = (session) => {
      const logs = [];
      const tState = String(session.transcriptionStatus || "NONE");
      const hasSummary = Boolean(session?.meetingSummary?.generatedAt);
      const transcriptCompleted = ["SUCCEEDED", "PARTIAL", "FAILED"].includes(tState);

      logs.push({
        key: "session-ended",
        label: "Session ended",
        state: session.status === "ENDED" ? "done" : "active",
      });

      if (!session.finalMeetingFileId) {
        logs.push({
          key: "final-video",
          label: "Final video is being generated",
          state: "active",
        });
        logs.push({
          key: "transcript",
          label: "Transcript will start after final video",
          state: "pending",
        });
        logs.push({
          key: "summary",
          label: "Summary generation will run after transcript",
          state: "pending",
        });
        return logs;
      }

      logs.push({
        key: "final-video",
        label: "Final video generated",
        state: "done",
      });

      if (!transcriptCompleted || tState === "RUNNING") {
        logs.push({
          key: "transcript",
          label: "Transcript is generating",
          state: "active",
        });
      } else if (tState === "SUCCEEDED" || tState === "PARTIAL") {
        logs.push({
          key: "transcript",
          label: "Transcript generated",
          state: "done",
        });
      } else if (tState === "FAILED") {
        logs.push({
          key: "transcript",
          label: "Transcript generation failed",
          state: "failed",
        });
      } else {
        logs.push({
          key: "transcript",
          label: "Transcript queued",
          state: "pending",
        });
      }

      if (hasSummary) {
        logs.push({
          key: "summary",
          label: "AI summary generated",
          state: "done",
        });
      } else if (!transcriptCompleted || tState === "RUNNING") {
        logs.push({
          key: "summary",
          label: "Summary will generate after transcript",
          state: "pending",
        });
      } else if (tState === "FAILED") {
        logs.push({
          key: "summary",
          label: "Summary skipped due to transcript failure",
          state: "done",
        });
      } else if (tState === "SUCCEEDED" || tState === "PARTIAL") {
        logs.push({
          key: "summary",
          label: "Summary is generating",
          state: "active",
        });
      } else {
        logs.push({
          key: "summary",
          label: "Summary queued",
          state: "pending",
        });
      }

      return logs;
    };

    const isProcessing = (session) => {
      const hasFinalVideo = Boolean(session.finalMeetingFileId);
      const tState = String(session.transcriptionStatus || "NONE");
      const transcriptCompleted = ["SUCCEEDED", "PARTIAL", "FAILED"].includes(tState);
      const hasSummary = Boolean(session?.meetingSummary?.generatedAt);

      if (!hasFinalVideo) return true;
      if (!transcriptCompleted) return true;

      // If transcript failed, there is no summary generation step to wait for.
      if (tState === "FAILED") return false;

      return !hasSummary;
    };

    const videos = await Promise.all(
      sessions.map(async (s) => ({
        sessionId: s._id,
        fileId: s.finalMeetingFileId || null,
        // IMPORTANT:
        // Avoid calling B2 for signed URLs during library load.
        // B2 download/transaction caps can cause 403 "download_cap_exceeded"
        // and break the entire Library UI (including transcript view).
        url: null,
        createdAt: s.createdAt,
        duration: s.duration,
        status: s.status,
        recordingState: s.recordingState,
        transcriptionStatus: s.transcriptionStatus,
        processing: isProcessing(s),
        transcriptFileId: s.transcriptFileId || null,
        pipelineLogs: getPipelineLogs(s),
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

    // Verify the logged-in user is the host of this recording
    const session = await Session.findOne({ finalMeetingFileId: fileId, host: req.user._id });
    if (!session) {
      return res.status(403).json({ message: "You can only delete your own recordings" });
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

    // Verify ownership: only the host can download
    const session = await Session.findOne({
      $or: [{ finalMeetingFileId: fileId }, { transcriptFileId: fileId }],
      host: req.user._id,
    });
    if (!session) {
      return res.status(403).json({ message: "You can only download your own recordings" });
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

    // Verify ownership: only the host can stream
    const session = await Session.findOne({ finalMeetingFileId: fileId, host: req.user._id });
    if (!session) {
      return res.status(403).json({ message: "You can only view your own recordings" });
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

    const session = await Session.findById(sessionId).select("transcript meetingSummary host");
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Only the host can view the transcript
    if (String(session.host) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only view transcripts of your own recordings" });
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
