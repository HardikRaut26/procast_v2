import mongoose from "mongoose";

const translationCacheSchema = new mongoose.Schema(
  {
    // Hash of source text for fast lookup
    sourceHash: {
      type: String,
      required: true,
      index: true,
    },
    // Original text (for validation/reference)
    sourceText: {
      type: String,
      required: true,
    },
    // Target language code (e.g. "hi", "mr", "sa")
    targetLanguage: {
      type: String,
      required: true,
      index: true,
    },
    // Translated text
    translatedText: {
      type: String,
      required: true,
    },
    // Which provider succeeded (openai, gemini, original)
    provider: {
      type: String,
      enum: ["openai", "gemini", "original"],
      default: "original",
    },
  },
  { timestamps: true }
);

// Compound index for fast lookup: (sourceHash, targetLanguage)
translationCacheSchema.index({ sourceHash: 1, targetLanguage: 1 }, { unique: true });

const TranslationCache = mongoose.model("TranslationCache", translationCacheSchema);

export default TranslationCache;
