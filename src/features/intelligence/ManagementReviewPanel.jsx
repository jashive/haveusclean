// ── Wave 6: Management Review Panel ──────────────────────────────────────────
//
// Renders the governed management review workflow for a given period:
//   - View and open review records (DAILY/MONTHLY/QUARTERLY/YEARLY)
//   - Capture governed KPI snapshots (append-only evidence)
//     KPI snapshot payload contract:
//       kpi_definition_id (resolved from loaded definitions — fail closed if missing)
//       kpi_code, definition_version, organization_id, business_unit_id,
//       period_type, period_start, period_end, timezone,
//       numeric_value, numerator, denominator,
//       source_lineage, source_freshness_at
//   - Record exceptions, decisions, and actions
//   - Mark actions resolved
//   - Record an explicit waiver when governance permits
//   - Advance the review through legal lifecycle states
//   - Close only when governance prerequisites are met
//
// Every mutation goes through serviceosIntelligenceClient.js.
// No synthetic values. Unavailable data is reported truthfully.
// No value, row_counts, source_tables, or freshness_at fields are sent
// (those are not valid kpi_snapshot columns).

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
import {
  buildSnapshotSourceLineage,
  mergeSnapshotManifest,
  resolveDefinition,
} from "./managementReviewEvidence.js";

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
  buttonWarning: {
    background: "#78350f",
    border: "none",
    borderRadius: 4,
    color: "#fde68a",
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
  subSection: {
    marginTop: 8,
    borderTop: "1px solid #1e3a5f",
    paddingTop: 6,
  },
  itemRow: {
    background: "#060f1f",
    border: "1px solid #1e2d44",
    borderRadius: 4,
    padding: "0.3rem 0.45rem",
    marginBottom: 4,
    fontSize: "0.7rem",
    color: "#cbd5e1",
  },
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
//
// Resolves kpi_definition_id from the loaded kpiDefinitions for each KPI.
// Fails closed: if no active definition is found, that KPI snapshot is skipped
// with a warning rather than sending an invalid payload to the database.
// Sends only valid kpi_snapshot columns: numeric_value, source_lineage,
// source_freshness_at, kpi_definition_id, definition_version.
// Never sends value, row_counts, source_tables, or freshness_at.

function SnapshotCaptureButton({
  session,
  review,
  organizationId,
  businessUnitId,
  periodType,
  period,
  kpis,
  kpiDefinitions,
  timezone,
  onCaptured,
}) {
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
    const skipped = [];
    const manifestEntries = [];
    let capturedCount = 0;
    for (const kpi of kpis) {
      if (kpi.unavailable === true) continue;
      if (kpi.value === null || kpi.value === undefined) continue;

      const { definition, error: definitionError } = resolveDefinition(kpiDefinitions, kpi.kpiCode, {
        organizationId,
        periodType: review?.period_type,
        periodStart: review?.period_start,
        periodEnd: review?.period_end,
      });
      if (!definition) {
        skipped.push(`${kpi.kpiCode} (${definitionError})`);
        continue;
      }
      const sourceLineage = buildSnapshotSourceLineage(definition, kpi);
      if (!sourceLineage) {
        errors.push(`${kpi.kpiCode}: missing runtime source lineage`);
        continue;
      }

      try {
        const snapshot = await captureKpiSnapshot(session, {
          kpi_definition_id: definition.id,
          kpi_code: kpi.kpiCode,
          definition_version: definition.definition_version ?? "1",
          organization_id: organizationId,
          business_unit_id: businessUnitId ?? null,
          jurisdiction_id: kpi.effectiveScope?.jurisdiction_id ?? null,
          period_type: periodType,
          period_start: period.periodStart.toISOString(),
          period_end: period.periodEnd.toISOString(),
          timezone,
          numeric_value: kpi.value,
          numerator: kpi.numerator ?? null,
          denominator: kpi.denominator ?? null,
          source_lineage: sourceLineage,
          source_freshness_at: kpi.sourceFreshnessAt ?? null,
        });
        capturedCount += 1;
        if (!snapshot?.id) {
          throw new Error(`Wave 6: snapshot capture for ${kpi.kpiCode} returned no id`);
        }
        // Fail closed: the DB always stamps captured_at; never fall back to a
        // browser-side timestamp.  If any required manifest field is absent, skip
        // this snapshot and report the error — do not fabricate metadata.
        if (!snapshot.captured_at || !snapshot.kpi_code || !snapshot.definition_version) {
          errors.push(
            `${kpi.kpiCode}: snapshot ${snapshot.id} missing required manifest fields ` +
            `(captured_at=${snapshot.captured_at ?? "absent"}, kpi_code=${snapshot.kpi_code ?? "absent"}, ` +
            `definition_version=${snapshot.definition_version ?? "absent"}) — manifest entry skipped`
          );
          continue;
        }
        manifestEntries.push({
          kpi_snapshot_id: snapshot.id,
          kpi_code: snapshot.kpi_code,
          definition_version: snapshot.definition_version,
          captured_at: snapshot.captured_at,
        });
      } catch (err) {
        errors.push(`${kpi.kpiCode}: ${formatErrorMessage(err)}`);
      }
    }
    if (manifestEntries.length > 0) {
      const mergedManifest = mergeSnapshotManifest(review?.kpi_snapshot_manifest, manifestEntries);
      const currentManifestLength = Array.isArray(review?.kpi_snapshot_manifest)
        ? review.kpi_snapshot_manifest.length
        : 0;
      if (mergedManifest.length !== currentManifestLength) {
        try {
          await updateManagementReview(session, review.id, {
            kpi_snapshot_manifest: mergedManifest,
            current_status: review.review_status,
          });
        } catch (err) {
          errors.push(`manifest: ${formatErrorMessage(err)}`);
        }
      }
    }
    setCapturing(false);
    const parts = [];
    if (capturedCount > 0) parts.push(`Captured ${capturedCount} snapshot(s).`);
    if (manifestEntries.length > 0) parts.push(`Linked ${manifestEntries.length} manifest reference(s).`);
    if (skipped.length > 0) parts.push(`Skipped ${skipped.length}: ${skipped.join(", ")}.`);
    if (errors.length > 0) {
      setError(`Partial capture — ${errors.length} error(s): ${errors.join("; ")}`);
    } else {
      setSuccess(parts.join(" ") || "Nothing to capture.");
      if (capturedCount > 0 && onCaptured) onCaptured();
    }
  }, [session, review, organizationId, businessUnitId, periodType, period, kpis, kpiDefinitions, timezone, onCaptured]);

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

// ── Sub-component: add exception / decision / action inline forms ────────────

function AddItemForm({ label, placeholder, onAdd }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(text.trim());
      setText("");
      setOpen(false);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [text, onAdd]);

  if (!open) {
    return (
      <button type="button" style={styles.buttonSecondary} onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <textarea
        style={styles.textarea}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
      />
      <div style={styles.actions}>
        <button
          type="button"
          style={saving || !text.trim() ? styles.buttonDisabled : styles.button}
          onClick={handleAdd}
          disabled={saving || !text.trim()}
        >
          {saving ? "Saving…" : `Add ${label}`}
        </button>
        <button type="button" style={styles.buttonSecondary} onClick={() => { setText(""); setOpen(false); }}>
          Cancel
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ── Sub-component: single review record row ──────────────────────────────────

function ReviewRow({ session, review, kpis, kpiDefinitions, periodType, period, timezone, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(review.summary ?? "");
  const [waiverReason, setWaiverReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const canClose = canCloseManagementReview(review);
  const nextStatuses = nextReviewStatuses(review.review_status);
  const isTerminal = review.review_status === "closed";

  const currentExceptions = Array.isArray(review.exceptions) ? review.exceptions : [];
  const currentDecisions = Array.isArray(review.decisions) ? review.decisions : [];
  const currentActions = Array.isArray(review.actions) ? review.actions : [];
  const reviewPeriod = {
    periodStart: new Date(review.period_start),
    periodEnd: new Date(review.period_end),
  };

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

  const handleAddException = useCallback(async (text) => {
    const updated = [...currentExceptions, { id: crypto.randomUUID(), text, recorded_at: new Date().toISOString() }];
    await updateManagementReview(session, review.id, {
      exceptions: updated,
      current_status: review.review_status,
    });
    if (onChanged) onChanged();
  }, [session, review.id, review.review_status, currentExceptions, onChanged]);

  const handleAddDecision = useCallback(async (text) => {
    const updated = [...currentDecisions, { id: crypto.randomUUID(), text, recorded_at: new Date().toISOString() }];
    await updateManagementReview(session, review.id, {
      decisions: updated,
      current_status: review.review_status,
    });
    if (onChanged) onChanged();
  }, [session, review.id, review.review_status, currentDecisions, onChanged]);

  const handleAddAction = useCallback(async (text) => {
    const updated = [...currentActions, { id: crypto.randomUUID(), text, is_resolved: false, created_at: new Date().toISOString() }];
    await updateManagementReview(session, review.id, {
      actions: updated,
      current_status: review.review_status,
    });
    if (onChanged) onChanged();
  }, [session, review.id, review.review_status, currentActions, onChanged]);

  const handleResolveAction = useCallback(async (actionId) => {
    const updated = currentActions.map((a) =>
      a.id === actionId ? { ...a, is_resolved: true, resolved_at: new Date().toISOString() } : a
    );
    await updateManagementReview(session, review.id, {
      actions: updated,
      current_status: review.review_status,
    });
    if (onChanged) onChanged();
  }, [session, review.id, review.review_status, currentActions, onChanged]);

  const handleRecordWaiver = useCallback(async () => {
    if (!waiverReason.trim()) {
      setError("Waiver rationale/evidence is required.");
      return;
    }
    await updateManagementReview(session, review.id, {
      waiver_recorded: true,
      waiver_reason: waiverReason.trim(),
      current_status: review.review_status,
    });
    setWaiverReason("");
    if (onChanged) onChanged();
  }, [session, review.id, review.review_status, waiverReason, onChanged]);

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
        Actions: {currentActions.length} ·
        Exceptions: {currentExceptions.length} ·
        Decisions: {currentDecisions.length}
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

      {/* Exceptions */}
      {currentExceptions.length > 0 && (
        <div style={styles.subSection}>
          <div style={{ ...styles.rowMeta, fontWeight: 700, marginBottom: 4 }}>Exceptions</div>
          {currentExceptions.map((ex) => (
            <div key={ex.id} style={styles.itemRow}>{ex.text}</div>
          ))}
        </div>
      )}

      {/* Decisions */}
      {currentDecisions.length > 0 && (
        <div style={styles.subSection}>
          <div style={{ ...styles.rowMeta, fontWeight: 700, marginBottom: 4 }}>Decisions</div>
          {currentDecisions.map((dec) => (
            <div key={dec.id} style={styles.itemRow}>{dec.text}</div>
          ))}
        </div>
      )}

      {/* Actions */}
      {currentActions.length > 0 && (
        <div style={styles.subSection}>
          <div style={{ ...styles.rowMeta, fontWeight: 700, marginBottom: 4 }}>Actions</div>
          {currentActions.map((act) => (
            <div key={act.id} style={{ ...styles.itemRow, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ textDecoration: act.is_resolved ? "line-through" : "none", color: act.is_resolved ? "#64748b" : "#cbd5e1" }}>
                {act.text}
              </span>
              {!isTerminal && !act.is_resolved && (
                <button
                  type="button"
                  style={{ ...styles.buttonSecondary, marginLeft: 6, padding: "0.15rem 0.35rem" }}
                  onClick={() => handleResolveAction(act.id)}
                  data-testid={`resolve-action-${act.id}`}
                >
                  Resolve
                </button>
              )}
              {act.is_resolved && <span style={{ color: "#86efac", fontSize: "0.62rem", marginLeft: 6 }}>✓</span>}
            </div>
          ))}
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

          {/* Snapshot capture */}
          <SnapshotCaptureButton
            session={session}
            review={review}
            organizationId={review.organization_id}
            businessUnitId={review.business_unit_id}
            periodType={review.period_type}
            period={reviewPeriod}
            kpis={kpis}
            kpiDefinitions={kpiDefinitions}
            timezone={review.timezone}
            onCaptured={onChanged}
          />

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

          {/* Add exception */}
          <AddItemForm
            label="Exception"
            placeholder="Describe the exception…"
            onAdd={handleAddException}
          />

          {/* Add decision */}
          <AddItemForm
            label="Decision"
            placeholder="Describe the decision…"
            onAdd={handleAddDecision}
          />

          {/* Add action */}
          <AddItemForm
            label="Action"
            placeholder="Describe the action item…"
            onAdd={handleAddAction}
          />

          {/* Record waiver */}
          {!review.waiver_recorded && (
            <>
              <input
                style={{ ...styles.input, marginBottom: 0 }}
                placeholder="Waiver rationale/evidence"
                value={waiverReason}
                onChange={(event) => setWaiverReason(event.target.value)}
              />
              <button
                type="button"
                style={styles.buttonWarning}
                onClick={handleRecordWaiver}
                data-testid="record-waiver-btn"
                title="Record an explicit governance waiver for this review period"
              >
                Record Waiver
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
  kpiDefinitions = [],
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
      const fresh = await loadManagementReviews(session, {
        organizationId,
        businessUnitId,
        periodType,
        periodStart: period?.periodStart,
        periodEnd: period?.periodEnd,
        timezone,
      });
      setReviews(Array.isArray(fresh) ? fresh : []);
    } catch (err) {
      setLoadError(formatErrorMessage(err));
    }
    if (onChanged) onChanged();
  }, [session, organizationId, businessUnitId, periodType, period, timezone, onChanged]);

  const periodReviews = Array.isArray(reviews)
    ? reviews.filter((r) => {
        if (r.period_type !== periodType) return false;
        if ((r.business_unit_id ?? null) !== (businessUnitId ?? null)) return false;
        if (String(r.timezone ?? "") !== String(timezone ?? "")) return false;
        if (new Date(r.period_start).toISOString() !== period.periodStart.toISOString()) return false;
        if (new Date(r.period_end).toISOString() !== period.periodEnd.toISOString()) return false;
        return true;
      })
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
          kpiDefinitions={kpiDefinitions}
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
