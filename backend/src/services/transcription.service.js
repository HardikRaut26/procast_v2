import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import Session from "../models/Session.js";
import Chunk from "../models/Chunk.js";
import User from "../models/User.js";
import { downloadFromB2 } from "../utils/b2.js";
import {
  dedupeOverlapSegments,
  crossSpeakerDedupe,
  filterLowConfidenceSegments,
  bucketSortSegments,
  resolveSpeakerConflicts,
  removeRepetitionSegments,
  buildGlobalTurnLines,
} from "./globalTranscriptMerge.js";

const getTranscriptionProvider = () => "huggingface";

const getTranscriptionModel = () => {
  return (
    process.env.HF_WHISPER_MODEL ||
    process.env.HUGGINGFACE_WHISPER_MODEL ||
    "openai/whisper-large-v3"
  );
};

const runWhisperHuggingFace = async (audioPath, { _skipSplit = false } = {}) => {
  const token = String(
    process.env.HF_TOKEN ||
      process.env.HUGGINGFACE_API_KEY ||
      process.env.HUGGINGFACEHUB_API_TOKEN ||
      ""
  ).trim();
  if (!token) {
    throw new Error(
      "Hugging Face transcription needs HF_TOKEN (or HUGGINGFACE_API_KEY)."
    );
  }

  const model = getTranscriptionModel();
  let endpoint =
    process.env.HF_ASR_ENDPOINT ||
    `https://api-inference.huggingface.co/models/${model}`;
  
  // Ensure endpoint is correct format
  if (!endpoint.includes("://")) {
    endpoint = `https://api-inference.huggingface.co/models/${endpoint}`;
  }
  
  const timeoutMs = Number(process.env.HF_TRANSCRIBE_TIMEOUT_MS || "600000");
  const language = String(process.env.WHISPER_LANGUAGE || "").trim();
  const stat = await fs.promises.stat(audioPath).catch(() => null);
  const body = fs.readFileSync(audioPath);
  const fileSizeMb =
    stat && Number.isFinite(stat.size)
      ? Math.round((stat.size / 1024 / 1024) * 10) / 10
      : null;
  const durationSec = await getWavDurationSeconds(audioPath).catch(() => null);
  console.log(
    `[HF-ASR] endpoint=${endpoint} model=${model} input=${fileSizeMb != null ? `${fileSizeMb}MB` : "unknown"} duration=${durationSec != null ? `${Math.round(durationSec * 10) / 10}s` : "unknown"}`
  );

  const splitSec = Number(process.env.HF_TRANSCRIBE_SPLIT_SEC || "45");
  if (!_skipSplit && durationSec != null && splitSec > 0 && durationSec > splitSec + 1) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procast-hf-asr-"));
    const segmentsOut = [];
    let idx = 0;
    for (let offset = 0; offset < durationSec; offset += splitSec) {
      const segLen = Math.min(splitSec, durationSec - offset);
      const segPath = path.join(tempDir, `seg-${idx}.wav`);
      await new Promise((resolve, reject) => {
        ffmpeg(audioPath)
          .noVideo()
          .audioFrequency(16000)
          .format("wav")
          .setStartTime(offset)
          .duration(segLen)
          .save(segPath)
          .on("end", resolve)
          .on("error", reject);
      });
      const segTranslated = await runWhisperHuggingFace(segPath, { _skipSplit: true }).catch((e) => {
        throw new Error(`HF segment ${idx} failed: ${e?.message || e}`);
      });
      for (const s of segTranslated) {
        segmentsOut.push({
          ...s,
          start: Number.isFinite(s.start) ? s.start + offset : offset,
          end: Number.isFinite(s.end) ? s.end + offset : offset + segLen,
        });
      }
      idx += 1;
    }
    return segmentsOut.sort((a, b) => (a.start || 0) - (b.start || 0));
  }

  const common = {
    headers: { Authorization: `Bearer ${token}` },
    timeout: timeoutMs,
    maxBodyLength: Infinity,
  };

  let data;
  let lastErr = null;
  const maxAttempts = Math.max(
    1,
    Number(process.env.HF_TRANSCRIBE_RETRY_ATTEMPTS || "4")
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // First try: raw audio bytes. This is the most broadly compatible path.
      const res = await axios.post(endpoint, body, {
        ...common,
        headers: { 
          ...common.headers, 
          "Content-Type": "audio/wav",
          "Accept": "application/json"
        },
        responseType: "json",
        validateStatus: () => true,
      });
      data = res.data;
      lastErr = null;
      break;
    } catch (jsonErr) {
      lastErr = jsonErr;
      const msg = String(jsonErr?.message || "").toLowerCase();
      const code = jsonErr?.code || "";
      const status = jsonErr?.response?.status;
      const retryable =
        msg.includes("socket hang up") ||
        msg.includes("ecconnreset") ||
        msg.includes("timeout") ||
        msg.includes("stream has been aborted") ||
        msg.includes("bad response") ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ERR_BAD_RESPONSE" ||
        (status && status >= 500);
      if (!retryable && attempt === maxAttempts - 1) {
        // Non-transient on last attempt: will try JSON payload fallback
        break;
      }
      const delay = Math.min(
        30000,
        1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500)
      );
      const details = [
        status != null ? `status=${status}` : null,
        code ? `code=${code}` : null,
      ].filter(Boolean);
      console.warn(
        `[HF-ASR] attempt ${attempt + 1}/${maxAttempts} failed (${msg || "error"}${details.length ? `; ${details.join(", ")}` : ""}); retrying in ${delay}ms`
      );
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (!data) {
    // One more attempt using JSON payload format, mainly for backends that require it.
    try {
      // Convert buffer to base64 for JSON payload
      const inputBase64 = body.toString("base64");
      const payload = {
        inputs: inputBase64,
        parameters: {
          return_timestamps: true,
          ...(language ? { language } : {}),
        },
        options: {
          wait_for_model: true,
          use_cache: false,
        },
      };
      const res = await axios.post(endpoint, payload, {
        headers: { 
          Authorization: `Bearer ${token}`, 
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        timeout: timeoutMs,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        responseType: "json",
      });
      data = res.data;
    } catch (fallbackErr) {
      // Keep original lastErr
      console.warn("[HF-ASR] JSON payload fallback also failed:", fallbackErr?.message);
    }
  }

  if (!data && lastErr) {
    throw lastErr;
  }

  if (data?.error) {
    const errorMsg = String(data.error || data.message || JSON.stringify(data));
    console.warn(`[HF-ASR] API returned error: ${errorMsg}`);
    if (!data.text && !Array.isArray(data.chunks)) {
      throw new Error(`Hugging Face API error: ${errorMsg}`);
    }
  }

  const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
  if (chunks.length > 0) {
    return chunks.map((c) => {
      const ts = Array.isArray(c?.timestamp) ? c.timestamp : [];
      return {
        text: String(c?.text || "").trim(),
        start: Number(ts[0]),
        end: Number(ts[1]),
      };
    });
  }

  const text = String(data?.text || "").trim();
  if (!text) return [];
  const duration = await getWavDurationSeconds(audioPath).catch(() => 1);
  return [{ text, start: 0, end: Math.max(0.5, duration) }];
};

const runWhisper = (audioPath) => runWhisperHuggingFace(audioPath);

const extractAudio = (inputVideo, outputAudio) => {
  const inPath = path.resolve(String(inputVideo));
  const outPath = path.resolve(String(outputAudio));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(inPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .audioFilter("highpass=f=100")
      .save(outPath)
      .on("end", resolve)
      .on("error", reject);
  });
};

const generateSilenceWav = async (outputAudio, durationSeconds) => {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const safeSeconds = Math.max(0, Number(durationSeconds) || 0);
  const numSamples = Math.floor(sampleRate * safeSeconds);
  const dataSize = numSamples * channels * bytesPerSample;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0); // ChunkID
  header.writeUInt32LE(36 + dataSize, 4); // ChunkSize
  header.write("WAVE", 8); // Format
  header.write("fmt ", 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(channels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // ByteRate
  header.writeUInt16LE(channels * bytesPerSample, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  header.write("data", 36); // Subchunk2ID
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  const silence = Buffer.alloc(dataSize); // already zeroed PCM
  await fs.promises.writeFile(outputAudio, Buffer.concat([header, silence]));
};

const getWavDurationSeconds = (audioPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      const d = metadata?.format?.duration;
      resolve(Number(d));
    });
  });
};

const median = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const normalizeWhisperSegments = (rawSegments, audioDurationSeconds) => {
  const duration =
    Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0
      ? audioDurationSeconds
      : null;

  const normalized = Array.isArray(rawSegments)
    ? rawSegments.map((s) => ({
        text: (s?.text || "").trim(),
        start: Number(s?.start),
        end: Number(s?.end),
        avgLogprob: Number(s?.avg_logprob),
      }))
    : [];

  const textOnly = normalized.filter((s) => s.text.length > 0);
  if (textOnly.length === 0) return [];

  const withFinite = textOnly.filter(
    (s) =>
      Number.isFinite(s.start) &&
      Number.isFinite(s.end) &&
      s.end >= s.start
  );

  const looksDegenerate = (() => {
    if (withFinite.length === 0) return true;
    const starts = withFinite.map((s) => s.start);
    const min = Math.min(...starts);
    const max = Math.max(...starts);
    return max - min < 0.01;
  })();

  if (looksDegenerate) {
    const n = textOnly.length;
    const total = duration || Math.max(1, n); // 1s/segment fallback
    return textOnly.map((s, idx) => {
      const start = (idx * total) / n;
      const end = ((idx + 1) * total) / n;
      return { ...s, start, end };
    });
  }

  return withFinite;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const downloadChunkWithRetry = async ({ fileId, downloadPath, attempts = 4 }) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await downloadFromB2({ fileId, downloadPath });
      return true;
    } catch (e) {
      lastErr = e;
      // Backoff: 300ms, 900ms, 1800ms, 3000ms
      const backoffMs = Math.min(3000, 300 * Math.pow(2, i));
      await sleep(backoffMs);
    }
  }
  throw lastErr || new Error("Chunk download failed");
};

const enforceMonotonicTranscriptTiming = (items) => {
  if (!Array.isArray(items) || items.length === 0) return items || [];

  // Keep current order (already closest to intended timeline), then enforce monotonic start/end.
  let cursor = 0;
  return items.map((t) => {
    const text = String(t?.text || "").trim();
    const words = text ? text.split(/\s+/).length : 1;
    const estimatedDuration = Math.min(8, Math.max(0.8, words * 0.35));

    let start = Number(t?.start);
    let end = Number(t?.end);

    if (!Number.isFinite(start) || start < cursor) start = cursor;
    if (!Number.isFinite(end) || end <= start) end = start + estimatedDuration;

    cursor = end + 0.01;
    return {
      ...t,
      start,
      end,
    };
  });
};

const findNearestWindowIndex = (windows, mid) => {
  if (!Array.isArray(windows) || windows.length === 0) return 0;
  let lo = 0;
  let hi = windows.length;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (windows[m].start <= mid) lo = m + 1;
    else hi = m;
  }
  const left = Math.max(0, lo - 1);
  const right = Math.min(windows.length - 1, left + 1);
  const dL = Math.abs(windows[left].mid - mid);
  const dR = Math.abs(windows[right].mid - mid);
  return dL <= dR ? left : right;
};

const normalizeForMatch = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTokenSet = (text) => {
  const tokens = normalizeForMatch(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return new Set(tokens);
};

const overlapScore = (aSet, bSet) => {
  if (!aSet || !bSet || aSet.size === 0 || bSet.size === 0) return 0;
  let common = 0;
  for (const t of aSet) {
    if (bSet.has(t)) common += 1;
  }
  return common / Math.max(1, aSet.size);
};

const alignTranscriptToFinalMeetingTimeline = async (session, transcript) => {
  if (
    !session?.finalMeetingFileId ||
    !Array.isArray(transcript) ||
    transcript.length === 0
  ) {
    return transcript;
  }

  try {
    const distinctSpeakers = new Set(
      transcript.map((t) => String(t?.speaker || "").trim()).filter(Boolean)
    );
    if (distinctSpeakers.size >= 2) {
      console.log(`[ALIGN] Multi-speaker call (${distinctSpeakers.size} speakers) — skipping alignment (timestamps should be relative to merge)`);
      return transcript;
    }

    // Only align when timestamps look degenerate (e.g. many start times are ~0 or identical).
    const starts = transcript
      .map((t) => Number(t?.start))
      .filter((n) => Number.isFinite(n));
    const uniqueStartCount = new Set(
      starts.map((s) => Math.round(s * 10) / 10)
    ).size;
    const shouldAlign =
      uniqueStartCount <= Math.max(3, Math.floor(transcript.length / 3));
    if (!shouldAlign) {
      console.log(`[ALIGN] Transcript has good unique timestamps (${uniqueStartCount}/${transcript.length}) — skipping alignment`);
      return transcript;
    }
    console.log(`[ALIGN] Attempting to remap single-speaker transcript to final video timeline...`);

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "procast-align-")
    );
    const finalWebmPath = path.join(tempDir, "final-meeting.webm");
    const finalWavPath = path.join(tempDir, "final-meeting.wav");

    await downloadFromB2({
      fileId: session.finalMeetingFileId,
      downloadPath: finalWebmPath,
    });

    await extractAudio(finalWebmPath, finalWavPath);

    const globalAudioDuration = await getWavDurationSeconds(finalWavPath).catch(
      () => NaN
    );
    const globalRawSegments = await runWhisper(finalWavPath);
    const globalSegments = normalizeWhisperSegments(
      globalRawSegments,
      globalAudioDuration
    );
    const windows = globalSegments
      .filter(
        (s) =>
          (s?.text || "").length > 0 &&
          Number.isFinite(s.start) &&
          Number.isFinite(s.end) &&
          s.end >= s.start
      )
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((s) => ({
        start: s.start,
        end: s.end,
        mid: (s.start + s.end) / 2,
        text: s.text || "",
        tokens: toTokenSet(s.text || ""),
      }));

    if (!windows.length) return transcript;

    const counters = new Map(); // windowIndex -> how many transcript items already mapped
    let cursor = 0;

    for (const t of transcript) {
      const mid = (Number(t?.start) + Number(t?.end)) / 2;
      const targetMid = Number.isFinite(mid) ? mid : windows[Math.min(cursor, windows.length - 1)].mid;
      const tTokens = toTokenSet(t?.text || "");

      // Search forward window to keep conversation order monotonic.
      const start = Math.min(cursor, windows.length - 1);
      const end = Math.min(windows.length - 1, start + 40);
      let bestIdx = start;
      let bestScore = -1;
      let bestMidDist = Number.POSITIVE_INFINITY;

      for (let i = start; i <= end; i++) {
        const s = overlapScore(tTokens, windows[i].tokens);
        const d = Math.abs(windows[i].mid - targetMid);
        if (s > bestScore || (s === bestScore && d < bestMidDist)) {
          bestScore = s;
          bestMidDist = d;
          bestIdx = i;
        }
      }

      // If text match is weak, fall back to nearest timestamp from current cursor.
      let idx = bestIdx;
      if (bestScore < 0.15) {
        const nearestGlobal = findNearestWindowIndex(windows, targetMid);
        idx = Math.max(start, nearestGlobal);
      }

      cursor = idx;
      const count = counters.get(idx) || 0;
      counters.set(idx, count + 1);
      const eps = count * 0.001; // seconds

      t.start = windows[idx].start + eps;
      t.end = Math.max(windows[idx].end + eps, t.start + 0.05);
    }

    return transcript;
  } catch (err) {
    // Non-blocking: transcript ordering fix is best-effort.
    console.warn(
      "⚠️ Timeline alignment skipped (non-blocking) due to error:",
      err?.message || err
    );
    return transcript;
  }
};

const validateTranscriptTimings = (transcript, maxDurationSec) => {
  if (!Array.isArray(transcript) || !Number.isFinite(maxDurationSec)) return transcript;

  let clamped = 0;
  const result = transcript.map((item) => {
    let start = Number(item?.start);
    let end = Number(item?.end);
    let wasClamped = false;

    // Clamp to valid range [0, maxDurationSec]
    if (!Number.isFinite(start) || start < 0) {
      start = 0;
      wasClamped = true;
    }
    if (!Number.isFinite(end) || end > maxDurationSec) {
      end = Math.min(maxDurationSec, Math.max(start + 0.2, end));
      wasClamped = true;
    }
    if (end <= start) {
      end = start + 0.2;
      wasClamped = true;
    }

    if (wasClamped) clamped++;
    return { ...item, start, end };
  });

  if (clamped > 0) {
    console.log(`[VALIDATE] Clamped ${clamped}/${transcript.length} items to [0, ${maxDurationSec.toFixed(2)}]s`);
  }
  return result;
};

const chunkOffsetSeconds = (chunk, defaultChunkMs) => {
  // startTimeMs is now per-user relative (0 when they started recording)
  if (
    chunk?.startTimeMs != null &&
    Number.isFinite(chunk.startTimeMs) &&
    chunk.startTimeMs >= 0
  ) {
    return chunk.startTimeMs / 1000;
  }
  // Fallback: use chunkIndex (chunk 1 → 0s, chunk 2 → 5s, etc.)
  const idx = Number(chunk?.chunkIndex) || 1;
  return ((idx - 1) * defaultChunkMs) / 1000;
};

async function downloadChunksToCombinedWebm(chunks, speakerTempDir, combinedWebmPath) {
  const ws = fs.createWriteStream(combinedWebmPath);
  for (const chunk of chunks) {
    const chunkIndex = String(chunk.chunkIndex);
    const partPath = path.join(
      speakerTempDir,
      `chunk-${chunkIndex.padStart(6, "0")}.part`
    );
    await downloadChunkWithRetry({
      fileId: chunk.b2FileId,
      downloadPath: partPath,
      attempts: Number(process.env.B2_DOWNLOAD_RETRY_ATTEMPTS || "4"),
    });
    ws.write(fs.readFileSync(partPath));
  }
  ws.end();
  await new Promise((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
}

async function whisperRawSegmentsFromWav(audioPath) {
  const rawSegments = await runWhisper(audioPath);
  const speakerAudioDuration = await getWavDurationSeconds(audioPath).catch(() => NaN);
  return normalizeWhisperSegments(rawSegments, speakerAudioDuration);
}

export const generateTranscript = async (sessionId, participantVideos) => {
  try {
    const session = await Session.findById(sessionId).populate("participants", "name");

    if (!session) {
      console.log("Session not found for transcription");
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procast-transcript-"));

    const whisperProvider = getTranscriptionProvider();
    const whisperModel = getTranscriptionModel();
    const whisperLanguage = process.env.WHISPER_LANGUAGE || "";
    const whisperTask = process.env.WHISPER_TASK || "transcribe";
    console.log(
      `[TRANSCRIBE] provider=${whisperProvider} model=${whisperModel} task=${whisperTask}`
    );
    const defaultChunkMs =
      Math.round((Number(process.env.MEDIA_CHUNK_DURATION_SECONDS || "5") || 5) * 1000) ||
      5000;

    await Session.findByIdAndUpdate(sessionId, {
      transcriptionStatus: "RUNNING",
      transcriptionMeta: {
        provider: whisperProvider,
        model: whisperModel,
        language: whisperLanguage || null,
        task: whisperTask,
        generatedAt: null,
        totalParticipants: Array.isArray(participantVideos) ? participantVideos.length : 0,
        succeededParticipants: 0,
        failedParticipants: 0,
      },
    });

    let succeededParticipants = 0;
    let failedParticipants = 0;

    const uidList = [
      ...new Set(
        (participantVideos || []).map((p) =>
          String(p.userId?._id ?? p.userId ?? "")
        )
      ),
    ].filter(Boolean);
    const usersById = new Map();
    if (uidList.length) {
      const found = await User.find({ _id: { $in: uidList } }).select("name").lean();
      for (const u of found) {
        usersById.set(String(u._id), u.name || "Unknown");
      }
    }

    /** Raw Whisper segments with global `start`/`end` (seconds) */
    const globalRawSegments = [];

    for (const participant of participantVideos) {
      const { userId, videoPath } = participant;

      const uid = String(userId?._id ?? userId);
      const fromSession = session.participants.find((p) => String(p._id) === uid);
      const speakerName = fromSession?.name || usersById.get(uid) || "Unknown";
      const chunks = await Chunk.find({ sessionId, userId }).sort({ chunkIndex: 1 });

      // Short temp dir names — Windows + ffmpeg are happier than long userId paths.
      const speakerTempDir = fs.mkdtempSync(path.join(tempDir, "sp-"));

      let speakerOk = false;

      if (chunks.length) {
        try {
          const combinedWebmPath = path.join(speakerTempDir, "combined.webm");
          await downloadChunksToCombinedWebm(chunks, speakerTempDir, combinedWebmPath);
          const audioPath = path.join(speakerTempDir, "full.wav");
          await extractAudio(combinedWebmPath, audioPath);
          console.log("[TRANSCRIBE] combined chunks + Whisper:", speakerName);
          const segments = await whisperRawSegmentsFromWav(audioPath);
          const offsetSec = chunkOffsetSeconds(chunks[0], defaultChunkMs);
          console.log(`[TRANSCRIBE] ${speakerName}: ${segments.length} segments, offset=${offsetSec.toFixed(2)}s (chunkIndex=${chunks[0].chunkIndex}, startTimeMs=${chunks[0].startTimeMs})`);
          let segmentStartMin = Infinity, segmentStartMax = -Infinity;
          for (const seg of segments) {
            const start = seg.start + offsetSec;
            const end = seg.end + offsetSec;
            segmentStartMin = Math.min(segmentStartMin, start);
            segmentStartMax = Math.max(segmentStartMax, end);
            globalRawSegments.push({
              speaker: speakerName,
              text: seg.text,
              start,
              end,
            });
          }
          if (segments.length > 0) {
            console.log(`  → Timeline: ${segmentStartMin.toFixed(2)}s–${segmentStartMax.toFixed(2)}s`);
          }
          speakerOk = true;
          succeededParticipants += 1;
        } catch (combinedErr) {
          console.warn(
            `⚠️ Chunk-merged transcription failed for ${speakerName}:`,
            combinedErr?.message || combinedErr
          );
        }
      } else {
        console.warn(
          `⚠️ No chunks for user ${userId}, falling back to participant rebuilt video`
        );
      }

      if (!speakerOk) {
        const fallbackOffsetSec = 0;
        const audioPath = path.join(tempDir, `${userId}.wav`);
        try {
          await extractAudio(videoPath, audioPath);
          console.log("Running Whisper (participant video fallback):", speakerName);
          const segments = await whisperRawSegmentsFromWav(audioPath);
          for (const seg of segments) {
            globalRawSegments.push({
              speaker: speakerName,
              text: seg.text,
              start: seg.start + fallbackOffsetSec,
              end: seg.end + fallbackOffsetSec,
            });
          }
          succeededParticipants += 1;
        } catch (fallbackErr) {
          failedParticipants += 1;
          console.warn(
            `⚠️ Fallback transcription failed for speaker=${speakerName} userId=${userId}`,
            fallbackErr?.message || fallbackErr
          );
        }
      }
    }

    globalRawSegments.sort(
      (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
    );

    const rawMinStart = globalRawSegments.length > 0 ? Math.min(...globalRawSegments.map(s => s.start || 0)) : 0;
    const rawMaxEnd = globalRawSegments.length > 0 ? Math.max(...globalRawSegments.map(s => s.end || 0)) : 0;
    console.log(`[TRANSCRIBE] Raw segments: ${globalRawSegments.length} items spanning [${rawMinStart.toFixed(2)}s, ${rawMaxEnd.toFixed(2)}s]`);

    const confidenceClean = filterLowConfidenceSegments(
      globalRawSegments,
      Number(process.env.WHISPER_MIN_AVG_LOGPROB || "-1.0")
    );
    const overlapClean = dedupeOverlapSegments(confidenceClean);
    const crossClean = crossSpeakerDedupe(overlapClean);
    const conflictResolved = resolveSpeakerConflicts(crossClean);
    const repetitionClean = removeRepetitionSegments(conflictResolved);
    const bucketed = bucketSortSegments(
      repetitionClean,
      Number(process.env.TRANSCRIPT_BUCKET_SEC || "0.5")
    );
    let lineItems = buildGlobalTurnLines(bucketed);

    lineItems = await alignTranscriptToFinalMeetingTimeline(session, lineItems);

    lineItems.sort(
      (a, b) =>
        (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
    );

    // Do not enforce artificial monotonic times — that drifts away from real audio
    // and breaks seeking in the final video. Opt-in: TRANSCRIPT_ENFORCE_MONOTONIC=true
    const fixedTranscript =
      process.env.TRANSCRIPT_ENFORCE_MONOTONIC === "true"
        ? enforceMonotonicTranscriptTiming(lineItems)
        : lineItems;

    await Session.findByIdAndUpdate(sessionId, {
      transcript: fixedTranscript,
      transcriptionStatus:
        failedParticipants === 0 && succeededParticipants > 0
          ? "SUCCEEDED"
          : succeededParticipants > 0
            ? "PARTIAL"
            : "FAILED",
      transcriptionMeta: {
        provider: whisperProvider,
        model: whisperModel,
        language: whisperLanguage || null,
        task: whisperTask,
        generatedAt: new Date(),
        totalParticipants: Array.isArray(participantVideos) ? participantVideos.length : 0,
        succeededParticipants,
        failedParticipants,
      },
    });

    const minStart = fixedTranscript.length > 0 ? Math.min(...fixedTranscript.map(t => Number(t?.start) || 0)) : 0;
    const maxEnd = fixedTranscript.length > 0 ? Math.max(...fixedTranscript.map(t => Number(t?.end) || 0)) : 0;
    console.log(`✅ Transcript finalized: ${fixedTranscript.length} items spanning [${minStart.toFixed(2)}s, ${maxEnd.toFixed(2)}s]`);
    return fixedTranscript.length > 0;
  } catch (err) {
    console.error("Transcription failed:", err);
    await Session.findByIdAndUpdate(sessionId, {
      transcriptionStatus: "FAILED",
      transcriptionMeta: {
        provider: getTranscriptionProvider(),
        model: getTranscriptionModel(),
        language: process.env.WHISPER_LANGUAGE || null,
        task: process.env.WHISPER_TASK || "transcribe",
        generatedAt: new Date(),
        totalParticipants: Array.isArray(participantVideos) ? participantVideos.length : 0,
        succeededParticipants: 0,
        failedParticipants: Array.isArray(participantVideos) ? participantVideos.length : 0,
      },
    }).catch(() => {});
    return false;
  }

};