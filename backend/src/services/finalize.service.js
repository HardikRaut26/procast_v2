import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import Chunk from "../models/Chunk.js";
import Session from "../models/Session.js";
import { downloadFromB2, uploadToB2 } from "../utils/b2.js";
import { generateTranscript } from "./transcription.service.js";
import { generateMeetingSummary } from "./aiSummaryService.js";

const hasAudioTrack = (filePath) =>
  new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.warn("⚠️ ffprobe failed, assuming no audio:", filePath, err.message);
        return resolve(false);
      }
      const streams = metadata?.streams || [];
      resolve(streams.some((s) => s.codec_type === "audio"));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const downloadFromB2WithRetry = async ({ fileId, downloadPath }) => {
  const attempts = Number(process.env.B2_DOWNLOAD_RETRY_ATTEMPTS || "4");
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await downloadFromB2({ fileId, downloadPath });
      return true;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status || err?.status || err?.statusCode;
      const msg = String(err?.response?.data?.message || err?.message || "");
      const retryable =
        status === 403 ||
        status === 429 ||
        status === 503 ||
        msg.toLowerCase().includes("download_cap_exceeded") ||
        msg.toLowerCase().includes("service_unavailable");
      if (!retryable || i === attempts - 1) break;
      const delay = Math.min(4000, 400 * Math.pow(2, i));
      await sleep(delay);
    }
  }
  throw lastErr || new Error("B2 download failed");
};

export const finalizeSessionService = async (sessionId) => {
  try {
    if (!sessionId) {
      console.log("⚠️ finalize skipped — no sessionId");
      return;
    }

    const participantIds = await Chunk.distinct("userId", { sessionId });

    console.log("🎯 Finalize participants:", participantIds);

    // 🟢 SAFE EXIT — no chunks uploaded
    if (!participantIds.length) {
      console.log("⚠️ No participants uploaded chunks — skipping finalize");
      return;
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      console.log("⚠️ Session not found — skipping finalize");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procast-final-"));
    const inputVideos = [];
    const participantVideos = [];

    /* ================= DOWNLOAD PARTICIPANT VIDEOS ================= */
    for (const userId of participantIds) {
      const fileId = session.participantFiles?.get(userId.toString());

      if (!fileId) {
        console.warn(`⚠️ Missing fileId for participant ${userId}`);
        continue;
      }

      const localPath = path.join(tempDir, `${userId}.webm`);

      try {
        await downloadFromB2WithRetry({ fileId, downloadPath: localPath });

        if (fs.existsSync(localPath)) {
          inputVideos.push(localPath);
          participantVideos.push({
            userId,
            videoPath: localPath,
          });
          console.log(`⬇️ Downloaded participant video: ${userId}`);
        }
      } catch (err) {
        console.warn("⚠️ Skipping participant video due to download failure:", {
          sessionId,
          userId: String(userId),
          fileId: String(fileId),
          status: err?.response?.status || err?.status || err?.statusCode || null,
          message: err?.message || "download failed",
        });
      }
    }

    if (!inputVideos.length) {
      console.log("⚠️ No participant videos available — skipping finalize");
      return;
    }

    /* ================= GRID LAYOUT ================= */
    const count = inputVideos.length;
    const cols = Math.ceil(Math.sqrt(count));
    const TILE_W = Number(process.env.FINAL_TILE_W || "480") || 480;
    const TILE_H = Number(process.env.FINAL_TILE_H || "270") || 270;

    const layout = [];
    for (let i = 0; i < count; i++) {
      const x = (i % cols) * TILE_W;
      const y = Math.floor(i / cols) * TILE_H;
      layout.push(`${x}_${y}`);
    }

    const outputPath = path.join(tempDir, "meeting-final.webm");

    // Determine which participant videos actually contain audio streams.
    const audioPresence = await Promise.all(inputVideos.map((p) => hasAudioTrack(p)));
    const audioInputIndexes = audioPresence
      .map((hasAudio, idx) => (hasAudio ? idx : -1))
      .filter((idx) => idx >= 0);
    console.log("🔉 Inputs with audio:", audioInputIndexes);

    /* ================= FFMPEG MERGE ================= */
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      inputVideos.forEach((v) => command.input(v));

      const filters = [];

      if (count === 1) {
        filters.push({
          filter: "scale",
          options: {
            w: TILE_W,
            h: TILE_H,
            force_original_aspect_ratio: "decrease",
          },
          inputs: "0:v",
          outputs: "vs0",
        });
        filters.push({
          filter: "pad",
          options: {
            w: TILE_W,
            h: TILE_H,
            x: "(ow-iw)/2",
            y: "(oh-ih)/2",
            color: "black",
          },
          inputs: "vs0",
          outputs: "vout",
        });
      } else {
        for (let i = 0; i < count; i++) {
          filters.push({
            filter: "scale",
            options: {
              w: TILE_W,
              h: TILE_H,
              force_original_aspect_ratio: "decrease",
            },
            inputs: `${i}:v`,
            outputs: `v${i}`,
          });
        }

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
      }

      if (audioInputIndexes.length > 0) {
        if (audioInputIndexes.length === 1) {
          const idx = audioInputIndexes[0];
          filters.push({
            filter: "aresample",
            options: { async: 1, first_pts: 0 },
            inputs: `${idx}:a`,
            outputs: "aout",
          });
        } else {
          for (const idx of audioInputIndexes) {
            filters.push({
              filter: "aresample",
              options: { async: 1, first_pts: 0 },
              inputs: `${idx}:a`,
              outputs: `a${idx}`,
            });
          }

          filters.push({
            filter: "amix",
            options: {
              inputs: audioInputIndexes.length,
              dropout_transition: 0,
              normalize: 0,
            },
            inputs: audioInputIndexes.map((idx) => `a${idx}`),
            outputs: "aout",
          });
        }
      }

      const codec = String(process.env.FINAL_VIDEO_CODEC || "vp8").toLowerCase();
      const videoBitrate = String(process.env.FINAL_VIDEO_BITRATE || "2M");

      const outputOptions = ["-map [vout]", "-pix_fmt yuv420p"];

      // Fast defaults for dev/production: VP8 is significantly faster than VP9.
      // Keep WebM container so the frontend still works without changes.
      if (codec === "vp9") {
        outputOptions.push("-c:v libvpx-vp9", "-b:v", videoBitrate);
        // Speed/quality tradeoff knobs (higher cpu-used -> faster, lower quality)
        outputOptions.push("-deadline", "realtime", "-cpu-used", "4");
      } else {
        // vp8
        outputOptions.push("-c:v libvpx", "-b:v", videoBitrate);
        outputOptions.push("-deadline", "realtime", "-cpu-used", "4");
      }

      if (audioInputIndexes.length > 0) {
        outputOptions.push("-map [aout]", "-c:a libopus", "-b:a 128k");
      }

      command
        .complexFilter(filters)
        .outputOptions(outputOptions)
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    console.log("🎬 Final meeting video created");

    const buffer = fs.readFileSync(outputPath);

    const uploaded = await uploadToB2({
      buffer,
      fileName: `sessions/${sessionId}/final-meeting.webm`,
      contentType: "video/webm",
    });

    await Session.findByIdAndUpdate(sessionId, {
      finalMeetingFileId: uploaded.fileId,
    });

    console.log("💾 Final meeting file saved:", uploaded.fileId);
    console.log("🧠 Generating transcript...");

    const transcriptOk = await generateTranscript(sessionId, participantVideos);
    if (transcriptOk) {
      console.log("✅ Transcript generated");
    } else {
      console.warn("⚠️ Transcript generation failed (see transcription logs above)");
    }

    // After transcript is stored on the Session document, also upload a clean .txt version to B2
    const sessionWithTranscript = await Session.findById(sessionId);
    if (
      sessionWithTranscript &&
      Array.isArray(sessionWithTranscript.transcript) &&
      sessionWithTranscript.transcript.length > 0
    ) {
      const sorted = [...sessionWithTranscript.transcript].sort(
        (a, b) =>
          (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
      );

      const lines = sorted.map((t) => {
        const speaker = t.speaker || "Speaker";
        const text = t.text || "";
        return `${speaker}: ${text}`.trim();
      });

      const txt = lines.join("\n");

      try {
        const transcriptUpload = await uploadToB2({
          buffer: Buffer.from(txt, "utf-8"),
          fileName: `sessions/${sessionId}/transcript.txt`,
          contentType: "text/plain; charset=utf-8",
        });

        sessionWithTranscript.transcriptFileId = transcriptUpload.fileId;
        await sessionWithTranscript.save();

        console.log("💾 Transcript .txt saved:", transcriptUpload.fileId);
      } catch (e) {
        console.warn("⚠️ Failed to upload transcript .txt:", e.message);
      }

      // AI Summary (non-blocking for finalize success)
      try {
        console.log("🤖 Generating AI summary…");
        const summary = await generateMeetingSummary({ transcriptText: txt });
        await Session.findByIdAndUpdate(sessionId, {
          meetingSummary: {
            ...summary,
            generatedAt: new Date(),
          },
        });
        console.log("✅ AI summary saved");
      } catch (e) {
        console.warn("⚠️ AI summary failed:", e.message);
      }
    }

  } catch (err) {
    console.error("❌ Finalize service failed:", {
      sessionId,
      status: err?.response?.status || err?.status || err?.statusCode || null,
      message: err?.message || String(err),
    });
  }
};