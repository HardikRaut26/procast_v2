import { uploadToB2 } from "../utils/b2.js";
import Chunk from "../models/Chunk.js";
import Session from "../models/Session.js";

export const uploadChunk = async (req, res) => {
  try {
    const { sessionId, chunkIndex, chunkStartMs: chunkStartMsRaw } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "No file received" });
    }

    const userId = req.user._id;

    let startTimeMs = null;
    if (chunkStartMsRaw !== undefined && chunkStartMsRaw !== "") {
      const n = Number(chunkStartMsRaw);
      if (Number.isFinite(n) && n >= 0) startTimeMs = Math.round(n);
    }
    // If startTimeMs not provided by client, leave it null (don't calculate from now).
    // The transcription service will use a smarter fallback based on actual audio duration.

    // 🔹 Deterministic file name (VERY IMPORTANT)
    const fileName = `sessions/${sessionId}/users/${userId}/chunk-${String(
      chunkIndex
    ).padStart(6, "0")}.webm`;

    // 🔹 Upload to B2
    const b2Result = await uploadToB2({
      buffer: req.file.buffer,
      fileName,
      contentType: req.file.mimetype,
    });

    // 🔹 Store metadata in MongoDB
    await Chunk.updateOne(
      { sessionId, userId, chunkIndex }, // unique key
      {
        $set: {
          fileName,
          size: req.file.size,
          b2FileId: b2Result.fileId,
          ...(startTimeMs !== null ? { startTimeMs } : {}),
        },
        $setOnInsert: {
          sessionId,
          userId,
          chunkIndex,
        },
      },
      {
        upsert: true,
        runValidators: true, // optional but recommended
      }
    );
    /*  */


    console.log("✅ Chunk uploaded to B2:", {
      sessionId,
      userId: String(userId),
      chunkIndex: String(chunkIndex),
      fileName,
      bytes: req.file.size,
      b2FileId: b2Result.fileId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ B2 upload failed:", err);
    const status = err?.response?.status || err?.status || err?.statusCode;
    const msg = String(err?.response?.data?.message || err?.message || "");
    const isRetryable =
      status === 503 ||
      status === 429 ||
      msg.toLowerCase().includes("service_unavailable") ||
      msg.toLowerCase().includes("no tomes");

    res.status(isRetryable ? 503 : 500).json({
      message: "Upload failed",
      retryable: isRetryable,
    });
  }
};
