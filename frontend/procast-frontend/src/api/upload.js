import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export const uploadChunkToBackend = async ({
  file,
  sessionId,
  chunkIndex,
}) => {
  const token = localStorage.getItem("token");

  const formData = new FormData();

  // 🔴 THIS KEY NAME IS CRITICAL
  formData.append("file", file);       // 👈 MUST BE "file"
  formData.append("sessionId", sessionId);
  formData.append("chunkIndex", chunkIndex);

  return axios.post(
    `${API_BASE}/api/uploads/chunk`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};
