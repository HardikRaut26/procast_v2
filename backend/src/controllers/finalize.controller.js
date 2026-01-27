import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import Chunk from "../models/Chunk.js";
import Session from "../models/Session.js";
import { downloadFromB2, uploadToB2 } from "../utils/b2.js";

export const finalizeSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId required" });
    }

    // ✅ SOURCE OF TRUTH — USERS WHO UPLOADED CHUNKS
    const participantIds = await Chunk.distinct("userId", { sessionId });

    console.log("🎯 Finalize participants:", participantIds);

    if (!participantIds.length) {
      return res.status(404).json({ message: "No participants found" });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procast-final-"));
    const inputVideos = [];

    /* ================= DOWNLOAD PARTICIPANT VIDEOS ================= */
    for (const userId of participantIds) {
      const fileId = session.participantFiles?.get(userId.toString());

      if (!fileId) {
        console.warn(`⚠️ Missing fileId for participant ${userId}`);
        continue;
      }

      const localPath = path.join(tempDir, `${userId}.webm`);

      await downloadFromB2({ fileId, downloadPath: localPath });

      if (!fs.existsSync(localPath)) {
        console.warn(`⚠️ File missing after download: ${userId}`);
        continue;
      }

      console.log(`⬇️ Downloaded participant video: ${userId}`);
      inputVideos.push(localPath);
    }

    if (!inputVideos.length) {
      return res.status(404).json({ message: "No participant videos available" });
    }

    console.log("⬇️ All participant videos downloaded");

    /* ================= GRID LAYOUT ================= */
    const count = inputVideos.length;
    const cols = Math.ceil(Math.sqrt(count));
    const TILE_W = 640;
    const TILE_H = 360;

    const layout = [];
    for (let i = 0; i < count; i++) {
      const x = (i % cols) * TILE_W;
      const y = Math.floor(i / cols) * TILE_H;
      layout.push(`${x}_${y}`);
    }

    const outputPath = path.join(tempDir, "meeting-final.webm");

    /* ================= FFMPEG GRID + AUDIO MIX ================= */
    await new Promise((resolve, reject) => {
      const command = ffmpeg();

      inputVideos.forEach((v) => command.input(v));

      const filters = [];

      // 🎥 SCALE EACH VIDEO
      for (let i = 0; i < count; i++) {
        filters.push({
          filter: "scale",
          options: { w: TILE_W, h: TILE_H, force_original_aspect_ratio: "decrease" },
          inputs: `${i}:v`,
          outputs: `v${i}`,
        });
      }

      // 🧩 STACK VIDEO GRID
      filters.push({
        filter: "xstack",
        options: {
          inputs: count,
          layout: layout.join("|"),
          fill: "black",
        },
        inputs: Array.from({ length: count }, (_, i) => `v${i}`),
        outputs: "vout",
      });

      // 🎧 MIX AUDIO TRACKS
      filters.push({
        filter: "amix",
        options: {
          inputs: count,
          dropout_transition: 0,
        },
        inputs: Array.from({ length: count }, (_, i) => `${i}:a`),
        outputs: "aout",
      });

      command
        .complexFilter(filters)
        .outputOptions([
          "-map [vout]",
          "-map [aout]",
          "-c:v libvpx-vp9",
          "-c:a libopus",
          "-b:v 3M",
          "-b:a 128k",
          "-pix_fmt yuv420p",
          "-movflags +faststart",
        ])
        .on("start", (cmd) => console.log("🎬 FFmpeg CMD:\n", cmd))
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    console.log("🎬 Final meeting video created");

    /* ================= UPLOAD FINAL ================= */
    const buffer = fs.readFileSync(outputPath);

    const uploaded = await uploadToB2({
      buffer,
      fileName: `sessions/${sessionId}/final-meeting.webm`,
      contentType: "video/webm",
    });

    // ✅ SAVE FINAL VIDEO FILE ID TO SESSION
    await Session.findByIdAndUpdate(sessionId, {
      $set: {
        finalMeetingFileId: uploaded.fileId,
      },
    });

    console.log("💾 Final meeting file saved in DB");


    return res.json({
      success: true,
      finalMeetingFileId: uploaded.fileId,
    });

  } catch (err) {
    console.error("❌ Final meeting merge failed:", err);
    return res.status(500).json({ message: err.message });
  }
};
