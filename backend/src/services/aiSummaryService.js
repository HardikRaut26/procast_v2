import axios from "axios";

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeSummary(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    summary: String(obj.summary || "").trim(),
    key_points: Array.isArray(obj.key_points)
      ? obj.key_points.map((s) => String(s).trim()).filter(Boolean)
      : [],
    action_items: Array.isArray(obj.action_items)
      ? obj.action_items
          .map((a) => ({
            owner: String(a?.owner || "").trim(),
            task: String(a?.task || "").trim(),
          }))
          .filter((a) => a.owner || a.task)
      : [],
    decisions: Array.isArray(obj.decisions)
      ? obj.decisions.map((s) => String(s).trim()).filter(Boolean)
      : [],
  };
}

function chunkText(text, maxChars = 9000) {
  const t = String(text || "");
  if (t.length <= maxChars) return [t];
  const out = [];
  let i = 0;
  while (i < t.length) {
    out.push(t.slice(i, i + maxChars));
    i += maxChars;
  }
  return out;
}

async function callOpenAIJson({ transcriptText, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const prompt = `You are an AI meeting assistant.

Analyze the meeting transcript and return ONLY valid JSON in this exact shape:
{
  "summary": "short paragraph",
  "key_points": ["..."],
  "action_items": [{"owner": "Name", "task": "Task"}],
  "decisions": ["..."]
}

Rules:
- Keep key_points/action_items/decisions concise.
- If unknown owner, use "Unassigned".
- Do not include any extra keys.

Transcript:
${transcriptText}`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  const content = res?.data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);
  const normalized = normalizeSummary(parsed);
  if (!normalized) {
    throw new Error("OpenAI did not return valid JSON summary");
  }
  return normalized;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OLLAMA_SUMMARY_PROMPT = `You are an AI meeting assistant.

Analyze the meeting transcript and return ONLY valid JSON in this exact shape:
{
  "summary": "short paragraph",
  "key_points": ["..."],
  "action_items": [{"owner": "Name", "task": "Task"}],
  "decisions": ["..."]
}

Rules:
- Keep key_points/action_items/decisions concise.
- If unknown owner, use "Unassigned".
- Do not include any extra keys.
- Return strict JSON only (no markdown, no commentary).

Transcript:
`;

function isRetryableOllamaError(e) {
  const status = e?.response?.status;
  if (status === 502 || status === 503 || status === 429) return true;
  const code = e?.code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    code === "EPIPE"
  ) {
    return true;
  }
  const msg = String(e?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("socket")) return true;
  return false;
}

function backoffMs(attemptIndex) {
  const base = Number(process.env.OLLAMA_SUMMARY_RETRY_BASE_MS || "2000");
  return Math.min(25000, base * Math.pow(1.75, attemptIndex));
}

async function callOllamaGenerate({ prompt, model, baseUrl }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/generate`;
  const res = await axios.post(
    url,
    {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2 },
    },
    { timeout: Number(process.env.OLLAMA_SUMMARY_TIMEOUT_MS || "180000") }
  );
  const content = res?.data?.response || "";
  const parsed = safeJsonParse(content);
  const normalized = normalizeSummary(parsed);
  if (!normalized) {
    throw new Error("Ollama /api/generate did not return valid JSON summary");
  }
  return normalized;
}

async function callOllamaChat({ prompt, model, baseUrl }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;
  const timeout = Number(process.env.OLLAMA_SUMMARY_TIMEOUT_MS || "180000");
  const baseBody = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    options: { temperature: 0.2 },
  };

  let res;
  try {
    res = await axios.post(url, { ...baseBody, format: "json" }, { timeout });
  } catch (e) {
    if (e?.response?.status === 400) {
      res = await axios.post(url, baseBody, { timeout });
    } else {
      throw e;
    }
  }

  const content = res?.data?.message?.content || "";
  const parsed = safeJsonParse(content);
  const normalized = normalizeSummary(parsed);
  if (!normalized) {
    throw new Error("Ollama /api/chat did not return valid JSON summary");
  }
  return normalized;
}

async function callOllamaJson({ transcriptText, model, baseUrl }) {
  const prompt = `${OLLAMA_SUMMARY_PROMPT}${transcriptText}`;
  const attempts = Math.max(
    1,
    Number(process.env.OLLAMA_SUMMARY_RETRY_ATTEMPTS || "8")
  );

  const runWithRetries = async (label, fn) => {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const retryable = isRetryableOllamaError(e);
        if (!retryable || i === attempts - 1) {
          if (i === attempts - 1 && retryable) break;
          throw e;
        }
        const delay = backoffMs(i);
        console.warn(
          `[AI summary] ${label} failed (${e?.response?.status || e?.code || "error"}), retry ${i + 1}/${attempts} in ${delay}ms`
        );
        await sleep(delay);
      }
    }
    throw lastErr || new Error(`Ollama ${label} failed`);
  };

  try {
    return await runWithRetries("/api/generate", () =>
      callOllamaGenerate({ prompt, model, baseUrl })
    );
  } catch (first) {
    console.warn(
      "[AI summary] /api/generate exhausted; trying /api/chat with format=json:",
      first?.message || first
    );
    return runWithRetries("/api/chat", () =>
      callOllamaChat({ prompt, model, baseUrl })
    );
  }
}

function parseRetryAfterMs(headers) {
  if (!headers) return null;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (raw == null) return null;
  const sec = Number(raw);
  if (Number.isFinite(sec)) {
    return Math.min(120000, Math.max(1000, Math.round(sec * 1000)));
  }
  return null;
}

function geminiBackoffMs(status, attempt, responseHeaders) {
  const fromHeader = parseRetryAfterMs(responseHeaders);
  if (fromHeader != null) return fromHeader;
  // 429 = rate limit — needs longer waits than transient 503.
  if (status === 429) {
    return Math.min(65000, 5000 * Math.pow(1.85, attempt));
  }
  return Math.min(25000, 1800 * Math.pow(1.65, attempt));
}

async function callGeminiJson({ transcriptText, model, apiKey }) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const prompt = `You are an AI meeting assistant.

Analyze the meeting transcript and return ONLY valid JSON in this exact shape:
{
  "summary": "short paragraph",
  "key_points": ["..."],
  "action_items": [{"owner": "Name", "task": "Task"}],
  "decisions": ["..."]
}

Rules:
- Keep key_points/action_items/decisions concise.
- If unknown owner, use "Unassigned".
- Do not include any extra keys.

Transcript:
${transcriptText}`;

  // Prefer current IDs; gemini-1.5-flash often 404s on newer keys — keep last.
  const candidates = [
    model,
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
  ].filter(Boolean);

  const uniqueCandidates = [...new Set(candidates.map((m) => String(m).trim()))];

  const perModelAttempts = Math.max(
    1,
    Number(process.env.GEMINI_SUMMARY_RETRY_ATTEMPTS || "4")
  );
  const timeoutMs = Number(process.env.GEMINI_SUMMARY_TIMEOUT_MS || "120000");

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  let lastErr = null;

  for (const candidate of uniqueCandidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      candidate
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (let attempt = 0; attempt < perModelAttempts; attempt++) {
      try {
        const res = await axios.post(endpoint, body, { timeout: timeoutMs });

        const content =
          res?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        const parsed = safeJsonParse(content);
        const normalized = normalizeSummary(parsed);
        if (!normalized) {
          throw new Error("Gemini did not return valid JSON summary");
        }
        return normalized;
      } catch (e) {
        lastErr = e;
        const status = e?.response?.status;
        const retryable =
          status === 503 ||
          status === 429 ||
          status === 502 ||
          status === 500;

        if (status === 404) {
          console.warn(`[AI summary] Gemini model not found: ${candidate}, trying next`);
          break;
        }

        if (retryable && attempt < perModelAttempts - 1) {
          const delay = Math.round(
            geminiBackoffMs(status, attempt, e?.response?.headers)
          );
          if (attempt === 0 || attempt === perModelAttempts - 2) {
            console.warn(
              `[AI summary] Gemini ${candidate} HTTP ${status} → wait ${delay}ms (attempt ${attempt + 1}/${perModelAttempts})`
            );
          }
          await sleep(delay);
          continue;
        }

        if (retryable) {
          console.warn(
            `[AI summary] Gemini ${candidate}: exhausted ${perModelAttempts} tries (HTTP ${status}), next model`
          );
          break;
        }

        const detail =
          e?.response?.data?.error?.message ||
          e?.response?.data ||
          e?.message ||
          String(e);
        throw new Error(
          typeof detail === "string" ? detail : JSON.stringify(detail)
        );
      }
    }
  }

  const hint =
    lastErr?.response?.data?.error?.message ||
    lastErr?.message ||
    "unknown error";
  throw new Error(`Gemini failed after all models/retries: ${hint}`);
}

export async function generateMeetingSummary({ transcriptText }) {
  // Default: Gemini if a key exists (matches typical .env); else Ollama for local dev.
  const provider = (
    process.env.AI_SUMMARY_PROVIDER ||
    (process.env.GEMINI_API_KEY ? "gemini" : "ollama")
  ).toLowerCase();

  const openAiModel = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.1:8b";
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const chunks = chunkText(transcriptText, 9000);
  const callJson = async (text) => {
    if (provider === "openai") {
      return callOpenAIJson({ transcriptText: text, model: openAiModel });
    }
    if (provider === "gemini") {
      return callGeminiJson({
        transcriptText: text,
        model: geminiModel,
        apiKey: geminiApiKey,
      });
    }
    return callOllamaJson({
      transcriptText: text,
      model: ollamaModel,
      baseUrl: ollamaBaseUrl,
    });
  };

  if (chunks.length === 1) {
    const summary = await callJson(transcriptText);
    return {
      ...summary,
      model:
        provider === "openai"
          ? openAiModel
          : provider === "gemini"
          ? geminiModel
          : ollamaModel,
    };
  }

  // Summarize chunks first, then summarize the summaries.
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = await callJson(`PART ${i + 1}/${chunks.length}\n\n${chunks[i]}`);
    partials.push(part);
  }

  const combined = `Chunk summaries:\n${partials
    .map(
      (p, idx) =>
        `# Part ${idx + 1}\nSummary: ${p.summary}\nKey Points: ${p.key_points.join(
          "; "
        )}\nAction Items: ${p.action_items
          .map((a) => `${a.owner}: ${a.task}`)
          .join("; ")}\nDecisions: ${p.decisions.join("; ")}`
    )
    .join("\n\n")}`;

  const finalSummary = await callJson(combined);

  return {
    ...finalSummary,
    model:
      provider === "openai"
        ? openAiModel
        : provider === "gemini"
        ? geminiModel
        : ollamaModel,
  };
}

