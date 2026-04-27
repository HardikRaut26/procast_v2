import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";

// Copy — change these to customize the page
const copy = {
  kicker: "RECENT RECORDINGS",
  title: "A clean, modern session library.",
  subtitle:
    "Browse your latest sessions, open recordings instantly, and track files that are still processing.",
  statLabel: "Recordings",
  autoRefreshActive: "Live updates: ON",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  searchPlaceholder: "Search by date, time, or recording ID…",
  errorTitle: "Couldn’t load your library",
  errorHint: "Check your connection and try again.",
  emptyTitle: "Your library is empty",
  emptySub: "Record a call from the Call page — it’ll show up here so you can watch or download anytime.",
  noResultsTitle: "No matches",
  noResultsSub: "Try a different search or clear the search box.",
  cardBadge: "Session",
  cardDateLabel: "Recorded on",
  pipelineLabel: "Pipeline status",
  download: "Save to device",
  open: "Watch in new tab",
  delete: "Remove",
  processing: "Processing",
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
  const [expandedDownloadCard, setExpandedDownloadCard] = useState("");

  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [transcriptItems, setTranscriptItems] = useState([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptLoadingFor, setTranscriptLoadingFor] = useState("");
  const [transcriptError, setTranscriptError] = useState("");
  const [meetingSummary, setMeetingSummary] = useState(null);
  const [translationNotice, setTranslationNotice] = useState("");
  const [transcriptLanguage, setTranscriptLanguage] = useState("original");
  const [activeTranscriptSessionId, setActiveTranscriptSessionId] = useState("");

  const POLL_MS = 8000;

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

  const loadVideos = useCallback(async ({ silent = false } = {}) => {
    try {
      setError("");
      if (!silent) {
        setLoading(true);
      }
      const res = await api.get("/library");
      const next = [...(res.data.videos || [])].sort((a, b) => {
        const aTime = new Date(a?.createdAt || 0).getTime();
        const bTime = new Date(b?.createdAt || 0).getTime();
        return bTime - aTime;
      });
      setVideos(next);
    } catch (err) {
      console.error("Failed to load library", err);
      setError(copy.errorHint);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

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

  const downloadParticipantVideo = async (pv, sessionNumber) => {
    const fileId = String(pv?.fileId || "");
    if (!fileId) return;

    const safeName = (pv.name || "participant").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `procast-session-${String(sessionNumber).padStart(2, "0")}-${safeName}.webm`;

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
      console.warn("Participant download failed", e);
      const status = e?.response?.status;
      const msg = String(e?.response?.data?.message || e?.message || "");
      if (status === 403 || msg.toLowerCase().includes("download_cap_exceeded")) {
        alert("B2 download limit reached. Try again later.");
      } else {
        alert("Download failed. Try again.");
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

  const formatRecordingDateTime = (value) => {
    if (!value) return "Unknown date";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return date.toLocaleString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isProcessingVideo = (video) => {
    if (video?.processing === true) return true;
    return !video?.fileId;
  };

  const normalizePipelineLogs = (video) => {
    if (Array.isArray(video?.pipelineLogs) && video.pipelineLogs.length > 0) {
      return video.pipelineLogs;
    }

    if (isProcessingVideo(video)) {
      return [
        { key: "session-ended", label: "Session ended", state: "done" },
        { key: "final-video", label: "Final video is being generated", state: "active" },
      ];
    }

    return [
      { key: "final-video", label: "Final video generated", state: "done" },
      {
        key: "transcript",
        label: String(video?.transcriptionStatus || "") === "RUNNING"
          ? "Transcript is generating"
          : "Transcript status available",
        state: String(video?.transcriptionStatus || "") === "RUNNING" ? "active" : "done",
      },
    ];
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

  const normalizedQuery = query.trim().toLowerCase();

  const filteredVideos = videos.filter((v) => {
    if (!normalizedQuery) return true;
    const dateText = formatRecordingDateTime(v?.createdAt).toLowerCase();
    const idText = String(v?.fileId || "").toLowerCase();
    return dateText.includes(normalizedQuery) || idText.includes(normalizedQuery);
  });

  const sessionNumberByKey = videos
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a?.createdAt || 0).getTime();
      const bTime = new Date(b?.createdAt || 0).getTime();
      if (aTime !== bTime) return aTime - bTime;
      const aKey = String(a?.sessionId || a?.fileId || "");
      const bKey = String(b?.sessionId || b?.fileId || "");
      return aKey.localeCompare(bKey);
    })
    .reduce((acc, item, index) => {
      const key = String(item?.sessionId || item?.fileId || "");
      if (key) {
        acc[key] = index + 1;
      }
      return acc;
    }, {});

  const hasActiveProcessing = useMemo(
    () =>
      videos.some((video) => {
        if (isProcessingVideo(video)) return true;
        const logs = normalizePipelineLogs(video);
        return logs.some((log) => String(log?.state || "") === "active");
      }),
    [videos]
  );

  useEffect(() => {
    if (!hasActiveProcessing) return;

    const interval = setInterval(() => {
      loadVideos({ silent: true });
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [hasActiveProcessing, loadVideos]);

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
          <h1 style={styles.title}>{copy.title}</h1>
          <p style={styles.subtitle}>{copy.subtitle}</p>
        </div>

        <div style={styles.headerRight}>
          {hasActiveProcessing ? (
            <div style={styles.liveBadge}>{copy.autoRefreshActive}</div>
          ) : null}
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
            (() => {
              const badgeKey = String(video?.sessionId || video?.fileId || "");
              const sessionNumber =
                sessionNumberByKey[badgeKey] || idx + 1;

              return (
            <div
              key={video.fileId || String(video.sessionId || idx)}
              style={{ ...styles.card, animationDelay: `${idx * 55}ms` }}
              className="pc-card"
            >
              {isProcessingVideo(video) ? (
                <>
                  <div style={styles.videoFrameProcessing} className="pc-skeleton">
                    <div style={styles.processingBar} />
                    <div style={styles.processingBarSmall} />
                    <div style={styles.badgeProcessing}>
                      <span style={styles.badgeDotLive} />
                      {copy.cardBadge} {String(sessionNumber).padStart(2, "0")} · {copy.processing}
                    </div>
                  </div>

                  <div style={styles.meta}>
                    <p style={styles.metaLabel}>{copy.cardDateLabel}</p>
                    <p style={styles.metaValue}>{formatRecordingDateTime(video.createdAt)}</p>
                  </div>

                  <div style={styles.pipelineWrap}>
                    <p style={styles.pipelineTitle}>{copy.pipelineLabel}</p>
                    <div style={styles.pipelineList}>
                      {normalizePipelineLogs(video).map((log, logIndex) => (
                        <div key={`${log.key || "log"}-${logIndex}`} style={styles.pipelineItem}>
                          <span
                            style={{
                              ...styles.pipelineDot,
                              ...(log.state === "done"
                                ? styles.pipelineDotDone
                                : log.state === "failed"
                                  ? styles.pipelineDotFailed
                                  : log.state === "active"
                                    ? styles.pipelineDotActive
                                    : styles.pipelineDotPending),
                            }}
                          />
                          <span style={styles.pipelineText}>{log.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={styles.processingHint}>
                    We are preparing this recording. It will become playable here automatically after processing.
                  </div>
                </>
              ) : (
                <>
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
                      {copy.cardBadge} {String(sessionNumber).padStart(2, "0")}
                    </div>
                  </div>

                  <div style={styles.meta}>
                    <p style={styles.metaLabel}>{copy.cardDateLabel}</p>
                    <p style={styles.metaValue}>{formatRecordingDateTime(video.createdAt)}</p>
                  </div>

                  <div style={styles.pipelineWrapCompact}>
                    <p style={styles.pipelineTitle}>{copy.pipelineLabel}</p>
                    <div style={styles.pipelineList}>
                      {normalizePipelineLogs(video).map((log, logIndex) => (
                        <div key={`${log.key || "log"}-${logIndex}`} style={styles.pipelineItem}>
                          <span
                            style={{
                              ...styles.pipelineDot,
                              ...(log.state === "done"
                                ? styles.pipelineDotDone
                                : log.state === "failed"
                                  ? styles.pipelineDotFailed
                                  : log.state === "active"
                                    ? styles.pipelineDotActive
                                    : styles.pipelineDotPending),
                            }}
                          />
                          <span style={styles.pipelineText}>{log.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={styles.actions}>
                    <button
                      type="button"
                      onClick={() => setExpandedDownloadCard((prev) =>
                        prev === String(video.sessionId) ? "" : String(video.sessionId)
                      )}
                      style={{
                        ...styles.actionBtn,
                        ...(expandedDownloadCard === String(video.sessionId)
                          ? { background: "#111", color: "#fff" }
                          : {}),
                      }}
                      className="pc-btn"
                    >
                      {expandedDownloadCard === String(video.sessionId)
                        ? "Close downloads"
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
                          ? "Preparing\u2026"
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
                          ? "Loading\u2026"
                          : "View transcript"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => watchInNewTab(video)}
                      style={styles.actionBtnSecondary}
                      className="pc-btn"
                      disabled={watchingId === String(video?.fileId || "")}
                    >
                      {watchingId === String(video?.fileId || "")
                        ? "Opening\u2026"
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

                  {/* Expandable download panel */}
                  {expandedDownloadCard === String(video.sessionId) && (
                    <div style={{
                      marginTop: 12,
                      padding: "14px",
                      borderRadius: 14,
                      background: "rgba(0,0,0,0.02)",
                      border: "1px solid rgba(0,0,0,0.06)",
                      animation: "pcEnter 0.25s ease both",
                    }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: "#555",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                        marginBottom: 10,
                      }}>
                        Download Options
                      </div>

                      {/* Final merged video */}
                      <div style={{
                        display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: 8,
                        padding: "10px 12px", borderRadius: 10,
                        background: "#fff",
                        border: "1px solid rgba(0,0,0,0.08)",
                        marginBottom: Array.isArray(video.participantVideos) && video.participantVideos.length > 0 ? 8 : 0,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                          </svg>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Final Merged Video</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 1 }}>Combined grid of all participants</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="pc-btn"
                          onClick={() => downloadVideo(video, idx)}
                          disabled={downloadingId === String(video?.fileId || "")}
                          style={{
                            padding: "8px 16px", fontSize: 13, fontWeight: 700,
                            border: "none", borderRadius: 8,
                            background: "#111", color: "#fff",
                            cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          {downloadingId === String(video?.fileId || "") ? "Saving\u2026" : "Download"}
                        </button>
                      </div>

                      {/* Individual participant recordings */}
                      {Array.isArray(video.participantVideos) && video.participantVideos.length > 0 && (
                        <>
                          <div style={{
                            display: "flex", alignItems: "center", gap: 6,
                            margin: "12px 0 8px",
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                              <circle cx="9" cy="7" r="4"/>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              Individual Recordings
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {video.participantVideos.map((pv) => (
                              <div
                                key={pv.fileId}
                                style={{
                                  display: "flex", alignItems: "center",
                                  justifyContent: "space-between", gap: 8,
                                  padding: "8px 12px", borderRadius: 10,
                                  background: "#fff",
                                  border: "1px solid rgba(0,0,0,0.06)",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                  <div style={{
                                    width: 28, height: 28, borderRadius: "50%",
                                    background: "#e8eaed", display: "flex",
                                    alignItems: "center", justifyContent: "center",
                                    fontSize: 11, fontWeight: 700, color: "#5f6368",
                                    flexShrink: 0,
                                  }}>
                                    {(pv.name || "?").charAt(0).toUpperCase()}
                                  </div>
                                  <span style={{
                                    fontSize: 13, fontWeight: 600, color: "#222",
                                    overflow: "hidden", textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {pv.name || "Participant"}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="pc-btn"
                                  onClick={() => downloadParticipantVideo(pv, sessionNumber)}
                                  disabled={downloadingId === String(pv.fileId)}
                                  style={{
                                    padding: "6px 14px", fontSize: 12, fontWeight: 600,
                                    border: "1px solid rgba(0,0,0,0.12)",
                                    borderRadius: 8, background: "#fff",
                                    cursor: "pointer", color: "#111",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {downloadingId === String(pv.fileId) ? "Saving\u2026" : "Download"}
                                </button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}

export default Library;

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Sora:wght@500;700;800&display=swap');

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
  .pc-btn:hover:not(:disabled) { transform: translateY(-1px); }
  .pc-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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
    background:
      "radial-gradient(1200px 420px at 10% -4%, rgba(255, 193, 7, 0.22) 0%, rgba(255, 193, 7, 0) 60%), radial-gradient(1200px 420px at 100% -8%, rgba(10, 116, 255, 0.16) 0%, rgba(10, 116, 255, 0) 58%), linear-gradient(180deg, #f7f7f2 0%, #ffffff 32%)",
    color: "#101010",
    fontFamily:
      '"Space Grotesk", "Sora", "Segoe UI", sans-serif',
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
    letterSpacing: 3.2,
    color: "#5a5a4d",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "12px 0 10px",
    fontSize: "clamp(30px, 4.8vw, 52px)",
    letterSpacing: "-1.2px",
    lineHeight: 1.08,
    fontWeight: 900,
    color: "#0d0d0a",
    fontFamily: '"Sora", "Space Grotesk", sans-serif',
  },
  subtitle: {
    margin: 0,
    maxWidth: 560,
    color: "#4f4f44",
    lineHeight: 1.6,
    fontSize: 15.5,
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
    border: "1px solid rgba(0,0,0,0.09)",
    background: "rgba(255,255,255,0.72)",
    minWidth: 96,
    backdropFilter: "blur(8px)",
  },
  liveBadge: {
    padding: "9px 12px",
    borderRadius: 999,
    border: "1px solid rgba(245, 180, 0, 0.38)",
    background: "rgba(245, 180, 0, 0.14)",
    color: "#6a4b00",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.25,
    whiteSpace: "nowrap",
  },
  statLabel: { margin: 0, fontSize: 12, color: "#777", fontWeight: 600 },
  statValue: { margin: "2px 0 0", fontSize: 22, fontWeight: 800 },
  refreshBtn: {
    padding: "12px 16px",
    borderRadius: 999,
    border: "2px solid #000",
    background: "linear-gradient(135deg, #111 0%, #2d2d2d 100%)",
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
    background: "rgba(255,255,255,0.75)",
    maxWidth: 520,
    backdropFilter: "blur(8px)",
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
    border: "1px solid rgba(0,0,0,0.08)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(252,252,247,0.98) 100%)",
    overflow: "hidden",
    boxShadow: "0 12px 36px rgba(0,0,0,0.08)",
    transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s ease",
  },
  videoFrame: { position: "relative", background: "#000" },
  videoFrameProcessing: {
    position: "relative",
    height: 220,
    background: "linear-gradient(130deg, #ecece3 0%, #f4f4ee 54%, #ecece3 100%)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 12,
    padding: 18,
  },
  processingBar: {
    height: 12,
    width: "86%",
    borderRadius: 99,
    background: "rgba(0,0,0,0.11)",
  },
  processingBarSmall: {
    height: 12,
    width: "62%",
    borderRadius: 99,
    background: "rgba(0,0,0,0.09)",
  },
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
  badgeProcessing: {
    position: "absolute",
    left: 14,
    top: 14,
    padding: "8px 12px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backdropFilter: "blur(10px)",
  },
  badgeDotLive: {
    width: 8,
    height: 8,
    borderRadius: 99,
    background: "#f5b400",
    boxShadow: "0 0 0 6px rgba(245, 180, 0, 0.2)",
  },
  meta: { padding: "14px 16px 0" },
  metaLabel: { margin: 0, fontSize: 12, color: "#777", fontWeight: 700 },
  metaValue: {
    margin: "6px 0 0",
    fontSize: 14,
    fontWeight: 800,
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
  processingHint: {
    margin: "12px 16px 16px",
    padding: "12px 14px",
    borderRadius: 14,
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.08)",
    color: "#3e3e36",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.45,
  },
  pipelineWrap: {
    margin: "12px 16px 0",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.68)",
  },
  pipelineWrapCompact: {
    margin: "12px 16px 0",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.07)",
    background: "rgba(0,0,0,0.02)",
  },
  pipelineTitle: {
    margin: 0,
    fontSize: 12,
    color: "#666",
    fontWeight: 800,
    letterSpacing: 0.2,
  },
  pipelineList: {
    marginTop: 8,
    display: "grid",
    gap: 7,
  },
  pipelineItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pipelineDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    flexShrink: 0,
  },
  pipelineDotDone: {
    background: "#2e7d32",
  },
  pipelineDotActive: {
    background: "#f5b400",
    boxShadow: "0 0 0 5px rgba(245, 180, 0, 0.2)",
  },
  pipelineDotPending: {
    background: "#9e9e9e",
  },
  pipelineDotFailed: {
    background: "#d32f2f",
  },
  pipelineText: {
    fontSize: 12.5,
    color: "#343434",
    lineHeight: 1.35,
    fontWeight: 600,
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
