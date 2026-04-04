import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    channelName: {
      type: String,
      required: true,
    },
    // Human-friendly invite code (5 digits)
    meetingCode: {
      type: String,
      match: /^\d{5}$/,
      unique: true,
      sparse: true,
    },

    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ ADD THIS
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      }
    ],

    // Map Agora UID to MongoDB User ID for participant identification
    agoraUidMap: {
      type: [{
        agoraUid: String,
        userId: mongoose.Schema.Types.ObjectId,
        name: String,
        profilePhoto: String,
      }],
      default: [],
    },

    participantFiles: {
      type: Map,
      of: String,
      default: {},
    },

    startTime: {
      type: Date,
      required: true,
    },

    finalMeetingFileId: {
      type: String,
    },

    // Optional transcript .txt file in B2
    transcriptFileId: {
      type: String,
    },

    endTime: Date,

    duration: Number,

    status: {
      type: String,
      enum: ["LIVE", "ENDED"],
      default: "LIVE",
    },
    recordingState: {
      type: String,
      enum: ["IDLE", "START", "STOP"],
      default: "IDLE",
    },

    transcript: [
      {
        speaker: String,
        text: String,
        start: Number,
        end: Number,
      },
    ],

    transcriptionStatus: {
      type: String,
      enum: ["NONE", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"],
      default: "NONE",
    },
    transcriptionMeta: {
      provider: { type: String, default: "whisper-cli" },
      model: { type: String },
      language: { type: String },
      task: { type: String },
      generatedAt: { type: Date },
      totalParticipants: { type: Number },
      succeededParticipants: { type: Number },
      failedParticipants: { type: Number },
    },

    // AI-generated meeting summary (optional)
    meetingSummary: {
      summary: String,
      key_points: [String],
      action_items: [
        {
          owner: String,
          task: String,
        },
      ],
      decisions: [String],
      model: String,
      generatedAt: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Session", sessionSchema);
