# Transcript Testing & Verification Guide

## Quick Start: Test the Improvements

### 1. Record a Test Call
- **Duration**: 30-50 seconds (forces all improvements)
- **Participants**: 2+ people (tests multi-speaker alignment)
- **Content**: Mix of names, numbers, sentences with pauses
- **Example script**:
  ```
  Speaker 1: "Hi, I'm Hardik. How are you?"
  Speaker 2: "I'm doing great, thanks for asking."
  Speaker 1: "Let's discuss the project. We need to implement the API."
  Speaker 2: "Sure. I can handle the backend."
  Speaker 1: "Perfect. Timeline is next week."
  ```

### 2. Check Backend Logs During Transcription

#### Watch for these SUCCESS indicators:

```bash
✅ [TRANSCRIPT-BUILD-START] Input: 120 segments, 850 words
✅ [TRANSCRIBE] Raw segments: 135 items spanning [0.00s, 45.30s]
✅ [TRANSCRIBE] Speaker1: 67 segments, offset=0.00s → Timeline: 0.00s–22.50s
✅ [TRANSCRIBE] Speaker2: 68 segments, offset=22.60s → Timeline: 22.60s–45.20s
✅ [ALIGN] Multi-speaker call (2 speakers) — skipping alignment
✅ [ROUTE] Final video duration: 45.30s
✅ [VALIDATE] Clamped 0/125 items to [0, 45.30]s
✅ [TRANSCRIPT-BUILD-END] Output: 125 lines, 850 words
✅ Transcript finalized: 125 items spanning [0.12s, 45.18s] (max duration: 45.30s)
```

#### RED FLAGS (watch for these problems):

```bash
❌ [TRANSCRIPT-BUILD] Word count mismatch: input=850, output=812 (lost 38)
   → Issue: Words are disappearing during processing
   → Fix: Check deduplication thresholds

❌ Timestamp outside bounds [0.00s, 45.30s]: found 60.15s
   → Issue: Clamping didn't work or happened late
   → Fix: Check validateTranscriptTimings() logic

❌ [TRANSCRIBE-OFFSET] offset=193.40s (chunkIndex=39, startTimeMs=???)
   → Issue: Huge offset (chunk index fallback triggered)
   → Fix: Ensure client sends chunkStartMs with every upload
```

---

## Validation Checklist

### ✅ Timestamp Validation
- [ ] No transcript items beyond final video duration
- [ ] All timestamps are `[0, videoLength]`
- [ ] Multi-speaker timestamps increase monotonically
- [ ] Gap between speakers ≤ 0.5s (no huge jumps)

**Test Query** (in MongoDB):
```javascript
db.sessions.find(
  { transcriptionStatus: "SUCCEEDED" },
  { transcript: 1, finalMeetingFileId: 1 }
).limit(1).forEach(doc => {
  const maxTs = Math.max(...doc.transcript.map(t => t.end || 0));
  console.log(`Max timestamp: ${maxTs}s (should be < 60s for short call)`);
});
```

### ✅ Word Preservation
- [ ] All names appear in transcript
- [ ] No repeated "lost word" warnings in logs
- [ ] Input word count ≈ Output word count
- [ ] Punctuation is preserved

**Manual Check**:
```javascript
// In backend logs, look for:
[TRANSCRIPT-BUILD-START] Input: 850 words
[TRANSCRIPT-BUILD-END] Output: 850 words  // ← Should match or be very close
```

### ✅ Sentence Structure
- [ ] Average sentence ≤ 25 words
- [ ] No line exceeds 120 characters
- [ ] Names not followed by too many other words on same line
- [ ] Natural breaks at pauses/punctuation

**Count sentence length**:
```javascript
const lines = await db.sessions.findOne({ _id: ObjectId("...") }).transcript;
const avgWords = lines.reduce((sum, l) => sum + l.text.split(/\s+/).length, 0) / lines.length;
const maxWords = Math.max(...lines.map(l => l.text.split(/\s+/).length));
console.log(`Avg: ${avgWords.toFixed(1)} words, Max: ${maxWords} words`);
// Expected: Avg 8-12, Max 25-30
```

---

## Before/After Comparison

### BEFORE Fixes

```
test1· 03:13.405
Hello myself what about you i'm fine what about you i'm currently cursing me from.

test2· 02:45.120
So we need to implement the database layer and also the API endpoints and testing.

test3· 01:50.000
Hardik said we should do it next week.
```

**Problems**:
- ❌ 3:13 timestamp for 40s video (offset bug)
- ❌ Huge sentence (50+ words crammed together)
- ❌ "Hardik" appears but lost from some places
- ❌ Multiple ideas in one line

### AFTER Fixes

```
Speaker1· 00:02.150
Hi myself what about you.

Speaker1· 00:05.320
I'm fine what about you.

Speaker1· 00:08.140
I'm currently deciding what to do.

Speaker2· 00:18.540
So we need to implement the database layer.

Speaker2· 00:21.680
And also the API endpoints and testing.

Speaker2· 00:28.190
Hardik said we should do it next week.
```

**Improvements**:
- ✅ All timestamps within [0, 40s] range
- ✅ Short sentences (5-8 words each)
- ✅ Names preserved ("Hardik" visible)
- ✅ One idea per line

---

## Environment Variables for Fine-Tuning

Adjust these if results still aren't perfect:

### Sentence Grouping (in `globalTranscriptMerge.js`)
```javascript
MAX_TURN_CHARS = 120;          // Increase to 150 if too aggressive
MAX_TURN_GAP_SEC = 0.6;        // Increase to 0.8 if breaking too early
MAX_WORDS_PER_LINE = 25;       // Increase to 30 if cutting names prematurely
```

### Deduplication (conservative defaults)
```javascript
// Line 92: minDice = 0.90   (was 0.82, now conservative)
// Line 206: similarity = 0.85 (was 0.8, now conservative)
```

### Production Tuning
```bash
# If losing too many words:
TRANSCRIPT_BUCKET_SEC=0.3      # Smaller buckets = less merging

# For single-speaker calls (enable alignment):
TRANSCRIPT_ENFORCE_MONOTONIC=false  # Keep real timestamps (default)

# For very long calls:
HF_TRANSCRIBE_SPLIT_SEC=30     # Split into smaller audio chunks
```

---

## Debugging Transcript Issues

### Issue: "Lost 42 words"

**Check these in order**:

1. **Are all input segments non-empty?**
   ```javascript
   db.sessions.findOne({_id: ObjectId("...")}).transcript.forEach(t => {
     if (!t.text || t.text.trim() === "") console.log("EMPTY:", t);
   });
   ```

2. **Is deduplication too aggressive?**
   - Lower `minDice` from 0.90 to 0.85
   - Lower `similarity` from 0.85 to 0.80

3. **Are chunks being split incorrectly?**
   - Check logs for `[CHUNK-SPLIT] WARNING: empty chunk`
   - Increase `wordsPerChunk` from default

### Issue: "Timestamps way too big"

**Check these in order**:

1. **Is client sending `chunkStartMs`?**
   ```javascript
   db.chunks.findOne().startTimeMs  // Should be 0, 5000, 10000, ...
   ```

2. **Is fallback calculation running?**
   - Check if startTimeMs is null
   - Inspect chunkIndex values (shouldn't be > 100)

3. **Is validation working?**
   - Check logs for `[VALIDATE] Clamped X items`
   - Manually review clamped transcript items

### Issue: "Names disappearing"

**Check these in order**:

1. **Direct word loss?**
   - Compare input vs output word counts in logs
   - `formatSentence()` should never lose words

2. **Deduplicated as noise?**
   - Lower `minDice` to 0.95+ (even more conservative)
   - Check crossSpeakerDedupe is skipping multi-speaker

3. **Filtered by confidence?**
   - Check `WHISPER_MIN_AVG_LOGPROB` (should be -1.0 or lower)

---

## Performance Metrics

Expected times:

| Task | Duration | Notes |
|------|----------|-------|
| Extract audio from webm | 1-2s | Per participant |
| Whisper transcription | 2-5s | Per participant, depends on audio length |
| Dedup/merge/validate | 0.5-1s | Per call |
| Write to DB | 0.2-0.5s | Single write |
| **Total** | **5-15s** | For 2-person call |

If transcription takes > 30s, profile the bottleneck:
- Whisper might be slow → check `HF_TRANSCRIBE_TIMEOUT_MS`
- Alignment might be expensive → check if multi-speaker (should skip)
- DB write might fail → check MongoDB connection

---

## Success Criteria

A successful transcript has:

✅ **Timing**: All timestamps in [0, videoLength]
✅ **Completeness**: Word count in ≈ word count out (±5%)
✅ **Readability**: Max 25 words per line, avg 8-12
✅ **Speakers**: Names and pronouns all preserved
✅ **Punctuation**: Sentences properly terminated
✅ **Speed**: Generated < 15s for typical call

---

## Next Steps

1. **Run a test call** (30-60s, 2 speakers)
2. **Check logs** for red flags above
3. **Validate in UI** - open transcript modal, verify output
4. **Adjust thresholds** if needed (see Tuning section)
5. **Document results** - save sample transcript for regression testing
