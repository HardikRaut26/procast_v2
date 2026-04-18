import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api/axios";

function Login() {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      const res = await api.post("/auth/login", form);
      localStorage.setItem("token", res.data.token);
      setMessage("Login successful. You’re ready to join a call.");
      setForm({ email: "", password: "" });
      navigate("/");
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
          "Login failed. Check your details and try again."
      );
    }
  };

  const isSuccess = message.toLowerCase().startsWith("login successful");

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <div style={styles.shell}>
        <section style={styles.copyCol}>
          <p style={styles.kicker}>LOGIN FIRST</p>
          <h1 style={styles.heroTitle}>
            Sign in to start
            <br />
            your next session.
          </h1>
          <p style={styles.heroText}>
            Access secure calls, cloud recordings, and your full ProCast
            workspace after logging in.
          </p>
        </section>

        <section style={styles.formCol}>
          <div style={styles.card} className="pc-login-card">
            <h2 style={styles.cardTitle}>Welcome back</h2>
            <p style={styles.cardSub}>
              Use your email and password to continue.
            </p>

            <form onSubmit={handleSubmit} style={styles.form}>
              <label style={styles.label}>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Password
                <input
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={handleChange}
                  required
                  style={styles.input}
                />
              </label>

              <button type="submit" style={styles.submit}>
                Log in
              </button>

              {message && (
                <p
                  style={{
                    ...styles.message,
                    ...(isSuccess ? styles.messageSuccess : styles.messageError),
                  }}
                >
                  {message}
                </p>
              )}

              <div style={styles.footerRow}>
                <span style={styles.footerText}>New to ProCast?</span>
                <Link to="/register" style={styles.footerLink}>
                  Create an account
                </Link>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Login;

const css = `
  .pc-login-card {
    animation: pcLoginIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pcLoginIn {
    from { opacity: 0; transform: translateY(18px); }
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
    display: "flex",
    alignItems: "center",
  },
  shell: {
    maxWidth: 1100,
    margin: "0 auto",
    width: "100%",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
    gap: 40,
    alignItems: "center",
  },
  copyCol: {
    minWidth: 0,
  },
  kicker: {
    margin: 0,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: "#999",
    fontWeight: 700,
  },
  heroTitle: {
    margin: "10px 0 12px",
    fontSize: "clamp(28px, 4vw, 40px)",
    letterSpacing: "-1px",
    lineHeight: 1.1,
    fontWeight: 800,
    color: "#000",
  },
  heroText: {
    margin: 0,
    maxWidth: 420,
    color: "#555",
    fontSize: 15,
    lineHeight: 1.6,
  },
  formCol: {
    minWidth: 0,
    display: "flex",
    justifyContent: "flex-end",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    padding: 24,
    borderRadius: 24,
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.06)",
  },
  cardTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
  },
  cardSub: {
    margin: "6px 0 18px",
    fontSize: 13,
    color: "#777",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#333",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.08)",
    outline: "none",
    fontSize: 14,
    background: "#fafafa",
  },
  submit: {
    marginTop: 6,
    padding: "11px 14px",
    borderRadius: 999,
    border: "2px solid #000",
    background: "#000",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  message: {
    marginTop: 10,
    fontSize: 13,
  },
  messageSuccess: {
    color: "#2e7d32",
  },
  messageError: {
    color: "#c62828",
  },
  footerRow: {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
  },
  footerText: {
    color: "#777",
  },
  footerLink: {
    color: "#000",
    fontWeight: 600,
    textDecoration: "underline",
  },
};
