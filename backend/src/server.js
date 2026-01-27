import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";
import uploadRoutes from "./routes/upload.routes.js";
import finalizeRoutes from "./routes/finalize.routes.js";
import rebuildRoutes from "./routes/rebuild.routes.js";
import libraryRoutes from "./routes/library.routes.js";





dotenv.config();

const PORT = process.env.PORT || 5000;

// Connect MongoDB
connectDB();



app.use("/api/uploads", uploadRoutes);
app.use("/api", finalizeRoutes);
app.use("/api/rebuild", rebuildRoutes);
app.use("/api", libraryRoutes);


import User from "./models/User.js";

const testUser = async () => {
  const count = await User.countDocuments();
  console.log("👤 User collection ready. Current users:", count);
};
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 ProCast Server running on port ${PORT}`);
});

testUser();
