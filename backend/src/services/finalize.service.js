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

    /* ============ SINGLE PARTICIPANT — LOSSLESS COPY ============ */
    // For a single participant, just copy the original stream as-is with
    // no re-encoding.  This preserves the full original quality (1080p, 4K,
    // whatever the camera captured) and is near-instant.
    if (count === 1) {
      const outputPath = path.join(tempDir, "meeting-final.webm");
      const hasAudio = await hasAudioTrack(inputVideos[0]);

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg().input(inputVideos[0]);
        const opts = ["-c:v copy"];
        if (hasAudio) {
          opts.push("-c:a copy");
        }
        cmd
          .outputOptions(opts)
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath);
      });

      console.log("🎬 Single-participant video copied (no re-encoding — full quality)");

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

      // Transcript + Summary pipeline (same as multi-participant)
      await runPostProcessing(sessionId, participantVideos, tempDir);
      return;
    }

    /* ============ MULTI-PARTICIPANT — NATIVE QUALITY GRID ============ */
    // Detect each input's native resolution and use it as-is (no downscaling).
    // The final canvas will be the sum of all tiles at their original resolution.
    const getVideoResolution = (filePath) =>
      new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) return resolve({ w: 1920, h: 1080 }); // safe fallback
          const vs = (metadata?.streams || []).find((s) => s.codec_type === "video");
          resolve({ w: vs?.width || 1920, h: vs?.height || 1080 });
        });
      });

    const resolutions = await Promise.all(inputVideos.map(getVideoResolution));

    // Use the maximum resolution found as the per-tile size so all tiles
    // are uniform without downscaling any participant.
    const TILE_W = Math.max(...resolutions.map((r) => r.w));
    const TILE_H = Math.max(...resolutions.map((r) => r.h));
    console.log(`📐 Grid tile size: ${TILE_W}×${TILE_H} (native, no downscale)`);

    const cols = Math.ceil(Math.sqrt(count));
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

      for (let i = 0; i < count; i++) {
        // Scale UP to tile size if needed, but never compress down.
        // `force_original_aspect_ratio: decrease` + pad ensures uniform tiles
        // without stretching or cropping.
        filters.push({
          filter: "scale",
          options: {
            w: TILE_W,
            h: TILE_H,
            force_original_aspect_ratio: "decrease",
            flags: "lanczos",
          },
          inputs: `${i}:v`,
          outputs: `vs${i}`,
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
          inputs: `vs${i}`,
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
      // CRF mode: quality-based encoding (lower = better, 23 = great quality + fast)
      // Override with FINAL_VIDEO_CRF env var if you need higher quality on powerful hardware
      const crf = Number(process.env.FINAL_VIDEO_CRF || "23");
      // cpu-used: 5 = fast encoding (range 0–8 for VP9, 0–16 for VP8; higher = faster)
      const cpuUsed = Number(process.env.FINAL_VIDEO_CPU_USED || "5");
      // b:v 0 tells libvpx to use pure CRF mode (no bitrate cap)
      const outputOptions = ["-map [vout]", "-pix_fmt yuv420p"];

      if (codec === "vp9") {
        outputOptions.push("-c:v libvpx-vp9");
        outputOptions.push("-crf", String(crf), "-b:v", "0");
        outputOptions.push("-deadline", "good", "-cpu-used", String(cpuUsed));
      } else {
        // VP8: uses -crf with -b:v 0 for quality mode, -qmin/-qmax for bounds
        outputOptions.push("-c:v libvpx");
        outputOptions.push("-crf", String(crf), "-b:v", "0");
        outputOptions.push("-qmin", String(crf), "-qmax", String(crf + 6));
        outputOptions.push("-deadline", "good", "-cpu-used", String(cpuUsed));
      }

      if (audioInputIndexes.length > 0) {
        outputOptions.push("-map [aout]", "-c:a libopus", "-b:a 192k");
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

    await runPostProcessing(sessionId, participantVideos, tempDir);

  } catch (err) {
    console.error("❌ Finalize service failed:", {
      sessionId,
      status: err?.response?.status || err?.status || err?.statusCode || null,
      message: err?.message || String(err),
    });
  }
};

/**
 * Shared post-processing: transcript generation, .txt upload, and AI summary.
 */
async function runPostProcessing(sessionId, participantVideos) {
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
}