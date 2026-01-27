export const broadcastRecording = async (req, res) => {
  const { sessionId, action } = req.body;

  global.sessionRecordingState = global.sessionRecordingState || {};
  global.sessionRecordingState[sessionId] = action;

  console.log(`📡 Broadcast recording: ${action} for ${sessionId}`);

  res.json({ success: true });
};
