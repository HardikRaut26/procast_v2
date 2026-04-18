import api from "./axios";

export const startSession = async () => {
  const res = await api.post("/sessions/start", {});
  return res.data.session;
};

export const joinSession = async (sessionId) => {
  const res = await api.post("/sessions/join", { sessionId });
  return res.data;
};

export const leaveSession = async (sessionId) => {
  await api.post("/sessions/leave", { sessionId });
};

export const stopSession = async (sessionId) => {
  await api.post("/sessions/stop", { sessionId });
};

export const getSession = async (sessionId) => {
  const res = await api.get(`/sessions/${sessionId}`);
  return res.data.session;
};
