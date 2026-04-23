import "./config/loadEnv.js";
import app from "./app.js";
import connectDB from "./config/db.js";
import uploadRoutes from "./routes/upload.routes.js";
import finalizeRoutes from "./routes/finalize.routes.js";
import rebuildRoutes from "./routes/rebuild.routes.js";
import libraryRoutes from "./routes/library.routes.js";





const PORT = process.env.PORT || 5000;

// Connect MongoDB
connectDB();



app.use("/api/uploads", uploadRoutes);
app.use("/api", finalizeRoutes);
app.use("/api/rebuild", rebuildRoutes);
app.use("/api", libraryRoutes);


import User from "./models/User.js";
import Session from "./models/Session.js";

app.get("/api/public-stats", async (req, res) => {
  try {
    const [activeCreators, podcastsRecorded] = await Promise.all([
      User.countDocuments(),
      Session.countDocuments({ finalMeetingFileId: { $exists: true, $ne: null } }),
    ]);

    return res.status(200).json({
      success: true,
      activeCreators,
      podcastsRecorded,
      uptime: "99.9%",
      userRating: "4.9★",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ public-stats error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load public stats",
    });
  }
});

const testUser = async () => {
  const count = await User.countDocuments();
  console.log("👤 User collection ready. Current users:", count);
};
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 ProCast Server running on port ${PORT}`);
});

testUser();
