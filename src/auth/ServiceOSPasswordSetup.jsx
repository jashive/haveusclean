import React, { useMemo, useState } from "react";
import { getSupabaseConfig } from "../lib/supabaseConfig.js";

const styles = {
  overlay: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f4f8",
    fontFamily: "system-ui, sans-serif",
    padding: "1rem",
    boxSizing: "border-box",
  },
  card: {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
    padding: "2rem",
    width: "100%",
    maxWidth: 420,
  },
  heading: { margin: "0 0 0.5rem", fontSize: "1.35rem", fontWeight: 650 },
  copy: { color: "#4b5563", fontSize: "0.92rem", lineHeight: 1.5, margin: "0 0 1.25rem" },
  label: { display: "block", fontSize: "0.85rem", marginBottom: "0.25rem", color: "#374151" },
  input: {
    width: "100%",
    padding: "0.6rem 0.7rem",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    fontSize: "1rem",
    boxSizing: "border-box",
    marginBottom: "0.875rem",
  },
  button: {
    width: "100%",
    padding: "0.7rem",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: "1rem",
    cursor: "pointer",
    fontWeight: 600,
  },
  disabled: { opacity: 0.6, cursor: "not-allowed" },
  error: { color: "#b91c1c", fontSize: "0.86rem", margin: "0.75rem 0 0" },
  success: { color: "#166534", fontSize: "0.9rem", margin: "0.75rem 0 0", lineHeight: 1.45 },
  link: { display: "inline-block", marginTop: "1rem", color: "#2563eb", fontSize: "0.9rem" },
};

function authErrorMessage(data, fallback) {
  return data?.message ?? data?.error_description ?? data?.msg ?? fallback;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function redirectTarget() {
  return `${window.location.origin}/set-password`;
}

export default function ServiceOSPasswordSetup() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, "")), []);
  const accessToken = params.get("access_token");
  const authType = params.get("type");
  const redirectError = params.get("error_description") || params.get("error");
  const hasPasswordSession = Boolean(accessToken) && (authType === "invite" || authType === "recovery" || !authType);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(redirectError ? decodeURIComponent(redirectError) : null);
  const [success, setSuccess] = useState(null);

  async function requestSetupLink(event) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        throw new Error("Enter the email address on your ServiceOS account.");
      }
      const { url, anon } = getSupabaseConfig(import.meta.env);
      const response = await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTarget())}`, {
        method: "POST",
        headers: { apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(authErrorMessage(data, "Password setup email could not be sent."));
      setSuccess("Check your email for the ServiceOS password setup link. Open the newest message and return here to create your password.");
    } catch (err) {
      setError(err?.message ?? "Password setup email could not be sent.");
    } finally {
      setLoading(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
      if (password !== confirmPassword) throw new Error("The passwords do not match.");
      const { url, anon } = getSupabaseConfig(import.meta.env);
      const response = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const data = await parseResponse(response);
      if (!response.ok) throw new Error(authErrorMessage(data, "Password could not be updated."));
      window.history.replaceState({}, document.title, "/set-password");
      setSuccess("Password created. You can now sign in to ServiceOS.");
      window.setTimeout(() => window.location.assign("/"), 900);
    } catch (err) {
      setError(err?.message ?? "Password could not be updated.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.overlay}>
      <section style={styles.card} aria-labelledby="serviceos-password-heading">
        <h1 id="serviceos-password-heading" style={styles.heading}>Have Us Clean — Set Password</h1>
        {hasPasswordSession ? (
          <>
            <p style={styles.copy}>Create the password you will use to sign in to ServiceOS. Your invitation has already verified your email address.</p>
            <form onSubmit={savePassword}>
              <label style={styles.label} htmlFor="new-password">New password</label>
              <input
                id="new-password"
                style={styles.input}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
                autoFocus
              />
              <label style={styles.label} htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                style={styles.input}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <button style={{ ...styles.button, ...(loading ? styles.disabled : {}) }} type="submit" disabled={loading}>
                {loading ? "Saving…" : "Create Password"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p style={styles.copy}>If your invitation was already accepted or the original setup link was consumed, request a fresh password setup link for your existing ServiceOS account.</p>
            <form onSubmit={requestSetupLink}>
              <label style={styles.label} htmlFor="setup-email">Email</label>
              <input
                id="setup-email"
                style={styles.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
              <button style={{ ...styles.button, ...(loading ? styles.disabled : {}) }} type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send Password Setup Link"}
              </button>
            </form>
          </>
        )}
        {error && <p role="alert" style={styles.error}>{error}</p>}
        {success && <p role="status" style={styles.success}>{success}</p>}
        <a href="/" style={styles.link}>Return to ServiceOS sign in</a>
      </section>
    </main>
  );
}
