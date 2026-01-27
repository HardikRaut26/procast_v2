import express from "express";
import { startSession } from "../controllers/session.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { stopSession } from "../controllers/session.controller.js";
import {
  addParticipant,
  removeParticipant,
} from "../controllers/session.controller.js";
import {
  broadcastRecording,
  getRecordingState
} from "../controllers/session.controller.js";



const router = express.Router();

/**
 * @route   POST /api/sessions/start
 * @desc    Start a new live session
 * @access  Private
 */
router.post("/start", authMiddleware, startSession);
/**
 * @route   POST /api/sessions/stop
 * @desc    Stop a live session
 * @access  Private
 */
router.post("/stop", authMiddleware, stopSession);

/**
 * @route   POST /api/sessions/join
 * @desc    Add participant to live session
 * @access  Private
 */
router.post("/join", authMiddleware, addParticipant);

/**
 * @route   POST /api/sessions/leave
 * @desc    Remove participant from session
 * @access  Private
 */
router.post("/leave", authMiddleware, removeParticipant);

router.post("/broadcast-recording", authMiddleware, broadcastRecording);
router.get("/recording-state/:sessionId", authMiddleware, getRecordingState);




export default router;
