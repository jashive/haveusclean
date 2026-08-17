// ── Wave 6: Management Review Panel ──────────────────────────────────────────
//
// Renders the governed management review workflow for a given period:
//   - View and open review records (DAILY/MONTHLY/QUARTERLY/YEARLY)
//   - Capture governed KPI snapshots (append-only evidence)
//   - Record exceptions and decisions as supported by the schema
//   - Advance the review through legal lifecycle states
//   - Close only when governance prerequisites are met
//
// Every mutation goes through serviceosIntelligenceClient.js.
// No synthetic values. Unavailable data is reported truthfully.

import React, { useCallback, useState } from "react";

import {
  captureKpiSnapshot,
  createManagementReview,
  loadManagementReviews,
  updateManagementReview,
} from "../../lib/serviceosIntelligenceClient.js";
import {
  MANAGEMENT_REVIEW_TRANSITIONS,
  canCloseManagementReview,
  canTransitionManagementReview,
} from "../../lib/serviceosIntelligenceUtils.js";
import { formatErrorMessage, formatStatusLabel, formatTimestamp } from "./wave6Formatters.js";

const styles = {
  section: { marginBottom: "0.85rem" },
  label: {
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#7dd3fc",
    marginBottom: 6,
  },
  row: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 6,
    padding: "0.55rem 0.6rem",
    marginBottom: 6,
  },
  rowTitle: { fontSize: "0.78rem", fontWeight: 600, color: "#e8f4ff" },
  rowMeta: { fontSize: "0.65rem", color: "#94a3b8", marginTop: 2, lineHeight: 1.4 },
  actions: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  button: {
    background: "#1d4ed8",
    border: "none",
    borderRadius: 4,
    color: "#e8f4ff",
    fontSize: "0.68rem",
    fontWeight: 600,
    padding: "0.3rem 0.55rem",
    cursor: "pointer",
  },
  buttonSecondary: {
    background: "#0f2a5e",
    border: "1px solid #1e3a5f",
    borderRadius: 4,
    color: "#94a3b8",
    fontSize: "0.68rem",
    fontWeight: 600,
    padding: "0.3rem 0.55rem",
    cursor: "pointer",
  },
  buttonDisabled: {
    background: "#1e293b",
    border: "none",
    borderRadius: 4,
    color: "#64748b",
    fontSize: "0.68rem",
    fontWeight: 600,
    padding: "0.3rem 0.55rem",
    cursor: "not-allowed",
  },
  buttonDanger: {
    background: "#7f1d1d",
    border: "none",
    borderRadius: 4,
    color: "#fca5a5",
    fontSize: "0.68rem",
    fontWeight: 600,
    padding: "0.3rem 0.55rem",
    cursor: "pointer",
  },
  input: {
    width: "100%",
    background: "#0a1628",
    border: "1px solid #2d4a6e",
    borderRadius: 4,
    color: "#e8f4ff",
    padding: "0.35rem 0.45rem",
    fontSize: "0.75rem",
    marginBottom: 6,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    background: "#0a1628",
    border: "1px solid #2d4a6e",
    borderRadius: 4,
    color: "#e8f4ff",
    padding: "0.35rem 0.45rem",
    fontSize: "0.75rem",
    marginBottom: 6,
    boxSizing: "border-box",
    minHeight: 60,
    resize: "vertical",
  },
  error: { color: "#fca5a5", fontSize: "0.7rem", marginTop: 4 },
  success: { color: "#86efac", fontSize: "0.7rem", marginTop: 4 },
  note: { color: "#94a3b8", fontSize: "0.68rem", marginTop: 4, lineHeight: 1.4 },
  empty: { color: "#94a3b8", fontSize: "0.75rem", padding: "0.4rem 0" },
  badge: (ok) => ({
    display: "inline-block",
    padding: "0.15rem 0.4rem",
    borderRadius: 999,
    fontSize: "0.62rem",
    fontWeight: 700,
    background: ok ? "#14532d" : "#3f1d1d",
    color: ok ? "#86efac" : "#fca5a5",
  }),
};

/** Allowed next statuses for a review_status. */
function nextReviewStatuses(status) {
  const allowed = MANAGEMENT_REVIEW_TRANSITIONS[status];
  return Array.isArray(allowed) ? [...allowed] : [];
}

/** Human-readable label for a review status. */
function reviewStatusLabel(status) {
  return formatStatusLabel(status) ?? status ?? "—";
}

// ── Sub-component: create a new review record ────────────────────────────────

function CreateReviewForm({ session, organizationId, businessUnitId, periodType, period, timezone, onCreated }) {
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const payload = {
        organization_id: organizationId,
        business_unit_id: businessUnitId ?? null,
        period_type: periodType,
        period_start: period.periodStart.toISOString(),
        period_end: period.periodEnd.toISOString(),
        timezone,
        summary: summary.trim() || null,
        review_status: "draft",
        opened_at: new Date().toISOString(),
      };
      const created = await createManagementReview(session, payload);
      onCreated(Array.isArray(created) ? created[0] : created);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }, [session, organizationId, businessUnitId, periodType, period, timezone, summary, onCreated]);

  return (
    <div style={styles.row}>
      <div style={styles.label}>Open Management Review</div>
      <textarea
        style={styles.textarea}
        placeholder="Initial summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        maxLength={2000}
      />
      <div style={styles.actions}>
        <button
          type="button"
          style={creating ? styles.buttonDisabled : styles.button}
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? "Opening…" : "Open Review"}
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ── Sub-component: capture KPI snapshot ─────────────────────────────────────

function SnapshotCaptureButton({ session, organizationId, businessUnitId, periodType, period, kpis, timezone, onCaptured }) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleCapture = useCallback(async () => {
    if (!Array.isArray(kpis) || kpis.length === 0) {
      setError("No computed KPI values to capture for this period.");
      return;
    }
    setCapturing(true);
    setError(null);
    setSuccess(null);
    const errors = [];
    let capturedCount = 0;
    for (const kpi of kpis) {
      if (kpi.unavailable === true) continue;
      if (kpi.value === null || kpi.value === undefined) continue;
      try {
        await captureKpiSnapshot(session, {
          organization_id: organizationId,
          business_unit_id: businessUnitId ?? null,
          kpi_code: kpi.kpiCode,
          period_type: periodType,
          period_start: period.periodStart.toISOString(),
          period_end: period.periodEnd.toISOString(),
          timezone,
          value: kpi.value,
          numerator: kpi.numerator ?? null,
          denominator: kpi.denominator ?? null,
          row_counts: kpi.rowCounts ?? null,
          source_tables: kpi.sourceTables ?? null,
          freshness_at: kpi.freshnessAt ?? null,
        });
        capturedCount += 1;
      } catch (err) {
        const msg = formatErrorMessage(err);
        // Duplicate snapshots are expected if already captured; skip quietly.
        if (!msg.toLowerCase().includes("unique") && !msg.toLowerCase().includes("duplicate")) {
          errors.push(`${kpi.kpiCode}: ${msg}`);
        }
      }
    }
    setCapturing(false);
    if (errors.length > 0) {
      setError(`Partial capture — ${errors.length} error(s): ${errors.join("; ")}`);
    } else {
      setSuccess(`Captured ${capturedCount} KPI snapshot(s) for this period.`);
      if (onCaptured) onCaptured();
    }
  }, [session, organizationId, businessUnitId, periodType, period, kpis, timezone, onCaptured]);

  return (
    <div>
      <button
        type="button"
        data-testid="capture-kpi-snapshot-btn"
        style={capturing ? styles.buttonDisabled : styles.buttonSecondary}
        onClick={handleCapture}
        disabled={capturing}
      >
        {capturing ? "Capturing…" : "Capture KPI Snapshot"}
      </button>
      {error && <div style={styles.error}>{error}</div>}
      {success && <div style={styles.success}>{success}</div>}
    </div>
  );
}

// ── Sub-component: single review record row ──────────────────────────────────

function ReviewRow({ session, review, kpis, periodType, period, timezone, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(review.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canClose = canCloseManagementReview(review);
  const nextStatuses = nextReviewStatuses(review.review_status);
  const isTerminal = review.review_status === "closed";

  const handleSaveSummary = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await updateManagementReview(session, review.id, {
        summary: summary.trim() || null,
        current_status: review.review_status,
      });
      setEditing(false);
      if (onChanged) onChanged();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [session, review.id, review.review_status, summary, onChanged]);

  const handleTransition = useCallback(async (toStatus) => {
    if (!canTransitionManagementReview(review.review_status, toStatus)) return;
    const patch = {
      review_status: toStatus,
      current_status: review.review_status,
    };
    if (toStatus === "closed") {
      patch.closed_at = new Date().toISOString();
    }
    if (toStatus === "in_review" && !review.opened_at) {
      patch.opened_at = new Date().toISOString();
    }
    setSaving(true);
    setError(null);
    try {
      await updateManagementReview(session, review.id, patch);
      if (onChanged) onChanged();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [session, review, onChanged]);

  return (
    <div style={styles.row}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={styles.rowTitle}>
          {review.period_type} Review — v{review.review_version}
        </div>
        <span style={styles.badge(review.review_status === "closed")}>
          {reviewStatusLabel(review.review_status)}
        </span>
      </div>
      <div style={styles.rowMeta}>
        Period: {formatTimestamp(review.period_start, review.timezone)} →{" "}
        {formatTimestamp(review.period_end, review.timezone)}
        <br />
        Opened: {review.opened_at ? formatTimestamp(review.opened_at, review.timezone) : "—"} ·
        Closed: {review.closed_at ? formatTimestamp(review.closed_at, review.timezone) : "—"}
        <br />
        Actions: {Array.isArray(review.actions) ? review.actions.length : 0} ·
        Exceptions: {Array.isArray(review.exceptions) ? review.exceptions.length : 0} ·
        Decisions: {Array.isArray(review.decisions) ? review.decisions.length : 0}
        {review.waiver_recorded && <span style={{ color: "#fbbf24" }}> · Waiver recorded</span>}
      </div>

      {review.summary && !editing && (
        <div style={{ ...styles.rowMeta, marginTop: 6, color: "#cbd5e1" }}>
          {review.summary}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 6 }}>
          <textarea
            style={styles.textarea}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
          />
        </div>
      )}

      {!isTerminal && (
        <div style={styles.actions}>
          {/* Lifecycle transitions */}
          {nextStatuses.map((toStatus) => {
            const allowed =
              toStatus === "closed"
                ? canClose
                : canTransitionManagementReview(review.review_status, toStatus);
            return (
              <button
                key={toStatus}
                type="button"
                data-testid={`review-transition-${toStatus}`}
                style={allowed && !saving ? styles.button : styles.buttonDisabled}
                onClick={() => handleTransition(toStatus)}
                disabled={!allowed || saving}
                title={
                  toStatus === "closed" && !canClose
                    ? "Resolve all actions or record a waiver before closing"
                    : undefined
                }
              >
                → {reviewStatusLabel(toStatus)}
              </button>
            );
          })}

          {/* Snapshot capture for this review period */}
          {!isTerminal && (
            <SnapshotCaptureButton
              session={session}
              organizationId={review.organization_id}
              businessUnitId={review.business_unit_id}
              periodType={review.period_type}
              period={period}
              kpis={kpis}
              timezone={review.timezone}
              onCaptured={onChanged}
            />
          )}

          {/* Edit summary */}
          {!editing && (
            <button
              type="button"
              style={styles.buttonSecondary}
              onClick={() => { setSummary(review.summary ?? ""); setEditing(true); }}
            >
              Edit Summary
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                style={saving ? styles.buttonDisabled : styles.button}
                onClick={handleSaveSummary}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                style={styles.buttonSecondary}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {isTerminal && (
        <div style={{ ...styles.note, marginTop: 6 }}>
          This review is closed. No further transitions are possible.
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function ManagementReviewPanel({
  session,
  organizationId,
  businessUnitId,
  periodType,
  period,
  timezone,
  kpis = [],
  reviews: initialReviews = [],
  onChanged,
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [loadError, setLoadError] = useState(null);

  // When parent refreshes, sync reviews prop → local state.
  React.useEffect(() => {
    setReviews(initialReviews);
  }, [initialReviews]);

  const handleChanged = useCallback(async () => {
    // Reload reviews for current period after any mutation.
    try {
      const fresh = await loadManagementReviews(session, { organizationId, periodType });
      setReviews(Array.isArray(fresh) ? fresh : []);
    } catch (err) {
      setLoadError(formatErrorMessage(err));
    }
    if (onChanged) onChanged();
  }, [session, organizationId, periodType, onChanged]);

  const periodReviews = Array.isArray(reviews)
    ? reviews.filter((r) => r.period_type === periodType)
    : [];

  const hasOpen = periodReviews.some((r) => r.review_status !== "closed");

  return (
    <div data-testid="management-review-panel">
      <div style={styles.label}>Management Review — {periodType}</div>

      {loadError && (
        <div style={{ ...styles.error, marginBottom: 8 }}>{loadError}</div>
      )}

      {periodReviews.length === 0 && (
        <div style={styles.empty}>
          No management review record for this period. Open one to begin the governed review
          cycle.
        </div>
      )}

      {periodReviews.map((review) => (
        <ReviewRow
          key={review.id}
          session={session}
          review={review}
          kpis={kpis}
          periodType={periodType}
          period={period}
          timezone={timezone}
          onChanged={handleChanged}
        />
      ))}

      {!hasOpen && (
        <CreateReviewForm
          session={session}
          organizationId={organizationId}
          businessUnitId={businessUnitId}
          periodType={periodType}
          period={period}
          timezone={timezone}
          onCreated={(r) => {
            setReviews((prev) => [r, ...prev]);
            if (onChanged) onChanged();
          }}
        />
      )}

      <div style={styles.note}>
        Reviews follow the governed lifecycle: draft → in_review → actions_open → closed.
        Closure requires resolved actions or a recorded waiver.
        KPI snapshots are append-only evidence and cannot be modified after capture.
      </div>
    </div>
  );
}
