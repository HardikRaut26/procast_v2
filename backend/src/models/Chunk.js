import mongoose from "mongoose";

const chunkSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Session",
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },

    chunkIndex: {
      type: Number,
      required: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      required: true,
    },

    b2FileId: {
      type: String,
      required: true,
    },

    /** Milliseconds from session `startTime` when this chunk’s capture window began (single global clock). */
    startTimeMs: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Prevent duplicate chunks per user/session/index
 * (CRITICAL for retries & idempotency)
 */
chunkSchema.index(
  { sessionId: 1, userId: 1, chunkIndex: 1 },
  { unique: true }
);

export default mongoose.model("Chunk", chunkSchema);
