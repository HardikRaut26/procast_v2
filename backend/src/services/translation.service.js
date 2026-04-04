import axios from "axios";
import { createHash } from "crypto";
import TranslationCache from "../models/TranslationCache.js";

function normalizeLang(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw || raw === "original" || raw === "auto") return "original";
  return raw;
}

/** For API: skip calling translation at all */
export function skipTranslation(targetLanguage) {
  return normalizeLang(targetLanguage) === "original";
}

/** Hash source text for cache lookup */
function hashSourceText(text) {
  return createHash("sha256").update(text || "").digest("hex");
}

/** Check if translation exists in cache */
async function getCachedTranslation(sourceText, targetLanguage) {
  if (!sourceText || normalizeLang(targetLanguage) === "original") {
    return null;
  }
  try {
    const hash = hashSourceText(sourceText);
    const cached = await TranslationCache.findOne({
      sourceHash: hash,
      targetLanguage: normalizeLang(targetLanguage),
    });
    if (cached) {
      console.log(
        `[translate] Cache HIT for "${sourceText.slice(0, 30)}..." → ${normalizeLang(targetLanguage)}`
      );
      return cached.translatedText;
    }
  } catch (err) {
    console.warn("[translate] Cache lookup failed:", err.message);
  }
  return null;
}

/** Save translation to cache */
async function saveCacheTranslation(sourceText, targetLanguage, translatedText, provider = "original") {
  if (!sourceText || normalizeLang(targetLanguage) === "original") {
    return;
  }
  try {
    const hash = hashSourceText(sourceText);
    const lang = normalizeLang(targetLanguage);
    await TranslationCache.findOneAndUpdate(
      { sourceHash: hash, targetLanguage: lang },
      {
        sourceHash: hash,
        sourceText,
        targetLanguage: lang,
        translatedText,
        provider,
      },
      { upsert: true, new: true }
    );
    console.log(
      `[translate] Cached "${sourceText.slice(0, 30)}..." via ${provider}`
    );
  } catch (err) {
    console.warn("[translate] Cache save failed:", err.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let translateGate = Promise.resolve();

function runTranslationSerialized(fn) {
  const run = translateGate.then(() => fn());
  translateGate = run.then(
    () => {},
    () => {}
  );
  return run;
}

function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (raw == null) return null;
  const sec = Number(raw);
  if (Number.isFinite(sec)) {
    return Math.min(180000, Math.max(2000, Math.round(sec * 1000)));
  }
  return null;
}

function geminiBackoffMs(status, attempt, responseHeaders) {
  const fromHeader = parseRetryAfterMs(responseHeaders);
  if (fromHeader != null) return fromHeader;
  if (status === 429) {
    const base = Number(process.env.GEMINI_TRANSLATE_429_BASE_MS || "8000");
    return Math.min(
      Number(process.env.GEMINI_TRANSLATE_429_MAX_MS || "120000"),
      base * Math.pow(1.9, attempt)
    );
  }
  if (status === 503 || status === 502 || status === 500) {
    // Server errors: back off more aggressively to avoid hammering overloaded service
    const base = Number(process.env.GEMINI_TRANSLATE_503_BASE_MS || "15000");
    return Math.min(
      Number(process.env.GEMINI_TRANSLATE_503_MAX_MS || "180000"),
      base * Math.pow(2.0, attempt)
    );
  }
  return Math.min(35000, 2000 * Math.pow(1.65, attempt));
}

/** Free-tier Gemini errors often include "Please retry in 49.36s" — honor it or we never recover. */
function parseGeminiSuggestedRetryMs(err) {
  const parts = [];
  const d = err?.response?.data;
  if (typeof d === "string") parts.push(d);
  else if (d && typeof d === "object") {
    const detailStr = Array.isArray(d.error?.details)
      ? d.error.details
          .map((x) => x?.description || x?.message || "")
          .filter(Boolean)
          .join(" ")
      : "";
    parts.push(d.error?.message, detailStr, JSON.stringify(d));
  }
  parts.push(String(err?.message || ""));
  const text = parts.filter(Boolean).join(" ");
  const m = text.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s\b/i);
  if (!m) return null;
  const sec = parseFloat(m[1]);
  if (!Number.isFinite(sec) || sec < 0) return null;
  const cap = Number(process.env.GEMINI_RETRY_HINT_MAX_MS || "150000");
  return Math.min(cap, Math.max(1500, Math.ceil(sec * 1000) + 800));
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function extractJsonArrayFromText(raw) {
  const s = String(raw || "").trim();
  let parsed = safeJsonParse(s);
  if (Array.isArray(parsed)) return parsed;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    parsed = safeJsonParse(fence[1].trim());
    if (Array.isArray(parsed)) return parsed;
  }
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) {
    parsed = safeJsonParse(s.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
  }
  return null;
}

function buildBatchArrayPrompt({ strings, targetLanguage }) {
  const n = strings.length;
  return `You translate meeting transcript segments.

Target language: "${targetLanguage}"

Rules:
- Preserve meaning and tone.
- Keep proper names, product names, and technical terms when natural.
- Output MUST be valid JSON only.

Input is a JSON array of exactly ${n} strings.

Return ONLY a JSON array of exactly ${n} translated strings in the same order. Each output element translates the input element at the same index.

Input:
${JSON.stringify(strings)}`;
}

async function callGeminiJsonArray({
  prompt,
  apiKey,
  model,
  timeoutMs,
  maxAttempts,
}) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await axios.post(endpoint, body, { timeout: timeoutMs });
      const content =
        res?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = safeJsonParse(content);
      if (!Array.isArray(parsed)) {
        throw new Error("Gemini returned non-array JSON");
      }
      return parsed.map((x) => String(x ?? ""));
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const retryable =
        status === 429 || status === 503 || status === 502 || status === 500;
      // For 503/502/500 errors, only retry once (fail faster to avoid hammering overloaded service)
      const isServerError = status === 503 || status === 502 || status === 500;
      const shouldRetry = retryable && attempt < maxAttempts - 1 && (!isServerError || attempt === 0);
      if (shouldRetry) {
        let delay = Math.round(
          geminiBackoffMs(status, attempt, e?.response?.headers)
        );
        const hint = parseGeminiSuggestedRetryMs(e);
        if (hint != null) delay = Math.max(delay, hint);
        delay += Math.floor(Math.random() * 1500);
        console.warn(
          `[translate] Gemini batch HTTP ${status}, retry ${attempt + 1}/${maxAttempts} in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini batch failed");
}

async function translateStringSliceGemini({
  strings,
  targetLanguage,
  geminiModelCandidates,
  apiKey,
  maxAttempts: maxAttemptsArg,
}) {
  const prompt = buildBatchArrayPrompt({ strings, targetLanguage });
  const timeoutMs = Number(process.env.GEMINI_TRANSLATE_TIMEOUT_MS || "120000");
  const maxAttempts = Math.max(
    1,
    maxAttemptsArg ??
      Number(process.env.GEMINI_TRANSLATE_RETRY_ATTEMPTS || "2")
  );

  let lastErr = null;
  for (const model of geminiModelCandidates) {
    try {
      const out = await callGeminiJsonArray({
        prompt,
        apiKey,
        model,
        timeoutMs,
        maxAttempts,
      });
      if (out.length !== strings.length) {
        throw new Error(
          `Length mismatch: expected ${strings.length}, got ${out.length}`
        );
      }
      return out;
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      if (status === 404) {
        console.warn(`[translate] Gemini model not found: ${model}, trying next`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini translate failed for all models");
}

async function translateStringSliceOpenAIRobust(
  strings,
  targetLanguage,
  model,
  apiKey
) {
  const prompt = buildBatchArrayPrompt({ strings, targetLanguage });
  const userContent = `${prompt}\n\nReturn JSON with key "items": string[] of length ${strings.length}.`;

  const doRequest = async (useJsonObjectMode) => {
    const body = {
      model,
      temperature: 0.1,
      messages: [{ role: "user", content: userContent }],
    };
    if (useJsonObjectMode) {
      body.response_format = { type: "json_object" };
    }
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      body,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );
    const content = res?.data?.choices?.[0]?.message?.content || "";
    let arr = extractJsonArrayFromText(content);
    if (!arr) {
      const parsed = safeJsonParse(content);
      arr = Array.isArray(parsed) ? parsed : parsed?.items;
    }
    if (!Array.isArray(arr) || arr.length !== strings.length) {
      throw new Error(
        `OpenAI returned wrong array length (want ${strings.length}, got ${arr?.length ?? 0})`
      );
    }
    return arr.map((x) => String(x ?? ""));
  };

  try {
    return await doRequest(true);
  } catch (e) {
    const status = e?.response?.status;
    const errMsg = String(
      e?.response?.data?.error?.message || e?.message || ""
    ).toLowerCase();
    if (
      status === 400 &&
      (errMsg.includes("response_format") ||
        errMsg.includes("json_schema") ||
        errMsg.includes("json mode"))
    ) {
      return doRequest(false);
    }
    throw e;
  }
}


function buildProviderOpts() {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openAiKey =
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";

  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const geminiCandidates = [
    geminiModel,
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
  ].filter(Boolean);
  const uniqueGemini = [...new Set(geminiCandidates.map((m) => String(m).trim()))];

  const openAiModel =
    process.env.OPENAI_TRANSLATE_MODEL ||
    process.env.OPENAI_SUMMARY_MODEL ||
    "gpt-4o-mini";

  return {
    geminiKey,
    openAiKey: openAiKey.trim() || null,
    uniqueGemini,
    openAiModel,
  };
}

async function translateOneBatch(slice, targetLanguage, opts) {
  const {
    geminiKey,
    openAiKey,
    uniqueGemini,
    openAiModel,
  } = opts;

  const explicit = String(process.env.AI_TRANSLATE_PROVIDER || "")
    .toLowerCase()
    .trim();

  /** @type {{ name: string, run: () => Promise<string[]> }[]} */
  const all = [];

  if (openAiKey) {
    all.push({
      name: "openai",
      run: () =>
        translateStringSliceOpenAIRobust(
          slice,
          targetLanguage,
          openAiModel,
          openAiKey
        ),
    });
  }

  if (geminiKey) {
    const geminiQuick = !openAiKey
      ? Math.max(1, Number(process.env.GEMINI_TRANSLATE_QUICK_ATTEMPTS || "2"))
      : Math.max(1, Number(process.env.GEMINI_TRANSLATE_RETRY_ATTEMPTS || "2"));
    all.push({
      name: "gemini",
      run: () =>
        translateStringSliceGemini({
          strings: slice,
          targetLanguage,
          geminiModelCandidates: uniqueGemini,
          apiKey: geminiKey,
          maxAttempts: geminiQuick,
        }),
    });
  }

  let chain = all;
  if (explicit === "openai") {
    chain = all.filter((x) => x.name === "openai");
  } else if (explicit === "gemini") {
    chain = all.filter((x) => x.name === "gemini");
  } else {
    // Prefer Gemini (free tier) when configured, fallback to OpenAI
    const order = ["gemini", "openai"];
    chain = order
      .map((n) => all.find((x) => x.name === n))
      .filter(Boolean);
  }

  if (chain.length === 0) {
    return slice;
  }

  let lastErr = null;
  for (const { name, run } of chain) {
    try {
      const out = await run();
      if (name !== chain[0].name) {
        console.warn(`[translate] Batch succeeded via ${name}`);
      }
      return out;
    } catch (e) {
      const st = e?.response?.status;
      const brief =
        e?.response?.data?.error?.message ||
        e?.message ||
        String(st || "error");
      console.warn(`[translate] ${name} failed (${st || "n/a"}):`, brief);
      lastErr = e;
    }
  }

  throw lastErr || new Error("All translation providers failed");
}

async function translateStringsBatchedImpl(strings, targetLanguage) {
  const opts = buildProviderOpts();

  const defaultBatch =
    opts.geminiKey && !opts.openAiKey ? "12" : opts.geminiKey ? "12" : "16";
  const batchSize = Math.max(
    1,
    Math.min(80, Number(process.env.TRANSLATION_BATCH_SIZE || defaultBatch))
  );

  const defaultInter =
    process.env.TRANSLATION_INTER_BATCH_DELAY_MS != null
      ? Number(process.env.TRANSLATION_INTER_BATCH_DELAY_MS)
      : opts.geminiKey
        ? 700
        : 150;
  const interBatchDelay = Math.max(0, defaultInter);

  const results = [];
  for (let i = 0; i < strings.length; i += batchSize) {
    if (i > 0 && interBatchDelay > 0) {
      await sleep(interBatchDelay);
    }
    const slice = strings.slice(i, i + batchSize);

    // Check cache for each string in this batch
    const sliceWithCache = await Promise.all(
      slice.map(async (str) => {
        const cached = await getCachedTranslation(str, targetLanguage);
        return { str, cached };
      })
    );

    // Separate cached from uncached
    const uncached = sliceWithCache
      .map((item, idx) => ({ ...item, originalIdx: idx }))
      .filter((item) => !item.cached);
    const cachedItems = sliceWithCache.filter((item) => item.cached);

    // If all are cached, use them
    if (uncached.length === 0) {
      results.push(
        ...sliceWithCache.map((item) => item.cached || item.str)
      );
      continue;
    }

    // Translate only uncached strings
    let translatedUncached = [];
    try {
      const uncachedStrs = uncached.map((item) => item.str);
      translatedUncached = await translateOneBatch(uncachedStrs, targetLanguage, opts);

      // Save each translation to cache
      for (let j = 0; j < uncachedStrs.length; j++) {
        await saveCacheTranslation(
          uncachedStrs[j],
          targetLanguage,
          translatedUncached[j],
          "openai or gemini"
        );
      }
    } catch (e) {
      console.warn(
        `[translate] Batch at offset ${i} exhausted all providers; keeping originals`
      );
      translatedUncached = uncached.map((item) => item.str);
    }

    // Merge cached + translated results in original order
    const mergedResults = new Array(slice.length);
    let uncachedIdx = 0;
    for (let j = 0; j < sliceWithCache.length; j++) {
      if (sliceWithCache[j].cached) {
        mergedResults[j] = sliceWithCache[j].cached;
      } else {
        mergedResults[j] = translatedUncached[uncachedIdx++];
      }
    }
    results.push(...mergedResults);
  }
  return results;
}

function translateStringsBatched(strings, targetLanguage) {
  return runTranslationSerialized(() =>
    translateStringsBatchedImpl(strings, targetLanguage)
  );
}

export async function translateText(text, targetLanguage) {
  const normalizedTarget = normalizeLang(targetLanguage);
  const source = String(text || "");
  if (!source || normalizedTarget === "original") return source;

  // Check cache first
  const cached = await getCachedTranslation(source, normalizedTarget);
  if (cached) return cached;

  const arr = await translateStringsBatched([source], normalizedTarget);
  const result = arr[0] ?? source;

  // Save to cache after successful translation
  await saveCacheTranslation(source, normalizedTarget, result, "openai or gemini");

  return result;
}

export async function translateTranscriptAndSummary({
  transcript,
  meetingSummary,
  targetLanguage,
}) {
  const lang = normalizeLang(targetLanguage);
  if (lang === "original") {
    return {
      transcript: transcript || [],
      meetingSummary: meetingSummary || null,
      language: "original",
      translated: false,
    };
  }

  const opts = buildProviderOpts();
  if (!opts.openAiKey && !opts.geminiKey) {
    return {
      transcript: transcript || [],
      meetingSummary: meetingSummary || null,
      language: lang,
      translated: false,
      translationError:
        "No translation backend configured. Set OPENAI_API_KEY or GEMINI_API_KEY environment variables.",
    };
  }

  let translationError = null;

  const items = Array.isArray(transcript) ? transcript : [];
  const sourceTexts = items.map((t) => String(t?.text ?? ""));
  let translatedTexts;
  try {
    translatedTexts = await translateStringsBatched(sourceTexts, lang);
    const anyOriginal = translatedTexts.some(
      (t, i) => t === sourceTexts[i] && sourceTexts[i].length > 0
    );
    if (
      sourceTexts.some((s) => s.length > 0) &&
      translatedTexts.every((t, i) => t === sourceTexts[i])
    ) {
      translationError =
        "Translation did not run: APIs returned quota errors (429) or all providers failed. " +
        "Fix OpenAI/Gemini billing and wait for rate limits to reset. " +
        "See server logs for details.";
    }
  } catch (e) {
    translationError = e?.message || "Translation failed";
    translatedTexts = sourceTexts;
  }

  const translatedTranscript = items.map((t, idx) => ({
    ...t,
    text: translatedTexts[idx] ?? sourceTexts[idx],
  }));

  let translatedSummary = meetingSummary || null;
  if (meetingSummary) {
    try {
      const kp = (meetingSummary.key_points || []).map((x) => String(x ?? ""));
      const dec = (meetingSummary.decisions || []).map((x) => String(x ?? ""));
      const tasks = (meetingSummary.action_items || []).map((a) =>
        String(a?.task ?? "")
      );

      const summaryOut = await translateText(meetingSummary.summary || "", lang);
      const keyOut = kp.length ? await translateStringsBatched(kp, lang) : [];
      const decOut = dec.length ? await translateStringsBatched(dec, lang) : [];
      const tasksOut = tasks.length
        ? await translateStringsBatched(tasks, lang)
        : [];

      translatedSummary = {
        ...meetingSummary,
        summary: summaryOut,
        key_points: meetingSummary.key_points?.length
          ? keyOut
          : meetingSummary.key_points,
        decisions: meetingSummary.decisions?.length
          ? decOut
          : meetingSummary.decisions,
        action_items: (meetingSummary.action_items || []).map((a, idx) => ({
          ...a,
          task: tasksOut[idx] ?? a?.task ?? "",
        })),
      };
    } catch (e) {
      if (!translationError) {
        translationError = `Summary translation: ${e?.message || e}`;
      }
      translatedSummary = meetingSummary;
    }
  }

  return {
    transcript: translatedTranscript,
    meetingSummary: translatedSummary,
    language: lang,
    translated: !translationError,
    ...(translationError ? { translationError } : {}),
  };
}

/** Get translation cache statistics */
export async function getCacheStats() {
  try {
    const totalCached = await TranslationCache.countDocuments();
    const byLanguage = await TranslationCache.aggregate([
      {
        $group: {
          _id: "$targetLanguage",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);
    const byProvider = await TranslationCache.aggregate([
      {
        $group: {
          _id: "$provider",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);
    return {
      totalCached,
      byLanguage: Object.fromEntries(byLanguage.map((x) => [x._id, x.count])),
      byProvider: Object.fromEntries(byProvider.map((x) => [x._id, x.count])),
    };
  } catch (err) {
    console.warn("[translate] Cache stats error:", err.message);
    return null;
  }
}
