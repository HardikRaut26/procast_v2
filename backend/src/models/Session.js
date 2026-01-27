import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    channelName: {
      type: String,
      required: true,
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

  },
  { timestamps: true },

);

export default mongoose.model("Session", sessionSchema);
