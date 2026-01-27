import api from "./axios";

/**
 * Fetch secure Agora token from backend
 */
export const getAgoraToken = async (channelName) => {
  const response = await api.post("/agora/token", {
    channelName,
  });

  return response.data.token;
};
