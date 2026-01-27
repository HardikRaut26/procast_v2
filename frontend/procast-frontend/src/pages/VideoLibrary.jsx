import { useEffect, useState } from "react";
import api from "../api/axios";

function Library() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      const res = await api.get("/library");
      setVideos(res.data.videos || []);
    } catch (err) {
      console.error("Failed to load library", err);
    } finally {
      setLoading(false);
    }
  };

  const deleteVideo = async (fileId) => {
    if (!confirm("Delete this video?")) return;

    await api.delete(`/library/${fileId}`);
    loadVideos();
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>🎬 Video Library</h2>

      {loading && <p>Loading...</p>}
      {!loading && videos.length === 0 && <p>No recordings yet</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 20,
        }}
      >
        {videos.map((video) => (
          <div
            key={video.fileId}
            style={{ border: "1px solid #ccc", padding: 12 }}
          >
            <video src={video.url} controls style={{ width: "100%" }} />

            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <a href={video.url} download>
                Download
              </a>

              <button
                onClick={() => deleteVideo(video.fileId)}
                style={{ color: "red" }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Library;
