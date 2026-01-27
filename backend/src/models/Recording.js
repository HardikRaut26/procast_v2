import mongoose from "mongoose";

const recordingSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    b2FileId: { type: String, required: true },
    duration: Number,
  },
  { timestamps: true }
);

export default mongoose.model("Recording", recordingSchema);
