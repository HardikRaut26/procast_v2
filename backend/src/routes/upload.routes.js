import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/auth.middleware.js";
import { uploadChunk } from "../controllers/upload.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post(
  "/chunk",
  authMiddleware,
  upload.single("file"), // 🚨 MUST be "file"
  uploadChunk
);

export default router;
