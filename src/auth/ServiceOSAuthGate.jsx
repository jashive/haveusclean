import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  signInWithPassword,
  refreshSession,
  getStoredSession,
  clearSession,
  signOut,
  validateServiceOSContext,
} from "../lib/serviceosAuthClient";

// ── Revenue context ───────────────────────────────────────────────────────────
// Carries business_unit_id and canonical context for Wave 2 revenue features.
// Null when the auth gate is disabled or before validation completes.

export const ServiceOSRevenueContext = createContext(null);

/** Hook for consuming the authenticated ServiceOS session + revenue context. */
export function useServiceOSContext() {
  return useContext(ServiceOSRevenueContext);
}

const AUTH_ENABLED = import.meta.env.VITE_SERVICEOS_AUTH_ENABLED === "true";
const PILOT_BADGE = import.meta.env.VITE_SERVICEOS_AUTH_PILOT_BADGE === "true";

// ── Inline styles (minimal, isolated) ────────────────────────────────────────

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f4f8",
    fontFamily: "system-ui, sans-serif",
    zIndex: 9999,
  },
  card: {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
    padding: "2rem",
    width: "100%",
    maxWidth: 360,
  },
  heading: { margin: "0 0 1.25rem", fontSize: "1.25rem", fontWeight: 600 },
  label: { display: "block", fontSize: "0.85rem", marginBottom: "0.25rem", color: "#374151" },
  input: {
    width: "100%",
    padding: "0.5rem 0.625rem",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    fontSize: "1rem",
    boxSizing: "border-box",
    marginBottom: "0.875rem",
  },
  button: {
    width: "100%",
    padding: "0.625rem",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: "1rem",
    cursor: "pointer",
    fontWeight: 500,
  },
  buttonDisabled: { opacity: 0.6, cursor: "not-allowed" },
  error: { color: "#dc2626", fontSize: "0.85rem", margin: "0.5rem 0 0" },
  badge: {
    position: "fixed",
    bottom: 8,
    right: 8,
    background: "#f59e0b",
    color: "#000",
    fontSize: "0.7rem",
    padding: "2px 6px",
    borderRadius: 4,
    zIndex: 10000,
    fontFamily: "monospace",
  },
  signOutBar: {
    position: "fixed",
    top: 0,
    right: 0,
    padding: "4px 12px",
    background: "rgba(0,0,0,0.05)",
    zIndex: 100,
  },
  signOutBtn: {
    background: "none",
    border: "none",
    color: "#6b7280",
    fontSize: "0.8rem",
    cursor: "pointer",
    textDecoration: "underline",
  },
  deniedHeading: { color: "#dc2626", margin: "0 0 0.75rem", fontSize: "1.1rem" },
  retryBtn: {
    marginTop: "1rem",
    padding: "0.5rem 1.25rem",
    background: "#e5e7eb",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: "0.9rem",
  },
};

// ── Session helpers ───────────────────────────────────────────────────────────

function isSessionExpired(session) {
  if (!session?.expires_at) return true;
  return Math.floor(Date.now() / 1000) >= session.expires_at - 60; // 60s buffer
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await signInWithPassword(email, password);
      await validateServiceOSContext(session);
      onSuccess(session);
    } catch (err) {
      setError(err?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.heading}>HaveUsClean — Sign In</h2>
        <form onSubmit={handleSubmit}>
          <label style={styles.label} htmlFor="sos-email">Email</label>
          <input
            id="sos-email"
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            autoFocus
          />
          <label style={styles.label} htmlFor="sos-password">Password</label>
          <input
            id="sos-password"
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button
            style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
          {error && <p style={styles.error}>{error}</p>}
        </form>
      </div>
    </div>
  );
}

// ── Access denied screen ──────────────────────────────────────────────────────

function AccessDenied({ message, onRetry }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.deniedHeading}>Access Denied</h2>
        <p style={{ fontSize: "0.9rem", color: "#374151", margin: 0 }}>
          {message ?? "Your account does not have permission to access this application."}
        </p>
        <button style={styles.retryBtn} onClick={onRetry}>
          Sign In Again
        </button>
      </div>
    </div>
  );
}

// ── Authenticated gate (inner) ────────────────────────────────────────────────

function AuthenticatedGate({ children }) {
  const [status, setStatus] = useState("loading"); // loading | login | denied | ready
  const [session, setSession] = useState(null);
  const [deniedMessage, setDeniedMessage] = useState(null);
  // Revenue context: orgId, appUserId, roleId, businessUnits, primaryBusinessUnitId
  const [revenueContext, setRevenueContext] = useState(null);

  const handleSignOut = useCallback(async () => {
    const stored = getStoredSession();
    await signOut(stored?.access_token);
    setSession(null);
    setRevenueContext(null);
    setStatus("login");
  }, []);

  function buildRevenueContext(validationResult) {
    // Resolve the primary business unit id from the Wave 1 validation result.
    // businessUnits is an array of { id, code } objects or codes; we carry the
    // first HUC-ON id as the default context. If the schema only returns codes,
    // primaryBusinessUnitId will be null until Migration 005 exposes IDs.
    const units = Array.isArray(validationResult?.businessUnits) ? validationResult.businessUnits : [];
    const primaryCode = units.find((u) => (typeof u === "string" ? u : u?.code) === "HUC-ON") ?? units[0];
    const primaryBusinessUnitId =
      primaryCode != null && typeof primaryCode === "object" ? (primaryCode.id ?? null) : null;

    return {
      orgId: validationResult?.orgId ?? null,
      appUserId: validationResult?.appUserId ?? null,
      roleId: validationResult?.roleId ?? null,
      businessUnits: units,
      primaryBusinessUnitId,
    };
  }

  useEffect(() => {
    async function initSession() {
      const stored = getStoredSession();
      if (!stored) {
        setStatus("login");
        return;
      }

      try {
        let active = stored;
        if (isSessionExpired(stored)) {
          if (!stored.refresh_token) {
            clearSession();
            setStatus("login");
            return;
          }
          active = await refreshSession(stored.refresh_token);
        }
        const validationResult = await validateServiceOSContext(active);
        setSession(active);
        setRevenueContext(buildRevenueContext(validationResult));
        setStatus("ready");
      } catch (err) {
        const msg = err?.message ?? "Session validation failed";
        if (msg.startsWith("ServiceOS access denied")) {
          clearSession();
          setDeniedMessage(msg);
          setStatus("denied");
        } else {
          // Network or unknown error — allow retry via login screen
          clearSession();
          setStatus("login");
        }
      }
    }

    initSession();
  }, []);

  function handleLoginSuccess(newSession) {
    setSession(newSession);
    setStatus("ready");
    // Revenue context will be populated on next initSession cycle if needed;
    // for a fresh login we don't have the validation result here, so we
    // leave revenueContext null until the gate is re-entered.
    setRevenueContext(null);
  }

  function handleRetry() {
    clearSession();
    setDeniedMessage(null);
    setRevenueContext(null);
    setStatus("login");
  }

  if (status === "loading") {
    return null; // brief flash; could show a spinner
  }

  if (status === "login") {
    return (
      <>
        <LoginForm onSuccess={handleLoginSuccess} />
        {PILOT_BADGE && <div style={styles.badge}>ServiceOS Auth Pilot</div>}
      </>
    );
  }

  if (status === "denied") {
    return (
      <>
        <AccessDenied message={deniedMessage} onRetry={handleRetry} />
        {PILOT_BADGE && <div style={styles.badge}>ServiceOS Auth Pilot</div>}
      </>
    );
  }

  // status === "ready"
  return (
    <ServiceOSRevenueContext.Provider value={{ session, revenueContext }}>
      <div style={styles.signOutBar}>
        <button style={styles.signOutBtn} onClick={handleSignOut}>
          Sign Out
        </button>
      </div>
      {children}
      {PILOT_BADGE && <div style={styles.badge}>ServiceOS Auth Pilot</div>}
    </ServiceOSRevenueContext.Provider>
  );
}

// ── Main gate component ───────────────────────────────────────────────────────

export default function ServiceOSAuthGate({ children }) {
  if (!AUTH_ENABLED) {
    return children;
  }
  return <AuthenticatedGate>{children}</AuthenticatedGate>;
}
