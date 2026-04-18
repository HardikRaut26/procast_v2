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

// Minimal request logger for the main flows.
// Helps confirm the frontend is actually calling these endpoints.
app.use((req, res, next) => {
  const url = String(req.originalUrl || "");
  const important =
    url.startsWith("/api/sessions") || url.startsWith("/api/uploads");
  if (!important) return next();

  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(
      `[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`
    );
  });
  next();
});

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
