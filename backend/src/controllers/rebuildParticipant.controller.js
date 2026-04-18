import fs from "fs";
import path from "path";
import os from "os";
import Chunk from "../models/Chunk.js";
import Session from "../models/Session.js";
import { downloadFromB2, uploadToB2 } from "../utils/b2.js";

/**
 * STEP 3A
 * Rebuild ONE participant's continuous recording
 */
export const rebuildParticipant = async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId || !userId) {
      return res.status(400).json({ message: "sessionId and userId required" });
    }

    console.log(`🎯 Rebuilding video for user ${userId}`);

    const chunks = await Chunk.find({ sessionId, userId })
      .sort({ chunkIndex: 1 });

    if (!chunks.length) {
      return res.status(404).json({ message: "No chunks found" });
    }

    console.log(`📦 Total chunks: ${chunks.length}`);

    const firstIdx = Number(chunks[0]?.chunkIndex);
    if (!Number.isFinite(firstIdx) || firstIdx !== 1) {
      return res.status(409).json({
        message:
          "Missing chunk-000001 for this user. Cannot rebuild a valid WebM without the init/header segment.",
        firstChunkIndex: chunks[0]?.chunkIndex,
      });
    }

    // Temp workspace
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procast-"));
    const finalPath = path.join(tempDir, "final.webm");

    // 🔹 Binary append (SAFE because MediaRecorder was continuous)
    const writeStream = fs.createWriteStream(finalPath);

    for (const chunk of chunks) {
      const partPath = path.join(
        tempDir,
        `chunk-${String(chunk.chunkIndex).padStart(6, "0")}.part`
      );

      await downloadFromB2({
        fileId: chunk.b2FileId,
        downloadPath: partPath,
      });

      console.log(`⬇️ Downloaded chunk ${chunk.chunkIndex}:`, fs.existsSync(partPath));

      const buffer = fs.readFileSync(partPath);
      writeStream.write(buffer);
    }

    writeStream.end();
    await new Promise((r) => writeStream.on("finish", r));

    console.log("✅ User video rebuilt (binary append)");

    // ⬆️ Upload participant video
    const finalBuffer = fs.readFileSync(finalPath);

    const uploadRes = await uploadToB2({
      buffer: finalBuffer,
      fileName: `sessions/${sessionId}/users/${userId}/participant.webm`,
      contentType: "video/webm",
    });

    // 💾 Save fileId in Session
    await Session.findByIdAndUpdate(sessionId, {
      $set: {
        [`participantFiles.${userId}`]: uploadRes.fileId,
      },
    });

    console.log("☁️ Participant video uploaded to B2");

    res.json({
      success: true,
      fileId: uploadRes.fileId,
    });
  } catch (err) {
    console.error("❌ Rebuild failed:", err);
    res.status(500).json({ message: err.message });
  }
};
