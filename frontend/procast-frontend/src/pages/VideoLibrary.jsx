import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";

// Copy — change these to customize the page
const copy = {
  kicker: "YOUR COLLECTION",
  title: "Every session, one place.",
  subtitle: "Watch, download, or remove your meeting recordings. All your calls in a clean, searchable library.",
  statLabel: "Recordings",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  searchPlaceholder: "Search by ID or name…",
  errorTitle: "Couldn’t load your library",
  errorHint: "Check your connection and try again.",
  emptyTitle: "Your library is empty",
  emptySub: "Record a call from the Call page — it’ll show up here so you can watch or download anytime.",
  noResultsTitle: "No matches",
  noResultsSub: "Try a different search or clear the search box.",
  cardBadge: "Session",
  cardIdLabel: "Recording ID",
  download: "Save to device",
  open: "Watch in new tab",
  delete: "Remove",
  deleteConfirm: "Remove this recording? This can’t be undone.",
  deleteFailed: "Couldn’t remove it. Try again.",
};

function Library() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [previewEnabledByFileId, setPreviewEnabledByFileId] = useState({});
  const [watchingId, setWatchingId] = useState("");

  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [transcriptItems, setTranscriptItems] = useState([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptLoadingFor, setTranscriptLoadingFor] = useState("");
  const [transcriptError, setTranscriptError] = useState("");
  const [meetingSummary, setMeetingSummary] = useState(null);
  const [translationNotice, setTranslationNotice] = useState("");
  const [transcriptLanguage, setTranscriptLanguage] = useState("original");
  const [activeTranscriptSessionId, setActiveTranscriptSessionId] = useState("");

  const transcriptLanguageOptions = [
    { value: "original", label: "Original" },
    { value: "en", label: "English" },
    { value: "hi", label: "Hindi" },
    { value: "mr", label: "Marathi" },
    { value: "sa", label: "Sanskrit" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "pt", label: "Portuguese" },
    { value: "ar", label: "Arabic" },
    { value: "ja", label: "Japanese" },
  ];

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      setError("");
      setLoading(true);
      const res = await api.get("/library");
      setVideos(res.data.videos || []);
    } catch (err) {
      console.error("Failed to load library", err);
      setError(copy.errorHint);
    } finally {
      setLoading(false);
    }
  };

  const deleteVideo = async (fileId) => {
    if (!confirm(copy.deleteConfirm)) return;

    try {
      await api.delete(`/library/${fileId}`);
      loadVideos();
    } catch (err) {
      console.error("Failed to delete video", err);
      alert(copy.deleteFailed);
    }
  };

  const downloadVideo = async (video, idx) => {
    const fileId = String(video?.fileId || "");
    if (!fileId) return;

    const filename = `procast-session-${String(idx + 1).padStart(2, "0")}.webm`;

    try {
      setDownloadingId(fileId);
      const res = await api.get(`/library/${fileId}/download`, {
        responseType: "blob",
      });
      const blob = res.data;
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.warn("Download failed", e);
      const status = e?.response?.status;
      const msg = String(e?.response?.data?.message || e?.message || "");
      if (status === 403 || msg.toLowerCase().includes("download_cap_exceeded")) {
        alert(
          "B2 download limit reached right now. Please try again later. You can still open “View transcript”."
        );
      } else if (video?.url) {
        window.open(video.url, "_blank", "noreferrer");
      }
    } finally {
      setDownloadingId("");
    }
  };

  const downloadTranscript = async (video, idx) => {
    const fileId = String(video?.transcriptFileId || "");
    if (!fileId) return;

    const filename = `procast-session-${String(idx + 1).padStart(
      2,
      "0"
    )}-transcript.txt`;

    try {
      setDownloadingId(fileId);
      const res = await api.get(`/library/${fileId}/download`, {
        responseType: "blob",
      });
      const blob = res.data;
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.warn("Download transcript failed", e);
      const status = e?.response?.status;
      const msg = String(e?.response?.data?.message || e?.message || "");
      if (status === 403 || msg.toLowerCase().includes("download_cap_exceeded")) {
        alert(
          "B2 download limit reached right now. Transcript text is still available via “View transcript”."
        );
      }
    } finally {
      setDownloadingId("");
    }
  };

  const formatTime = (seconds) => {
    if (typeof seconds !== "number" || Number.isNaN(seconds)) return "";
    const totalMs = Math.round(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = (totalMs - ms) / 1000;
    const s = totalSec % 60;
    const m = Math.floor((totalSec / 60) % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return `${mm}:${ss}.${String(ms).padStart(3, "0")}`;
  };

  const openTranscript = useCallback(async (sessionId, language = transcriptLanguage) => {
    if (!sessionId) return;

    setIsTranscriptModalOpen(true);
    setTranscriptLoading(true);
    setTranscriptLoadingFor(String(sessionId));
    setActiveTranscriptSessionId(String(sessionId));
    setTranscriptError("");
    setTranscriptItems([]);
    setMeetingSummary(null);
    setTranslationNotice("");

    try {
      const res = await api.get(`/library/${sessionId}/transcript`, {
        params: { lang: language },
      });
      setTranscriptItems(res.data?.transcript || []);
      setMeetingSummary(res.data?.meetingSummary || null);
      setTranslationNotice(res.data?.translationError || "");
    } catch (e) {
      console.error("Failed to load transcript", e);
      setTranscriptError("Couldn’t load transcript. Try again.");
    } finally {
      setTranscriptLoading(false);
      setTranscriptLoadingFor("");
    }
  }, [transcriptLanguage]);

  const watchInNewTab = async (video) => {
    const fileId = String(video?.fileId || "");
    if (!fileId) return;
    try {
      setWatchingId(fileId);
      const res = await api.get(`/library/${fileId}/stream`, {
        responseType: "blob",
      });

      const blob = res.data;
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noreferrer");

      // Give the new tab time to start reading before revoking.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      console.warn("Watch in new tab failed", e);
      const status = e?.response?.status;
      const msg = String(e?.response?.data?.message || e?.message || "");
      if (status === 401) {
        alert("Session expired. Please login again.");
      } else if (status === 403 || msg.toLowerCase().includes("download_cap_exceeded")) {
        alert("B2 download limit reached right now. Try again later.");
      } else {
        alert("Couldn’t open video. Try again.");
      }
    } finally {
      setWatchingId("");
    }
  };

  const enablePreview = (fileId) => {
    const id = String(fileId || "");
    if (!id) return;
    setPreviewEnabledByFileId((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  };

  const closeTranscriptModal = () => {
    setIsTranscriptModalOpen(false);
    setTranscriptItems([]);
    setTranscriptError("");
    setMeetingSummary(null);
    setTranslationNotice("");
    setActiveTranscriptSessionId("");
  };

  useEffect(() => {
    if (!isTranscriptModalOpen || !activeTranscriptSessionId) return;
    openTranscript(activeTranscriptSessionId, transcriptLanguage);
  }, [activeTranscriptSessionId, isTranscriptModalOpen, openTranscript, transcriptLanguage]);

  const filteredVideos = videos.filter((v) =>
    String(v?.fileId || "")
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {isTranscriptModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
          onClick={closeTranscriptModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(900px, 100%)",
              maxHeight: "min(78vh, 720px)",
              overflow: "hidden",
              background: "#fff",
              color: "#0b0b0b",
              borderRadius: 18,
              border: "1px solid rgba(0,0,0,0.08)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 900 }}>Transcript</div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <label
                  htmlFor="transcript-language"
                  style={{ fontSize: 12, color: "#555", fontWeight: 700 }}
                >
                  Language
                </label>
                <select
                  id="transcript-language"
                  value={transcriptLanguage}
                  onChange={(e) => setTranscriptLanguage(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid rgba(0,0,0,0.18)",
                    borderRadius: 10,
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {transcriptLanguageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={closeTranscriptModal}
                  style={{
                    padding: "8px 12px",
                    border: "2px solid rgba(0,0,0,0.18)",
                    borderRadius: 10,
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 18, overflow: "auto" }}>
              {translationNotice ? (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "rgba(255, 193, 7, 0.15)",
                    border: "1px solid rgba(255, 152, 0, 0.35)",
                    color: "#5d4037",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {translationNotice}
                </div>
              ) : null}
              {transcriptLoading ? (
                <div style={{ color: "#444", fontWeight: 700 }}>Loading…</div>
              ) : transcriptError ? (
                <div style={{ color: "#b00020", fontWeight: 800 }}>
                  {transcriptError}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {meetingSummary ? (
                    <div
                      style={{
                        padding: "12px 12px",
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.06)",
                        background: "rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>
                        Meeting Summary
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          lineHeight: 1.55,
                          color: "#222",
                        }}
                      >
                        {meetingSummary.summary || "—"}
                      </div>

                      {Array.isArray(meetingSummary.key_points) &&
                        meetingSummary.key_points.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>
                              Key Points
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {meetingSummary.key_points.map((k, idx) => (
                                <li key={idx} style={{ marginBottom: 4 }}>
                                  {k}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {Array.isArray(meetingSummary.action_items) &&
                        meetingSummary.action_items.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>
                              Action Items
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {meetingSummary.action_items.map((a, idx) => (
                                <li key={idx} style={{ marginBottom: 4 }}>
                                  <b>{a.owner || "Unassigned"}:</b>{" "}
                                  {a.task || ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {Array.isArray(meetingSummary.decisions) &&
                        meetingSummary.decisions.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>
                              Decisions
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {meetingSummary.decisions.map((d, idx) => (
                                <li key={idx} style={{ marginBottom: 4 }}>
                                  {d}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  ) : null}

                  {transcriptItems.length === 0 ? (
                    <div style={{ color: "#555", fontWeight: 700 }}>
                      No transcript found for this session.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {transcriptItems.map((t, i) => (
                        <div
                          key={`${t.speaker || "speaker"}-${t.start || i}-${i}`}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "rgba(0,0,0,0.02)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              color: "#666",
                              fontWeight: 800,
                            }}
                          >
                            <span>{t.speaker || "Speaker"}</span>
                            {typeof t.start === "number" ? (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontWeight: 900,
                                  color: "#444",
                                }}
                              >
                                · {formatTime(t.start)}
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 14,
                              lineHeight: 1.5,
                            }}
                          >
                            {t.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={styles.header}>
        <div>
          <p style={styles.kicker}>{copy.kicker}</p>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.statCard}>
            <p style={styles.statLabel}>{copy.statLabel}</p>
            <p style={styles.statValue}>{videos.length}</p>
          </div>
          <button
            type="button"
            style={styles.refreshBtn}
            onClick={loadVideos}
            disabled={loading}
          >
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </div>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <span style={styles.searchIcon}>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            style={styles.search}
          />
        </div>
      </div>

      {error && (
        <div style={styles.errorCard}>
          <p style={styles.errorTitle}>{copy.errorTitle}</p>
          <p style={styles.errorText}>{error}</p>
        </div>
      )}

      {loading ? (
        <div style={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={styles.skeletonCard} className="pc-skeleton">
              <div style={styles.skeletonVideo} />
              <div style={styles.skeletonRow} />
              <div style={styles.skeletonRowSmall} />
            </div>
          ))}
        </div>
      ) : filteredVideos.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon} />
          <h3 style={styles.emptyTitle}>
            {videos.length === 0 ? copy.emptyTitle : copy.noResultsTitle}
          </h3>
          <p style={styles.emptyText}>
            {videos.length === 0 ? copy.emptySub : copy.noResultsSub}
          </p>
        </div>
      ) : (
        <div style={styles.grid}>
          {filteredVideos.map((video, idx) => (
            <div
              key={video.fileId}
              style={{ ...styles.card, animationDelay: `${idx * 55}ms` }}
              className="pc-card"
            >
              <div style={styles.videoFrame}>
                <video
                  src={
                    previewEnabledByFileId[String(video.fileId || "")] && video.fileId
                      ? `/api/library/${video.fileId}/stream`
                      : undefined
                  }
                  controls
                  preload="none"
                  style={styles.video}
                  onClick={() => enablePreview(video.fileId)}
                />
                <div style={styles.badge}>
                  <span style={styles.badgeDot} />
                  {copy.cardBadge} {String(idx + 1).padStart(2, "0")}
                </div>
              </div>

              <div style={styles.meta}>
                <p style={styles.metaLabel}>{copy.cardIdLabel}</p>
                <p style={styles.metaValue} title={video.fileId}>
                  {video.fileId}
                </p>
              </div>

              <div style={styles.actions}>
                <button
                  type="button"
                  onClick={() => downloadVideo(video, idx)}
                  style={styles.actionBtn}
                  className="pc-btn"
                  disabled={downloadingId === String(video?.fileId || "")}
                >
                  {downloadingId === String(video?.fileId || "")
                    ? "Downloading…"
                    : copy.download}
                </button>
                {video.transcriptFileId && (
                  <button
                    type="button"
                    onClick={() => downloadTranscript(video, idx)}
                    style={styles.actionBtnSecondary}
                    className="pc-btn"
                    disabled={
                      downloadingId === String(video?.transcriptFileId || "")
                    }
                  >
                    {downloadingId === String(video?.transcriptFileId || "")
                      ? "Preparing…"
                      : "Transcript (.txt)"}
                  </button>
                )}
                {video.transcriptFileId && (
                  <button
                    type="button"
                    onClick={() => openTranscript(video.sessionId)}
                    style={styles.actionBtnSecondary}
                    className="pc-btn"
                    disabled={
                      transcriptLoading &&
                      transcriptLoadingFor === String(video.sessionId || "")
                    }
                  >
                    {transcriptLoading &&
                    transcriptLoadingFor === String(video.sessionId || "")
                      ? "Loading…"
                      : "View transcript"}
                  </button>
                )}
                <a
                  href="#"
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => watchInNewTab(video)}
                  style={styles.actionBtnSecondary}
                  className="pc-btn"
                  disabled={watchingId === String(video?.fileId || "")}
                >
                  {watchingId === String(video?.fileId || "")
                    ? "Opening…"
                    : copy.open}
                </button>
                <button
                  type="button"
                  onClick={() => deleteVideo(video.fileId)}
                  style={styles.deleteBtn}
                  className="pc-btn"
                >
                  {copy.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Library;

const css = `
  .pc-card {
    animation: pcEnter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pcEnter {
    from { opacity: 0; transform: translateY(20px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .pc-card:hover {
    transform: translateY(-6px);
    box-shadow: 0 20px 50px rgba(0,0,0,0.12);
  }
  .pc-btn { text-decoration: none; }
  .pc-btn:focus { outline: none; }
  .pc-btn:focus-visible { box-shadow: 0 0 0 3px rgba(0,0,0,0.15); }
  .pc-skeleton { position: relative; overflow: hidden; }
  .pc-skeleton::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: translateX(-60%);
    background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(0,0,0,0.06) 50%, rgba(255,255,255,0) 100%);
    animation: pcShimmer 1.2s ease-in-out infinite;
  }
  @keyframes pcShimmer {
    0% { transform: translateX(-60%); }
    100% { transform: translateX(60%); }
  }
`;

const styles = {
  page: {
    minHeight: "100vh",
    padding: "110px 28px 56px",
    background: "linear-gradient(180deg, #fafafa 0%, #fff 24%)",
    color: "#0b0b0b",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    maxWidth: 1200,
    margin: "0 auto 28px",
    display: "flex",
    justifyContent: "space-between",
    gap: 24,
    alignItems: "center",
  },
  kicker: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 4,
    color: "#888",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "12px 0 10px",
    fontSize: "clamp(30px, 4.5vw, 48px)",
    letterSpacing: "-1.2px",
    lineHeight: 1.08,
    fontWeight: 800,
    color: "#000",
  },
  subtitle: {
    margin: 0,
    maxWidth: 560,
    color: "#5c5c5c",
    lineHeight: 1.6,
    fontSize: 15,
  },
  headerRight: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  statCard: {
    padding: "12px 14px",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(0,0,0,0.02)",
    minWidth: 96,
  },
  statLabel: { margin: 0, fontSize: 12, color: "#777", fontWeight: 600 },
  statValue: { margin: "2px 0 0", fontSize: 22, fontWeight: 800 },
  refreshBtn: {
    padding: "12px 16px",
    borderRadius: 999,
    border: "2px solid #000",
    background: "#000",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  toolbar: {
    maxWidth: 1200,
    margin: "0 auto 22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  searchWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(0,0,0,0.02)",
    maxWidth: 520,
  },
  searchIcon: { color: "#666", fontSize: 16 },
  search: {
    width: "100%",
    border: "none",
    outline: "none",
    fontSize: 14,
    background: "transparent",
    color: "#111",
  },
  errorCard: {
    maxWidth: 1200,
    margin: "0 auto 18px",
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  errorTitle: { margin: 0, fontWeight: 800, fontSize: 14 },
  errorText: { margin: "6px 0 0", color: "#555", fontSize: 14 },
  grid: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 18,
  },
  card: {
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.06)",
    background: "#fff",
    overflow: "hidden",
    boxShadow: "0 10px 40px rgba(0,0,0,0.06)",
    transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s ease",
  },
  videoFrame: { position: "relative", background: "#000" },
  video: {
    width: "100%",
    height: 220,
    objectFit: "cover",
    display: "block",
    background: "#000",
  },
  badge: {
    position: "absolute",
    left: 14,
    top: 14,
    padding: "8px 12px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backdropFilter: "blur(10px)",
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    background: "#fff",
    opacity: 0.9,
  },
  meta: { padding: "14px 16px 0" },
  metaLabel: { margin: 0, fontSize: 12, color: "#777", fontWeight: 700 },
  metaValue: {
    margin: "6px 0 0",
    fontSize: 13,
    fontWeight: 700,
    color: "#111",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    padding: 16,
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 14px",
    borderRadius: 14,
    border: "2px solid #000",
    background: "#000",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    transition: "transform 0.2s ease",
  },
  actionBtnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 14px",
    borderRadius: 14,
    border: "2px solid rgba(0,0,0,0.18)",
    background: "#fff",
    color: "#000",
    fontWeight: 800,
    cursor: "pointer",
    transition: "transform 0.2s ease",
  },
  deleteBtn: {
    gridColumn: "1 / -1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 14px",
    borderRadius: 14,
    border: "2px solid rgba(0,0,0,0.18)",
    background: "#fff",
    color: "#111",
    fontWeight: 800,
    cursor: "pointer",
    transition: "transform 0.2s ease",
  },
  skeletonCard: {
    borderRadius: 22,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "#fff",
    overflow: "hidden",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  skeletonVideo: { height: 220, background: "rgba(0,0,0,0.06)" },
  skeletonRow: { height: 14, margin: 16, background: "rgba(0,0,0,0.06)", borderRadius: 8 },
  skeletonRowSmall: {
    height: 12,
    margin: "0 16px 16px",
    background: "rgba(0,0,0,0.06)",
    borderRadius: 8,
    width: "60%",
  },
  empty: {
    maxWidth: 560,
    margin: "42px auto 0",
    textAlign: "center",
    padding: "34px 24px",
    borderRadius: 24,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(0,0,0,0.02)",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    margin: "0 auto 14px",
    borderRadius: 20,
    background:
      "linear-gradient(135deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.03) 100%)",
  },
  emptyTitle: { margin: "8px 0 8px", fontSize: 18, fontWeight: 900 },
  emptyText: { margin: 0, color: "#666", lineHeight: 1.6, fontSize: 14 },
};
