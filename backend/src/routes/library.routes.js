import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
  getVideoLibrary,
  deleteVideo,
  downloadVideoStream,
  inlineVideoStream,
  getTranscriptForSession,
} from "../controllers/library.controller.js";

const router = express.Router();

router.get("/library", authMiddleware, getVideoLibrary);
router.get("/library/:sessionId/transcript", authMiddleware, getTranscriptForSession);
router.get("/library/:fileId/download", authMiddleware, downloadVideoStream);
router.get("/library/:fileId/stream", authMiddleware, inlineVideoStream);
router.delete("/library/:fileId", authMiddleware, deleteVideo);

export default router;
