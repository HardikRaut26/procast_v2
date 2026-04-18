/**
 * Option A: merge Whisper segments from all speakers on one global timeline,
 * then dedupe and build UI-ready lines.
 */

function normalizeWs(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/** Lowercase alnum tokens for fuzzy duplicate detection across mic bleed / two recordings */
function normalizeTextKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenDiceSimilarity(a, b) {
  const ta = normalizeTextKey(a).split(" ").filter((w) => w.length > 1);
  const tb = normalizeTextKey(b).split(" ").filter((w) => w.length > 1);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let inter = 0;
  for (const w of ta) {
    if (setB.has(w)) inter += 1;
  }
  return (2 * inter) / (ta.length + tb.length);
}

/**
 * Whisper overlap fix within ONE speaker only. Cross-speaker overlap is real crosstalk;
 * trimming globally was merging timelines incorrectly.
 */
function dedupeOverlapOneSpeaker(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
  const out = [];
  let lastEnd = -Infinity;
  const EPS = 0.08;

  for (const seg of sorted) {
    const text = normalizeWs(seg.text);
    if (!text) continue;
    let s = Number(seg.start);
    let e = Number(seg.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;

    if (s >= lastEnd - EPS) {
      out.push({ ...seg, speaker: seg.speaker, text, start: s, end: e });
      lastEnd = Math.max(lastEnd, e);
      continue;
    }

    if (e <= lastEnd + EPS) continue;

    const newStart = Math.max(s, lastEnd);
    if (e > newStart) {
      out.push({ ...seg, speaker: seg.speaker, text, start: newStart, end: e });
      lastEnd = Math.max(lastEnd, e);
    }
  }
  return out;
}

export function dedupeOverlapSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const bySpeaker = new Map();
  for (const seg of segments) {
    const key = seg.speaker || "_";
    if (!bySpeaker.has(key)) bySpeaker.set(key, []);
    bySpeaker.get(key).push(seg);
  }
  const merged = [];
  for (const group of bySpeaker.values()) {
    merged.push(...dedupeOverlapOneSpeaker(group));
  }
  return merged.sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
}

/**
 * Drop duplicate utterances heard on both participants' recordings (mic bleed / room echo).
 * Keeps the chronologically first segment; uses fuzzy text match and a wider time gate.
 * Conservative: only remove if >90% similar and very close in time to avoid removing names.
 */
export function crossSpeakerDedupe(
  segments,
  { gapSec = 14, minDice = 0.90 } = {}  // Raised minDice from 0.82 to 0.90 to be more conservative
) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
  const kept = [];

  const isDupOf = (cur, prior) => {
    const dt = Math.abs((cur.start || 0) - (prior.start || 0));
    if (dt >= gapSec) return false;
    const a = normalizeWs(cur.text);
    const b = normalizeWs(prior.text);
    if (!a || !b) return false;
    if (a === b) return true;
    if (normalizeTextKey(a) === normalizeTextKey(b)) return true;
    return tokenDiceSimilarity(a, b) >= minDice;
  };

  for (const cur of sorted) {
    const t = normalizeWs(cur.text);
    if (!t) continue;
    let duplicate = false;
    for (let i = kept.length - 1; i >= 0 && i >= kept.length - 40; i--) {
      if (isDupOf({ ...cur, text: t }, kept[i])) {
        duplicate = true;
        break;
      }
      if ((cur.start || 0) - (kept[i].start || 0) > gapSec + 5) break;
    }
    if (!duplicate) kept.push({ ...cur, text: t });
  }
  return kept;
}

/** Keep only confident segments when `avgLogprob` is present. */
export function filterLowConfidenceSegments(segments, minAvgLogprob = -1.0) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  return segments.filter((s) => {
    const lp = Number(s?.avgLogprob);
    return !Number.isFinite(lp) || lp >= minAvgLogprob;
  });
}

/** Group near-simultaneous segments into time buckets, preserving local order. */
export function bucketSortSegments(segments, bucketSec = 0.5) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const map = new Map();
  for (const seg of segments) {
    const key = Math.floor((Number(seg.start) || 0) / bucketSec);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(seg);
  }
  return [...map.keys()]
    .sort((a, b) => a - b)
    .flatMap((k) =>
      map
        .get(k)
        .sort(
          (a, b) =>
            (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
        )
    );
}

/** Resolve duplicate utterances from multiple tracks by picking the stronger segment. */
export function resolveSpeakerConflicts(
  segments,
  { timeWindowSec = 1.0, similarity = 0.85 } = {}
) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
  const out = [];

  for (const seg of sorted) {
    const t = normalizeWs(seg.text);
    if (!t) continue;
    const existing = out.find((r) => {
      const dt = Math.abs((r.start || 0) - (seg.start || 0));
      if (dt > timeWindowSec) return false;
      return tokenDiceSimilarity(r.text, t) >= similarity;
    });

    if (!existing) {
      out.push({ ...seg, text: t });
      continue;
    }

    const curDur = Math.max(0, (seg.end || 0) - (seg.start || 0));
    const prevDur = Math.max(0, (existing.end || 0) - (existing.start || 0));
    const curLp = Number.isFinite(Number(seg.avgLogprob))
      ? Number(seg.avgLogprob)
      : -0.6;
    const prevLp = Number.isFinite(Number(existing.avgLogprob))
      ? Number(existing.avgLogprob)
      : -0.6;

    // Prefer the segment that looks more confident: longer + better logprob.
    const curScore = curDur + curLp * 0.25;
    const prevScore = prevDur + prevLp * 0.25;
    if (curScore > prevScore) {
      Object.assign(existing, { ...seg, text: t });
    }
  }

  return out.sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
}

/** Remove local repetition from Whisper overlap/context windows. */
export function removeRepetitionSegments(
  segments,
  { similarity = 0.85, lookback = 8 } = {}  // Raised similarity from 0.8 to 0.85 to be more conservative
) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );
  const result = [];

  for (const seg of sorted) {
    const t = normalizeWs(seg.text);
    if (!t) continue;
    let repeated = false;
    for (
      let i = result.length - 1;
      i >= 0 && i >= result.length - lookback;
      i--
    ) {
      if (tokenDiceSimilarity(result[i].text, t) >= similarity) {
        repeated = true;
        break;
      }
    }
    if (!repeated) result.push({ ...seg, text: t });
  }

  return result;
}

function capitalizeFirst(text) {
  const t = normalizeWs(text);
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatSentence(text) {
  let t = normalizeWs(text);
  if (!t) return ""; // Only return empty if truly empty
  t = capitalizeFirst(t);
  t = t.replace(/\s+([,.!?;:])/g, "$1");
  if (!/[.!?]$/.test(t)) t += ".";
  return t; // Always return something if input was non-empty
}

const MAX_TURN_CHARS = 120;        // Max chars per line (safety limit)
const MAX_TURN_GAP_SEC = 0.3;      // If gap >= 300ms, start a new line (silence detected)
const MAX_WORDS_PER_LINE = 25;     // Max words per line (safety limit)

/**
 * Group adjacent segments from same speaker (small gap), then split into sentence-like lines.
 */
export function buildGlobalTurnLines(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  // Track all input text for debugging word loss
  const inputText = segments
    .map((s) => normalizeWs(s.text))
    .filter((t) => t.length > 0)
    .join(" ");
  const inputWords = inputText.split(/\s+/).filter(Boolean);
  console.log(`[TRANSCRIPT-BUILD-START] Input: ${segments.length} segments, ${inputWords.length} words`);
  if (inputWords.length <= 20) {
    console.log(`  Text: "${inputText}"`);
  }

  const sorted = [...segments].sort(
    (a, b) => (a.start || 0) - (b.start || 0) || (a.end || 0) - (b.end || 0)
  );

  const merged = [];
  let cur = null;

  for (const seg of sorted) {
    const sp = seg.speaker || "Speaker";
    const t = normalizeWs(seg.text);
    if (!t) continue;
    const s = Number(seg.start);
    const e = Number(seg.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;

    const gap = cur ? (s - (cur.end || s)) : -Infinity;
    const isSilence = gap >= MAX_TURN_GAP_SEC;  // gap >= 300ms = silence detected
    const isDifferentSpeaker = cur && cur.speaker !== sp;
    const wouldBeTooLong = cur && (cur.text + " " + t).length > MAX_TURN_CHARS;
    const wouldHaveTooManyWords = cur && ((cur.text.split(/\s+/).length) + (t.split(/\s+/).length)) > MAX_WORDS_PER_LINE;
    const isFirstSegment = !cur;  // First segment always starts a new turn

    // Decision: merge or break?
    // Break if: first segment, silence, different speaker, or would exceed limits
    const shouldBreak = isFirstSegment || isSilence || isDifferentSpeaker || wouldBeTooLong || wouldHaveTooManyWords;

    if (shouldBreak) {
      if (cur) {
        merged.push(cur);
        if (isSilence) {
          console.log(`[MERGE-BREAK] Silence detected (${gap.toFixed(3)}s >= ${MAX_TURN_GAP_SEC}s): "${cur.text.substring(0, 50)}..."`);
        }
      }
      cur = { speaker: sp, text: t, start: s, end: e };
    } else {
      // Merge: same speaker, small gap, reasonable length
      cur.text = normalizeWs(`${cur.text} ${t}`);
      cur.end = Math.max(cur.end || e, e);
      console.log(`[MERGE-KEEP] Gap ${gap.toFixed(3)}s < ${MAX_TURN_GAP_SEC}s: merged to "${cur.text.substring(0, 50)}..."`);
    }
  }
  if (cur) merged.push(cur);

  const lines = [];
  for (const block of merged) {
    // Merged blocks are already well-formed by silence.
    // Just apply sentence formatting and distribute timestamps.

    const text = normalizeWs(block.text);
    const dur = Math.max(0.01, (block.end || 0) - (block.start || 0));
    const start = block.start || 0;

    // Split on punctuation (. ! ?) if present
    const parts = text
      .split(/(?<=[.!?])\s+/)
      .map((p) => normalizeWs(p))
      .filter(Boolean);

    if (parts.length <= 1) {
      // Single sentence - just format it
      const sentence = formatSentence(text);
      if (sentence) {
        console.log(`[LINE] Single: "${sentence}"`);
        lines.push({
          speaker: block.speaker,
          text: sentence,
          start,
          end: Math.max(block.end || 0, start + 0.05),
        });
      }
    } else {
      // Multiple sentences (split by . ! ?) - distribute based on word count
      const weights = parts.map((p) =>
        Math.max(1, normalizeWs(p).split(/\s+/).filter(Boolean).length)
      );
      const totalW = weights.reduce((a, b) => a + b, 0);

      let accW = 0;
      for (let i = 0; i < parts.length; i++) {
        const sentence = formatSentence(parts[i]);
        if (sentence) {
          const w = weights[i];
          const t0 = start + (dur * accW) / totalW;
          accW += w;
          const t1 = start + (dur * accW) / totalW;
          console.log(`[LINE] Multi[${i}]: "${sentence}"`);
          lines.push({
            speaker: block.speaker,
            text: sentence,
            start: t0,
            end: Math.max(t1, t0 + 0.05),
          });
        }
      }
    }
  }

  // Strict sorting: by start time, then by end time, then by speaker name
  lines.sort((a, b) => {
    const startDiff = (a.start || 0) - (b.start || 0);
    if (startDiff !== 0) return startDiff;
    const endDiff = (a.end || 0) - (b.end || 0);
    if (endDiff !== 0) return endDiff;
    return String(a.speaker || "").localeCompare(String(b.speaker || ""));
  });

  // Log statistics for debugging
  const outputText = lines.map((l) => l.text).join(" ");
  const outputWords = lines.reduce((sum, line) => sum + (line.text?.split(/\s+/).filter(Boolean).length || 0), 0);
  console.log(`[TRANSCRIPT-BUILD-END] Output: ${lines.length} lines, ${outputWords} words`);

  if (inputWords.length !== outputWords) {
    const missing = inputWords.length - outputWords;
    console.warn(`⚠️  [TRANSCRIPT-BUILD] Word count mismatch: input=${inputWords.length}, output=${outputWords} (${missing > 0 ? 'lost' : 'added'} ${Math.abs(missing)})`);
    // Show first few missing words if any
    if (missing > 0 && inputWords.length <= 50) {
      console.warn(`  Input text: "${inputText}"`);
      console.warn(`  Output text: "${outputText}"`);
    }
  }

  return lines;
}
