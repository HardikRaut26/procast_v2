import express from "express";
import { startSession } from "../controllers/session.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import { stopSession } from "../controllers/session.controller.js";
import {
  addParticipant,
  removeParticipant,
  getSession,
  getParticipants,
  registerAgoraUid,
  getAgoraUidMapping,
} from "../controllers/session.controller.js";
import {
  broadcastRecording,
  getRecordingState
} from "../controllers/session.controller.js";



const router = express.Router();

// More specific routes FIRST (to prevent shadowing by /:sessionId pattern)

/**
 * @route   POST /api/sessions/start
 * @desc    Start a new live session (server assigns a unique Agora channel per meeting)
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

/**
 * @route   POST /api/sessions/broadcast-recording
 * @desc    Broadcast recording start/stop to participants
 * @access  Private
 */
router.post("/broadcast-recording", authMiddleware, broadcastRecording);

/**
 * @route   GET /api/sessions/recording-state/:sessionId
 * @desc    Get recording state for a session
 * @access  Private
 */
router.get("/recording-state/:sessionId", authMiddleware, getRecordingState);

// Less specific routes with :sessionId parameter (these come last)

/**
 * @route   POST /api/sessions/:sessionId/register-agora-uid
 * @desc    Register Agora UID for a participant when they join the Agora channel
 * @access  Private
 */
router.post("/:sessionId/register-agora-uid", authMiddleware, registerAgoraUid);

/**
 * @route   GET /api/sessions/:sessionId/agora-uid-mapping
 * @desc    Get the Agora UID to user mapping for a session
 * @access  Private
 */
router.get("/:sessionId/agora-uid-mapping", authMiddleware, getAgoraUidMapping);

/**
 * @route   GET /api/sessions/:sessionId/participants
 * @desc    Get session participants with their user details
 * @access  Private
 */
router.get("/:sessionId/participants", authMiddleware, getParticipants);

/**
 * @route   GET /api/sessions/:sessionId
 * @desc    Get session (e.g. status) so participants can detect when host ended
 * @access  Private
 */
router.get("/:sessionId", authMiddleware, getSession);




export default router;
