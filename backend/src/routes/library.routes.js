import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
  getVideoLibrary,
  deleteVideo,
} from "../controllers/library.controller.js";

const router = express.Router();

router.get("/library", authMiddleware, getVideoLibrary);
router.delete("/library/:fileId", authMiddleware, deleteVideo);

export default router;
