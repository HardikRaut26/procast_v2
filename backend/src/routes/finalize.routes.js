import express from "express";
import { finalizeSession } from "../controllers/finalize.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

// POST /api/finalize
router.post("/finalize", authMiddleware, finalizeSession);

export default router;
