import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import agoraRoutes from "./routes/agora.routes.js";
import sessionRoutes from "./routes/session.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

const app = express();

// ✅ FIXED CORS
app.use(cors());



app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ProCast Backend is running 🚀",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/agora", agoraRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/uploads", uploadRoutes);

export default app;
