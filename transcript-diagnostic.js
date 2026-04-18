#!/usr/bin/env node

/**
 * Transcript Diagnostic Script
 * Usage: node transcript-diagnostic.js <sessionId>
 *
 * Checks if transcript improvements are working correctly
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Simple models for checking (adjust paths as needed)
const sessionSchema = new mongoose.Schema({
  transcript: [{
    speaker: String,
    text: String,
    start: Number,
    end: Number,
  }],
  transcriptionStatus: String,
  transcriptionMeta: mongoose.Schema.Types.Mixed,
  finalMeetingFileId: String,
}, { timestamps: true });

const Session = mongoose.model('Session', sessionSchema);

async function diagnoseTranscript(sessionId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/procast');

    const session = await Session.findById(sessionId);
    if (!session) {
      console.error(`❌ Session ${sessionId} not found`);
      process.exit(1);
    }

    console.log(`\n📋 Transcript Diagnostic Report\n`);
    console.log(`Session: ${sessionId}`);
    console.log(`Status: ${session.transcriptionStatus}`);
    console.log(`Generated: ${session.transcriptionMeta?.generatedAt || 'N/A'}`);
    console.log(`Provider: ${session.transcriptionMeta?.provider || 'N/A'}\n`);

    const transcript = session.transcript || [];
    if (transcript.length === 0) {
      console.warn(`⚠️  No transcript data found`);
      process.exit(0);
    }

    // ============ TIMING ANALYSIS ============
    console.log(`\n⏱️  TIMING ANALYSIS`);
    const startTimes = transcript.map(t => t.start || 0);
    const endTimes = transcript.map(t => t.end || 0);
    const minStart = Math.min(...startTimes);
    const maxEnd = Math.max(...endTimes);

    console.log(`  Items: ${transcript.length}`);
    console.log(`  Range: [${minStart.toFixed(2)}s, ${maxEnd.toFixed(2)}s]`);

    // Check for out-of-bounds
    const outOfBounds = transcript.filter(t => t.start > 3600 || t.end > 3600).length;
    if (outOfBounds > 0) {
      console.log(`  ❌ OUT OF BOUNDS: ${outOfBounds} items exceed 1 hour`);
    } else if (maxEnd > 300) {
      console.log(`  ⚠️  Long call (${maxEnd.toFixed(1)}s > 5 min)`);
    } else {
      console.log(`  ✅ All timestamps reasonable`);
    }

    // ============ WORD COUNT ANALYSIS ============
    console.log(`\n📝 WORD COUNT ANALYSIS`);
    const totalWords = transcript.reduce((sum, t) => {
      const words = (t.text || '').split(/\s+/).filter(Boolean);
      return sum + words.length;
    }, 0);
    const avgWordsPerLine = totalWords / transcript.length;

    console.log(`  Total words: ${totalWords}`);
    console.log(`  Avg/line: ${avgWordsPerLine.toFixed(1)}`);

    if (avgWordsPerLine > 25) {
      console.log(`  ❌ Lines too long (avg ${avgWordsPerLine.toFixed(1)} > 25)`);
    } else if (avgWordsPerLine < 5) {
      console.log(`  ⚠️  Lines very short (avg ${avgWordsPerLine.toFixed(1)} < 5)`);
    } else {
      console.log(`  ✅ Line length reasonable (${avgWordsPerLine.toFixed(1)} words)`);
    }

    // ============ SENTENCE LENGTH ANALYSIS ============
    console.log(`\n📋 SENTENCE LENGTH ANALYSIS`);
    const lineLengths = transcript.map(t => (t.text || '').split(/\s+/).filter(Boolean).length);
    const maxLineWords = Math.max(...lineLengths);
    const minLineWords = Math.min(...lineLengths);

    const tooLong = transcript.filter(t => {
      const words = (t.text || '').split(/\s+/).filter(Boolean).length;
      return words > 30;
    });

    console.log(`  Min/Max words: ${minLineWords}/${maxLineWords}`);
    if (tooLong.length > 0) {
      console.log(`  ⚠️  ${tooLong.length} lines exceed 30 words:`);
      tooLong.slice(0, 3).forEach((t, i) => {
        const words = (t.text || '').split(/\s+/).length;
        console.log(`    ${i+1}. [${words}w] "${t.text?.substring(0, 60)}..."`);
      });
    } else {
      console.log(`  ✅ All lines ≤ 30 words`);
    }

    // ============ SPEAKER ANALYSIS ============
    console.log(`\n👥 SPEAKER ANALYSIS`);
    const speakers = new Set(transcript.map(t => t.speaker).filter(Boolean));
    console.log(`  Speakers: ${speakers.size}`);
    speakers.forEach(sp => {
      const count = transcript.filter(t => t.speaker === sp).length;
      const words = transcript
        .filter(t => t.speaker === sp)
        .reduce((sum, t) => sum + (t.text || '').split(/\s+/).filter(Boolean).length, 0);
      console.log(`    - ${sp}: ${count} lines, ${words} words`);
    });

    // ============ SAMPLE LINES ============
    console.log(`\n📄 SAMPLE LINES (first 5):`);
    transcript.slice(0, 5).forEach((t, i) => {
      const words = (t.text || '').split(/\s+/).filter(Boolean).length;
      const duration = (t.end || 0) - (t.start || 0);
      console.log(
        `  ${i+1}. [${(t.start || 0).toFixed(2)}s] ${t.speaker}: "${t.text}" (${words}w, ${duration.toFixed(2)}s)`
      );
    });

    // ============ FINAL VERDICT ============
    console.log(`\n${'='.repeat(50)}`);

    let score = 0;
    const checks = [];

    if (maxEnd <= 300 && minStart >= 0) {
      score += 25;
      checks.push('✅ Timing within bounds');
    } else {
      checks.push('❌ Timing out of bounds');
    }

    if (Math.abs(avgWordsPerLine - 10) < 10) {
      score += 25;
      checks.push('✅ Word count reasonable');
    } else {
      checks.push('⚠️  Word count unusual');
    }

    if (maxLineWords <= 30 && minLineWords >= 2) {
      score += 25;
      checks.push('✅ Line length good');
    } else {
      checks.push('⚠️  Line length problematic');
    }

    if (speakers.size >= 1 && totalWords > 50) {
      score += 25;
      checks.push('✅ Content and speakers OK');
    } else {
      checks.push('❌ Missing content or speakers');
    }

    checks.forEach(c => console.log(c));
    console.log(`\nSCORE: ${score}/100`);

    if (score >= 75) {
      console.log('🎉 TRANSCRIPT QUALITY: GOOD');
    } else if (score >= 50) {
      console.log('⚠️  TRANSCRIPT QUALITY: FAIR (see warnings above)');
    } else {
      console.log('❌ TRANSCRIPT QUALITY: POOR (needs investigation)');
    }

    console.log(`${'='.repeat(50)}\n`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('Usage: node transcript-diagnostic.js <sessionId>');
  console.error('Example: node transcript-diagnostic.js 67a8f9b3c2e1d5a4b9c8e7f6');
  process.exit(1);
}

diagnoseTranscript(sessionId);
