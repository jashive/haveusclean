// ── Wave 6: Change Control Panel ─────────────────────────────────────────────
//
// Lists HEMS change control records and drives the governed FSM.
// Every control performs a real persisted action through
// serviceosIntelligenceClient.js. Only legal transitions are offered, and a
// material change cannot be closed without impact assessment + passed
// validation evidence.

import React, { useCallback, useState } from "react";

import {
  createChangeControlRecord,
  updateChangeControlRecord,
} from "../../lib/serviceosIntelligenceClient.js";
import {
  canCloseChangeControlRecord,
  nextCcrStatuses,
} from "../../lib/serviceosIntelligenceUtils.js";
import { formatErrorMessage, formatStatusLabel, formatTimestamp } from "./wave6Formatters.js";

const CHANGE_TYPES = ["process", "pricing", "sop", "training", "system", "hems_model"];

const styles = {
  section: { marginBottom: "0.8rem" },
  label: {
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#7dd3fc",
    marginBottom: 6,
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
  row: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 6,
    padding: "0.5rem 0.6rem",
    marginBottom: 6,
  },
  rowTitle: { fontSize: "0.78rem", fontWeight: 600, color: "#e8f4ff" },
  rowMeta: { fontSize: "0.65rem", color: "#94a3b8", marginTop: 2 },
  actions: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
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
  error: { color: "#fca5a5", fontSize: "0.7rem", marginTop: 4 },
  note: { color: "#94a3b8", fontSize: "0.68rem", marginTop: 4, lineHeight: 1.4 },
};

export default function ChangeControlPanel({
  session,
  organizationId,
  businessUnitId,
  records = [],
  onChanged,
}) {
  const [changeCode, setChangeCode] = useState("");
  const [title, setTitle] = useState("");
  const [changeType, setChangeType] = useState("process");
  const [reason, setReason] = useState("");
  const [material, setMaterial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await createChangeControlRecord(session, {
        change_code: changeCode.trim(),
        change_type: changeType,
        title: title.trim(),
        reason: reason.trim() === "" ? null : reason.trim(),
        material_change: material,
        organization_id: organizationId,
        business_unit_id: businessUnitId ?? null,
      });
      setChangeCode("");
      setTitle("");
      setReason("");
      setMaterial(false);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    session,
    changeCode,
    changeType,
    title,
    reason,
    material,
    organizationId,
    businessUnitId,
    onChanged,
  ]);

  const handleTransition = useCallback(
    async (record, nextStatus) => {
      setError(null);
      setBusy(true);
      try {
        const patch = {
          current_status: record.change_status,
          change_status: nextStatus,
        };
        if (nextStatus === "approve") {
          patch.approval_at = new Date().toISOString();
        }
        await updateChangeControlRecord(session, record.id, patch);
        if (onChanged) await onChanged();
      } catch (err) {
        setError(formatErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [session, onChanged]
  );

  const canCreate =
    !busy && changeCode.trim() !== "" && title.trim() !== "" && Boolean(organizationId);

  return (
    <div>
      <div style={styles.section}>
        <div style={styles.label}>Open change control</div>
        <input
          style={styles.input}
          placeholder="Change code (e.g. CCR-2026-001)"
          value={changeCode}
          onChange={(e) => setChangeCode(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          style={styles.input}
          value={changeType}
          onChange={(e) => setChangeType(e.target.value)}
        >
          {CHANGE_TYPES.map((type) => (
            <option key={type} value={type}>
              {formatStatusLabel(type)}
            </option>
          ))}
        </select>
        <input
          style={styles.input}
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label style={{ ...styles.note, display: "block" }}>
          <input
            type="checkbox"
            checked={material}
            onChange={(e) => setMaterial(e.target.checked)}
          />{" "}
          Material change (requires impact assessment and passed validation before closure)
        </label>
        <button
          type="button"
          style={canCreate ? styles.button : styles.buttonDisabled}
          disabled={!canCreate}
          onClick={handleCreate}
        >
          {busy ? "Working…" : "Create change control record"}
        </button>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.section}>
        <div style={styles.label}>Change control records ({records.length})</div>
        {records.length === 0 && (
          <div style={styles.note}>
            No change control records for this organization yet.
          </div>
        )}
        {records.map((record) => {
          const transitions = nextCcrStatuses(record.change_status);
          return (
            <div key={record.id} style={styles.row}>
              <div style={styles.rowTitle}>
                {record.change_code} — {record.title}
              </div>
              <div style={styles.rowMeta}>
                {formatStatusLabel(record.change_status)} ·{" "}
                {formatStatusLabel(record.change_type)} ·{" "}
                {record.material_change ? "Material" : "Non-material"} ·{" "}
                {formatTimestamp(record.created_at)}
              </div>
              <div style={styles.actions}>
                {transitions.length === 0 && (
                  <span style={styles.note}>Terminal state — no further transition.</span>
                )}
                {transitions.map((nextStatus) => {
                  const blocked =
                    nextStatus === "closed" && !canCloseChangeControlRecord(record);
                  return (
                    <button
                      key={nextStatus}
                      type="button"
                      style={blocked || busy ? styles.buttonDisabled : styles.button}
                      disabled={blocked || busy}
                      onClick={() => handleTransition(record, nextStatus)}
                    >
                      → {formatStatusLabel(nextStatus)}
                    </button>
                  );
                })}
              </div>
              {record.material_change && !canCloseChangeControlRecord(record) && (
                <div style={styles.note}>
                  Closure blocked: material change needs a non-empty impact assessment and a
                  validation result with passed = true.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
