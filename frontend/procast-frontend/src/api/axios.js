import axios from "axios";

const api = axios.create({
  baseURL: "/api", // 👈 IMPORTANT (proxy will handle this)
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let redirectScheduled = false;
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && err?.config?.headers?.Authorization) {
      localStorage.removeItem("token");
      if (!redirectScheduled) {
        redirectScheduled = true;
        setTimeout(() => {
          window.location.href = "/login";
        }, 5000);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
