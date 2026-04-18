import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";

function Profile() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Local-only preferences (UI only, non-persisted)
  const [muteOnJoin, setMuteOnJoin] = useState(true);
  const [cameraOnJoin, setCameraOnJoin] = useState(false);
  const [showNameInCall, setShowNameInCall] = useState(true);

  useEffect(() => {
    api
      .get("/auth/me")
      .then((res) => {
        setUser(res.data.user);
      })
      .catch(() => {
        setError("Unauthorized or token expired");
      })
      .finally(() => setLoading(false));
  }, []);

  const initials = user?.name
    ? user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0]?.toUpperCase())
        .join("")
    : "?";

  const fallbackName = user?.email || "ProCast user";

  const handleSignOut = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.centerBox}>
          <div style={styles.spinner} />
          <p style={styles.centerText}>Loading your profile…</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div style={styles.page}>
        <div style={styles.centerBox}>
          <h2 style={styles.errorTitle}>We couldn’t load your profile</h2>
          <p style={styles.errorText}>{error || "Please sign in again."}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <div style={styles.layout}>
        {/* Left: profile card */}
        <section style={styles.leftCol}>
          <div style={styles.profileCard} className="pc-profile-card">
            <div style={styles.avatarWrap}>
              <div style={styles.avatarCircle}>{initials}</div>
            </div>

            <div style={styles.profileMain}>
              <h1 style={styles.name}>{user.name || fallbackName}</h1>
              <p style={styles.email}>{user.email}</p>
              <p style={styles.tagline}>ProCast meeting account</p>
            </div>

            <div style={styles.profileMetaRow}>
              <div style={styles.metaBlock}>
                <p style={styles.metaLabel}>Plan</p>
                <p style={styles.metaValue}>Free</p>
              </div>
              <div style={styles.metaDivider} />
              <div style={styles.metaBlock}>
                <p style={styles.metaLabel}>Recordings</p>
                <p style={styles.metaValueMuted}>View in Library</p>
              </div>
            </div>

            <button type="button" style={styles.primaryBtn}>
              Manage account
            </button>
          </div>
        </section>

        {/* Right: settings-like panels */}
        <section style={styles.rightCol}>
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.panelKicker}>IN CALL</p>
                <h2 style={styles.panelTitle}>Meeting preferences</h2>
              </div>
            </div>

            <div style={styles.toggleRow}>
              <div>
                <p style={styles.toggleTitle}>Mute microphone on join</p>
                <p style={styles.toggleSub}>
                  Start new calls with your mic muted by default.
                </p>
              </div>
              <button
                type="button"
                style={{
                  ...styles.toggle,
                  ...(muteOnJoin ? styles.toggleOn : styles.toggleOff),
                }}
                onClick={() => setMuteOnJoin((v) => !v)}
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    ...(muteOnJoin ? styles.toggleKnobOn : styles.toggleKnobOff),
                  }}
                />
              </button>
            </div>

            <div style={styles.toggleRow}>
              <div>
                <p style={styles.toggleTitle}>Turn camera on when joining</p>
                <p style={styles.toggleSub}>
                  Join with video enabled instead of audio-only.
                </p>
              </div>
              <button
                type="button"
                style={{
                  ...styles.toggle,
                  ...(cameraOnJoin ? styles.toggleOn : styles.toggleOff),
                }}
                onClick={() => setCameraOnJoin((v) => !v)}
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    ...(cameraOnJoin
                      ? styles.toggleKnobOn
                      : styles.toggleKnobOff),
                  }}
                />
              </button>
            </div>

            <div style={styles.toggleRowLast}>
              <div>
                <p style={styles.toggleTitle}>Show my name in calls</p>
                <p style={styles.toggleSub}>
                  Display your profile name on your video tile.
                </p>
              </div>
              <button
                type="button"
                style={{
                  ...styles.toggle,
                  ...(showNameInCall ? styles.toggleOn : styles.toggleOff),
                }}
                onClick={() => setShowNameInCall((v) => !v)}
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    ...(showNameInCall
                      ? styles.toggleKnobOn
                      : styles.toggleKnobOff),
                  }}
                />
              </button>
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.panelKicker}>ACCOUNT</p>
                <h2 style={styles.panelTitle}>Security & devices</h2>
              </div>
            </div>

            <div style={styles.securityRow}>
              <div>
                <p style={styles.toggleTitle}>Signed in as</p>
                <p style={styles.toggleSub}>{user.email}</p>
              </div>
              <span style={styles.badgeLight}>Email login</span>
            </div>

            <div style={styles.securityRow}>
              <div>
                <p style={styles.toggleTitle}>Password</p>
                <p style={styles.toggleSub}>Change your password from login.</p>
              </div>
              <button type="button" style={styles.linkBtn} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Profile;

const css = `
  .pc-profile-card {
    animation: pcProfileIn 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pcProfileIn {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

const styles = {
  page: {
    minHeight: "100vh",
    padding: "110px 28px 56px",
    background: "#fafafa",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#111",
  },
  centerBox: {
    maxWidth: 420,
    margin: "80px auto 0",
    textAlign: "center",
  },
  centerText: {
    marginTop: 16,
    fontSize: 14,
    color: "#555",
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "3px solid rgba(0,0,0,0.08)",
    borderTopColor: "#000",
    margin: "0 auto",
    animation: "pcSpin 0.8s linear infinite",
  },
  errorTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
  },
  layout: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.4fr)",
    gap: 24,
  },
  leftCol: {
    minWidth: 0,
  },
  rightCol: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  profileCard: {
    borderRadius: 24,
    padding: 24,
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.06)",
  },
  avatarWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: 16,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "#000",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: 2,
  },
  profileMain: {
    textAlign: "center",
    marginBottom: 16,
  },
  name: {
    margin: "4px 0",
    fontSize: 22,
    fontWeight: 700,
  },
  email: {
    margin: 0,
    fontSize: 14,
    color: "#666",
  },
  tagline: {
    margin: "10px 0 0",
    fontSize: 13,
    color: "#999",
  },
  profileMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 14px 16px",
    borderRadius: 18,
    background: "rgba(0,0,0,0.02)",
    marginBottom: 18,
  },
  metaBlock: {
    flex: 1,
  },
  metaDivider: {
    width: 1,
    height: 32,
    background: "rgba(0,0,0,0.08)",
    margin: "0 12px",
  },
  metaLabel: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#999",
    fontWeight: 700,
  },
  metaValue: {
    margin: "4px 0 0",
    fontSize: 14,
    fontWeight: 600,
  },
  metaValueMuted: {
    margin: "4px 0 0",
    fontSize: 14,
    fontWeight: 500,
    color: "#555",
  },
  primaryBtn: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 999,
    border: "2px solid #000",
    background: "#000",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  panel: {
    borderRadius: 22,
    padding: 20,
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.05)",
  },
  panelHeader: {
    marginBottom: 14,
  },
  panelKicker: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#9a9a9a",
    fontWeight: 700,
  },
  panelTitle: {
    margin: "6px 0 0",
    fontSize: 18,
    fontWeight: 700,
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
  },
  toggleRowLast: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0 0",
  },
  toggleTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
  },
  toggleSub: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "#777",
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 24,
    border: "1px solid rgba(0,0,0,0.2)",
    padding: 2,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    background: "#f5f5f5",
    transition: "background 0.2s ease, border-color 0.2s ease",
  },
  toggleOn: {
    background: "#000",
    borderColor: "#000",
    justifyContent: "flex-end",
  },
  toggleOff: {
    justifyContent: "flex-start",
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.2s ease",
  },
  toggleKnobOn: {},
  toggleKnobOff: {},
  securityRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    borderTop: "1px solid rgba(0,0,0,0.06)",
  },
  badgeLight: {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    border: "1px solid rgba(0,0,0,0.1)",
    background: "rgba(0,0,0,0.02)",
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#111",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
  },
};
