import Session from "../models/Session.js";
import { getDownloadUrl, deleteFromB2 } from "../utils/b2.js";

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
        url: await getDownloadUrl(s.finalMeetingFileId),
        createdAt: s.createdAt,
        duration: s.duration,
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
    res.status(500).json({ message: err.message });
  }
};
