import api from "./axios";

export const startSession = async (channelName) => {
  const res = await api.post("/sessions/start", { channelName });
  return res.data.session;
};

export const joinSession = async (sessionId) => {
  await api.post("/sessions/join", { sessionId });
};

export const leaveSession = async (sessionId) => {
  await api.post("/sessions/leave", { sessionId });
};

export const stopSession = async (sessionId) => {
  await api.post("/sessions/stop", { sessionId });
};
