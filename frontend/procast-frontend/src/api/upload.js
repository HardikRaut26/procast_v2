import api from "./axios";

export const uploadChunkToBackend = async ({
  file,
  sessionId,
  chunkIndex,
  /** ms since session startTime (global meeting clock); omit → server estimates from upload time */
  chunkStartMs,
}) => {
  const formData = new FormData();

  // 🔴 THIS KEY NAME IS CRITICAL
  formData.append("file", file);       // 👈 MUST BE "file"
  formData.append("sessionId", sessionId);
  formData.append("chunkIndex", chunkIndex);
  if (chunkStartMs != null && Number.isFinite(Number(chunkStartMs))) {
    formData.append("chunkStartMs", String(Math.max(0, Math.round(Number(chunkStartMs)))));
  }

  // Uses the shared axios instance (`src/api/axios.js`) so it goes through Vite's
  // `/api` proxy to your local backend. This also ensures your backend logs appear.
  const maxAttempts = 4;
  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await api.post("/uploads/chunk", formData);
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const retryable = err?.response?.data?.retryable;
      if (!(status === 503 || retryable === true) || i === maxAttempts - 1) {
        throw err;
      }
      const delay = Math.min(4000, 400 * Math.pow(2, i));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};
