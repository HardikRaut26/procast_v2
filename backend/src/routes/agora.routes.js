import express from "express";
import { generateAgoraToken } from "../controllers/agora.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * @route   POST /api/agora/token
 * @desc    Generate Agora RTC Token
 * @access  Private
 */
router.post("/token", authMiddleware, generateAgoraToken);

export default router;
