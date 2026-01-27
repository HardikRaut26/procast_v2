import { uploadToB2 } from "../utils/b2.js";
import Chunk from "../models/Chunk.js"; // or whatever model you use

export const uploadChunk = async (req, res) => {
  try {
    const { sessionId, chunkIndex } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "No file received" });
    }

    const userId = req.user._id;

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


    console.log("✅ Chunk uploaded to B2:", fileName);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ B2 upload failed:", err);
    res.status(500).json({ message: "Upload failed" });
  }
};
