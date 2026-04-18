import { finalizeSessionService } from "../services/finalize.service.js";


export const finalizeSession = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId required" });
    }

    await finalizeSessionService(sessionId);

    res.json({
      success: true,
      message: "Finalize started",
    });

  } catch (err) {
    console.error("Finalize controller error:", err);
    res.status(500).json({ message: err.message });
  }
};