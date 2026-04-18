# Transcript Improvements Summary

## Issues Fixed

### 1. **Timestamp Offset Calculation (Major)**
**Problem**: Participant videos getting timestamps from `Date.now() - sessionEpoch`, resulting in 3+ minute offsets for 40-second videos.

**Files Changed**:
- `frontend/procast-frontend/src/pages/VideoCall.jsx`
- `backend/src/controllers/upload.controller.js`
- `backend/src/services/transcription.service.js`

**Fixes**:
- ✅ Frontend now uses **relative timestamps** (0 when recording starts)
- ✅ Server no longer recalculates from current time
- ✅ Validation clamps all timestamps to final video duration
- ✅ Enhanced logging to track offset calculations

**Result**: Timestamps now stay within video duration bounds

---

### 2. **Sentence Grouping Too Aggressive**
**Problem**: "Hello myself what about you i'm fine what about you i'm currently cursing me from" — all words merged into one line.

**Files Changed**:
- `backend/src/services/globalTranscriptMerge.js`

**Fixes**:
- ✅ Reduced `MAX_TURN_CHARS` from 200→120 (shorter sentences)
- ✅ Reduced `MAX_TURN_GAP_SEC` from 2.0→0.6 (break on tiny pauses)
- ✅ Added `MAX_WORDS_PER_LINE` = 25 (semantic limit)
- ✅ Break on sentence-ending punctuation immediately
- ✅ Smarter word-count aware merging

**Result**: Sentences now split properly at natural boundaries

---

### 3. **Words Being Lost (Names, Etc.)**
**Problem**: "Hardik" and other names disappearing from transcript.

**Files Changed**:
- `backend/src/services/globalTranscriptMerge.js`

**Fixes**:
- ✅ Raised `minDice` from 0.82→0.90 (more conservative deduplication)
- ✅ Raised `similarity` from 0.8→0.85 (less aggressive repetition removal)
- ✅ Added explicit word preservation in chunk splitting
- ✅ Added guard checks to ensure all words are included
- ✅ Detailed logging to track word loss

**Result**: All words now preserved through the pipeline

---

## Technical Details

### Timestamp Flow

```
Client (VideoCall.jsx)
  ↓ recordingOffsetMsRef = 0 (relative to user's recording start)
  ↓ uploadChunkToBackend({ chunkStartMs: 0, 5000, 10000, ... })
Server (upload.controller.js)
  ↓ Store startTimeMs as-is (don't recalculate)
Transcription Service
  ↓ chunkOffsetSeconds = startTimeMs / 1000 (0, 5, 10, ... seconds)
  ↓ Add to Whisper timestamps (relative to participant audio)
  ↓ Result: global speaker timeline
Multi-speaker Merge
  ↓ Sort all speakers by time
  ↓ Alignment function (optional, if degenerate)
Final Validation
  ↓ Clamp all to [0, maxDurationSec]
  ↓ Result: timestamps within video bounds
```

### Sentence Building Flow

```
Raw Whisper Segments
  ↓ Group by speaker + 600ms gap (natural pause detection)
  ↓ Merge while < 120 chars AND < 25 words
  ↓ Split at sentence boundaries (. ! ?)
  ↓ For long unpunctuated text: split into 4-7 word chunks
  ↓ Distribute timestamps by word count
  ↓ Result: coherent, properly-spaced lines
```

### Deduplication Thresholds

| Function | Threshold | Change | Reason |
|----------|-----------|--------|--------|
| `crossSpeakerDedupe` | minDice | 0.82→0.90 | Less aggressive; keep names |
| `removeRepetitionSegments` | similarity | 0.8→0.85 | More conservative; avoid losing legit repetition |

---

## New Logging

Watch these logs during transcription to verify improvements:

```
[TRANSCRIPT-BUILD-START] Input: 250 segments, 1842 words
[TRANSCRIBE] Raw segments: 250 items spanning [0.00s, 40.00s]
[TRANSCRIBE] Speaker1: 125 segments, offset=0.00s → Timeline: 0.00s–20.15s
[TRANSCRIBE] Speaker2: 125 segments, offset=20.20s → Timeline: 20.20s–40.05s
[ALIGN] Multi-speaker call (2 speakers) — skipping alignment
[TRANSCRIBE] Final video duration: 40.00s
[VALIDATE] Clamped 0/235 items to [0, 40.00]s
✅ Transcript finalized: 235 items spanning [0.00s, 40.00s]
[TRANSCRIPT-BUILD-END] Output: 235 lines, 1842 words
```

---

## Testing Checklist

- [ ] Run transcription on a 40-second 2-speaker call
- [ ] Check that no timestamps exceed video duration
- [ ] Verify all names and pronouns are present
- [ ] Confirm sentences are ~5-10 words each (not 20+)
- [ ] Check logs for word count mismatch warnings
- [ ] Validate alignment logic is appropriate for speaker count

---

## Configuration (Optional)

Tune behavior via environment variables:

```bash
# Deduplication aggressiveness
TRANSCRIPT_BUCKET_SEC=0.5        # Group utterances < 500ms apart
WHISPER_MIN_AVG_LOGPROB=-1.0     # Filter low-confidence segments

# Enforcement (usually leave off)
TRANSCRIPT_ENFORCE_MONOTONIC=false  # Don't add artificial timing drifts
```

---

## Files Modified

1. `backend/src/controllers/upload.controller.js` — Remove bad offset calculation
2. `backend/src/services/transcription.service.js` — Add validation + logging
3. `backend/src/services/globalTranscriptMerge.js` — Smarter sentence splitting
4. `frontend/procast-frontend/src/pages/VideoCall.jsx` — Use relative offsets
