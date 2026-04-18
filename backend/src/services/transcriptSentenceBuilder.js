const terminalPunctuationRegex = /[.!?]$/;

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function capitalizeFirstLetter(text) {
  const t = normalizeWhitespace(text);
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatSentence(text) {
  let t = normalizeWhitespace(text);
  if (!t) return "";

  // Capitalize + ensure ending punctuation (common in production transcript exports).
  t = capitalizeFirstLetter(t);

  // Fix spacing before punctuation.
  t = t.replace(/\s+([,.!?;:])/g, "$1");

  if (!terminalPunctuationRegex.test(t)) t += ".";
  return t;
}

/**
 * Convert Whisper segments into more sentence-like chunks for one speaker.
 * Whisper can output many small segments; we combine them until we reach a
 * terminal punctuation or the gap between segments becomes large.
 */
export function buildSpeakerSentences(segments, speaker) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => (a.start || 0) - (b.start || 0));

  const sentences = [];

  let curTextParts = [];
  let curStart = null;
  let curEnd = null;

  // Guards to avoid producing one mega-line when Whisper emits many segments.
  // Keep each output line reasonably sentence-sized.
  const MAX_SENTENCE_CHARS = 160;
  const MAX_SENTENCE_MS = 12000;
  const JOIN_GAP_MS = 900;

  const flush = () => {
    const raw = normalizeWhitespace(curTextParts.join(" "));
    if (!raw) {
      curTextParts = [];
      curStart = null;
      curEnd = null;
      return;
    }

    const startTs = curStart ?? 0;
    const endTs = curEnd ?? curStart ?? 0;
    const totalMs = Math.max(1, endTs - startTs) * 1000;

    // Split inside large chunks into individual sentences based on punctuation.
    // This helps when Whisper returns long blocks without segment-level punctuation.
    const sentenceParts = raw
      .split(/(?<=[.!?])\s+/)
      .map((p) => normalizeWhitespace(p))
      .filter(Boolean);

    const count = Math.max(1, sentenceParts.length);
    for (let i = 0; i < sentenceParts.length; i++) {
      const part = sentenceParts[i];
      const text = formatSentence(part);
      if (!text) continue;

      // Deduplicate consecutive repeated sentences.
      // Whisper segments may overlap, which often causes the same sentence
      // to appear in two consecutive segments.
      const prev = sentences[sentences.length - 1];
      if (prev && prev.speaker === speaker && normalizeWhitespace(prev.text) === normalizeWhitespace(text)) {
        continue;
      }

      const partStart = startTs + (totalMs * i) / count / 1000;
      const partEnd = startTs + (totalMs * (i + 1)) / count / 1000;

      sentences.push({
        speaker,
        text,
        start: partStart,
        end: partEnd,
      });
    }

    curTextParts = [];
    curStart = null;
    curEnd = null;
  };

  for (const seg of sorted) {
    const segText = normalizeWhitespace(seg?.text);
    if (!segText) continue;

    const segStart = typeof seg?.start === "number" ? seg.start : 0;
    const segEnd = typeof seg?.end === "number" ? seg.end : segStart;

    if (curTextParts.length === 0) {
      curTextParts.push(segText);
      curStart = segStart;
      curEnd = segEnd;
      continue;
    }

    const lastText = normalizeWhitespace(curTextParts.join(" "));
    const lastEndsWithPunct = terminalPunctuationRegex.test(lastText);

    const gapMs = Math.max(0, (segStart - (curEnd ?? segStart)) * 1000);

    const curTextLength = normalizeWhitespace(curTextParts.join(" ")).length;
    const projectedChars = curTextLength + 1 + segText.length;
    const projectedDurationMs = ((segEnd - (curStart ?? segStart)) || 0) * 1000;

    // Join rules:
    // - If last sentence has terminal punctuation, start a new sentence.
    // - If there's a big gap, start a new sentence.
    // - Otherwise, keep appending.
    const shouldStartNew =
      lastEndsWithPunct ||
      gapMs > JOIN_GAP_MS ||
      projectedChars > MAX_SENTENCE_CHARS ||
      projectedDurationMs > MAX_SENTENCE_MS;

    if (shouldStartNew) {
      flush();
    }

    curTextParts.push(segText);
    curEnd = Math.max(curEnd ?? segEnd, segEnd);
  }

  flush();
  return sentences;
}

