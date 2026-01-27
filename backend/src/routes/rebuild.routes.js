import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { rebuildParticipant } from "../controllers/rebuildParticipant.controller.js";

const router = express.Router();

router.post("/participant", authMiddleware, rebuildParticipant);

export default router;
