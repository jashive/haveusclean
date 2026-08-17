// ── Wave 6: Continuity Panel ─────────────────────────────────────────────────
//
// Declares and manages continuity (fallback / DR) sessions, records offline
// transactions with a stable correlation id, and drives reconciliation.
// Every control performs a real persisted action; nothing here is simulated.

import React, { useCallback, useState } from "react";

import {
  createContinuitySession,
  loadContinuityTransactions,
  recordContinuityTransaction,
  reconcileContinuityTransaction,
  updateContinuitySession,
} from "../../lib/serviceosIntelligenceClient.js";
import {
  canCloseContinuitySession,
  isValidOfflineCorrelationId,
  nextContinuityStatuses,
  pendingContinuityTransactions,
} from "../../lib/serviceosIntelligenceUtils.js";
import { formatErrorMessage, formatStatusLabel, formatTimestamp } from "./wave6Formatters.js";

const FALLBACK_TYPES = ["serviceos_outage", "partial_degradation", "planned_maintenance"];

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

export default function ContinuityPanel({
  session,
  organizationId,
  businessUnitId,
  sessions = [],
  onChanged,
}) {
  const [sessionCode, setSessionCode] = useState("");
  const [fallbackType, setFallbackType] = useState("serviceos_outage");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [correlationId, setCorrelationId] = useState("");
  const [transactionType, setTransactionType] = useState("offline_job_record");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [snapshotSummary, setSnapshotSummary] = useState("");
  const [snapshotAmount, setSnapshotAmount] = useState("");
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refreshTransactions = useCallback(
    async (continuitySessionId) => {
      if (!continuitySessionId) {
        setTransactions([]);
        return;
      }
      const rows = await loadContinuityTransactions(session, { continuitySessionId });
      setTransactions(rows);
    },
    [session]
  );

  const handleSelectSession = useCallback(
    async (id) => {
      setSelectedSessionId(id);
      setError(null);
      try {
        await refreshTransactions(id);
      } catch (err) {
        setError(formatErrorMessage(err));
      }
    },
    [refreshTransactions]
  );

  const handleDeclare = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await createContinuitySession(session, {
        session_code: sessionCode.trim(),
        fallback_type: fallbackType,
        organization_id: organizationId,
        business_unit_id: businessUnitId ?? null,
      });
      setSessionCode("");
      if (onChanged) await onChanged();
      if (created?.id) await handleSelectSession(created.id);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    session,
    sessionCode,
    fallbackType,
    organizationId,
    businessUnitId,
    onChanged,
    handleSelectSession,
  ]);

  const handleTransition = useCallback(
    async (continuitySession, nextStatus) => {
      setError(null);
      setBusy(true);
      try {
        await updateContinuitySession(session, continuitySession.id, {
          current_status: continuitySession.session_status,
          session_status: nextStatus,
        });
        if (onChanged) await onChanged();
      } catch (err) {
        setError(formatErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [session, onChanged]
  );

  const handleRecordWaiver = useCallback(
    async (continuitySession) => {
      if (!waiverReason.trim()) {
        setError("Waiver rationale/evidence is required.");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await updateContinuitySession(session, continuitySession.id, {
          waiver_recorded: true,
          waiver_reason: waiverReason.trim(),
          current_status: continuitySession.session_status,
        });
        setWaiverReason("");
        if (onChanged) await onChanged();
      } catch (err) {
        setError(formatErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [session, waiverReason, onChanged]
  );

  const handleRecordTransaction = useCallback(async () => {
    setError(null);
    const selectedSession = sessions.find((row) => row.id === selectedSessionId) ?? null;
    if (!selectedSession) {
      setError("Select a continuity session first.");
      return;
    }
    if (!snapshotSummary.trim()) {
      setError("Transaction snapshot summary is required.");
      return;
    }
    const amountInput = snapshotAmount.trim();
    const parsedAmount = amountInput === "" ? null : Number(amountInput);
    if (amountInput !== "" && !Number.isFinite(parsedAmount)) {
      setError("Amount observed must be a finite number when provided.");
      return;
    }
    setBusy(true);
    try {
      await recordContinuityTransaction(session, {
        continuity_session_id: selectedSession.id,
        offline_correlation_id: correlationId.trim(),
        organization_id: selectedSession.organization_id,
        business_unit_id: selectedSession.business_unit_id ?? null,
        transaction_type: transactionType.trim(),
        serviceos_entity_type: entityType.trim() || null,
        serviceos_entity_id: entityId.trim() || null,
        transaction_data: {
          summary: snapshotSummary.trim(),
          amount_observed: parsedAmount,
          captured_source: "continuity_panel",
        },
      });
      setCorrelationId("");
      setSnapshotSummary("");
      setSnapshotAmount("");
      setEntityType("");
      setEntityId("");
      await refreshTransactions(selectedSessionId);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [
    session,
    selectedSessionId,
    correlationId,
    transactionType,
    entityType,
    entityId,
    snapshotSummary,
    snapshotAmount,
    sessions,
    refreshTransactions,
  ]);

  const handleReconcile = useCallback(
    async (transaction, status) => {
      setError(null);
      const note = reconciliationNote.trim();
      if (status === "discrepancy" && !note) {
        setError("Discrepancy notes are required.");
        return;
      }
      if (status === "waived" && !note) {
        setError("Waiver rationale/evidence is required.");
        return;
      }
      setBusy(true);
      try {
        const reconciliation = { reconciliation_status: status };
        if (status === "discrepancy") reconciliation.discrepancy_notes = note;
        if (status === "waived") reconciliation.waiver_evidence = note;
        await reconcileContinuityTransaction(session, transaction.id, reconciliation);
        setReconciliationNote("");
        await refreshTransactions(selectedSessionId);
      } catch (err) {
        setError(formatErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [session, selectedSessionId, reconciliationNote, refreshTransactions]
  );

  const canDeclare = !busy && sessionCode.trim() !== "" && Boolean(organizationId);
  const canRecord =
    !busy &&
    Boolean(selectedSessionId) &&
    isValidOfflineCorrelationId(correlationId.trim()) &&
    snapshotSummary.trim() !== "" &&
    (snapshotAmount.trim() === "" || Number.isFinite(Number(snapshotAmount.trim())));
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  return (
    <div>
      <div style={styles.section}>
        <div style={styles.label}>Declare fallback session</div>
        <input
          style={styles.input}
          placeholder="Session code (e.g. DR-2026-03-01)"
          value={sessionCode}
          onChange={(e) => setSessionCode(e.target.value)}
        />
        <select
          style={styles.input}
          value={fallbackType}
          onChange={(e) => setFallbackType(e.target.value)}
        >
          {FALLBACK_TYPES.map((type) => (
            <option key={type} value={type}>
              {formatStatusLabel(type)}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={canDeclare ? styles.button : styles.buttonDisabled}
          disabled={!canDeclare}
          onClick={handleDeclare}
        >
          {busy ? "Working…" : "Declare continuity session"}
        </button>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.section}>
        <div style={styles.label}>Continuity sessions ({sessions.length})</div>
        {sessions.length === 0 && (
          <div style={styles.note}>No continuity sessions declared for this business-unit scope.</div>
        )}
        {sessions.map((continuitySession) => {
          const isSelected = continuitySession.id === selectedSessionId;
          const transitions = nextContinuityStatuses(continuitySession.session_status);
          const pending = isSelected ? pendingContinuityTransactions(transactions) : [];
          return (
            <div key={continuitySession.id} style={styles.row}>
              <div style={styles.rowTitle}>{continuitySession.session_code}</div>
              <div style={styles.rowMeta}>
                {formatStatusLabel(continuitySession.session_status)} ·{" "}
                {formatStatusLabel(continuitySession.fallback_type)} · declared{" "}
                {formatTimestamp(continuitySession.declared_at)}
              </div>
              <div style={styles.actions}>
                <button
                  type="button"
                  style={busy ? styles.buttonDisabled : styles.button}
                  disabled={busy}
                  onClick={() => handleSelectSession(continuitySession.id)}
                >
                  {isSelected ? "Reload transactions" : "Open transactions"}
                </button>
                {transitions.map((nextStatus) => {
                  const blocked =
                    nextStatus === "closed" &&
                    !canCloseContinuitySession(continuitySession, isSelected ? transactions : []);
                  return (
                    <button
                      key={nextStatus}
                      type="button"
                      style={blocked || busy ? styles.buttonDisabled : styles.button}
                      disabled={blocked || busy}
                      onClick={() => handleTransition(continuitySession, nextStatus)}
                    >
                      → {formatStatusLabel(nextStatus)}
                    </button>
                  );
                })}
              </div>
              {!continuitySession.waiver_recorded && (
                <>
                  <input
                    style={styles.input}
                    placeholder="Continuity-session waiver rationale/evidence"
                    value={waiverReason}
                    onChange={(e) => setWaiverReason(e.target.value)}
                  />
                  <button
                    type="button"
                    style={busy ? styles.buttonDisabled : styles.button}
                    disabled={busy || waiverReason.trim() === ""}
                    onClick={() => handleRecordWaiver(continuitySession)}
                  >
                    Record session waiver
                  </button>
                </>
              )}
              {isSelected && pending.length > 0 && (
                <div style={styles.note}>
                  {pending.length} transaction(s) still pending reconciliation — closure requires
                  reconciliation or a recorded waiver.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedSession && (
        <div style={styles.section}>
          <div style={styles.label}>
            Offline transactions — {selectedSession.session_code} ({transactions.length})
          </div>
          <input
            style={styles.input}
            placeholder="Offline correlation id (4-64 chars)"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Transaction type"
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="ServiceOS entity type (optional)"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="ServiceOS entity id (optional UUID)"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Structured snapshot summary (required)"
            value={snapshotSummary}
            onChange={(e) => setSnapshotSummary(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Amount observed (optional)"
            value={snapshotAmount}
            onChange={(e) => setSnapshotAmount(e.target.value)}
          />
          <button
            type="button"
            style={canRecord ? styles.button : styles.buttonDisabled}
            disabled={!canRecord}
            onClick={handleRecordTransaction}
          >
            Record offline transaction
          </button>
          {correlationId.trim() !== "" && !isValidOfflineCorrelationId(correlationId.trim()) && (
            <div style={styles.note}>
              Correlation id must be 4-64 characters: letters, digits, dot, dash or underscore.
            </div>
          )}
          {snapshotAmount.trim() !== "" && !Number.isFinite(Number(snapshotAmount.trim())) && (
            <div style={styles.note}>Amount observed must be a finite number.</div>
          )}
          {transactions.length === 0 && (
            <div style={styles.note}>No offline transactions recorded for this session.</div>
          )}
          <input
            style={styles.input}
            placeholder="Reconciliation discrepancy/waiver evidence"
            value={reconciliationNote}
            onChange={(e) => setReconciliationNote(e.target.value)}
          />
          {transactions.map((transaction) => (
            <div key={transaction.id} style={styles.row}>
              <div style={styles.rowTitle}>{transaction.offline_correlation_id}</div>
              <div style={styles.rowMeta}>
                {formatStatusLabel(transaction.transaction_type)} ·{" "}
                {formatStatusLabel(transaction.reconciliation_status)}
                {transaction.reconciled_at
                  ? ` · reconciled ${formatTimestamp(transaction.reconciled_at)}`
                  : ""}
              </div>
              {transaction.reconciliation_status === "pending" && (
                <div style={styles.actions}>
                  {["matched", "discrepancy", "waived"].map((status) => (
                    <button
                      key={status}
                      type="button"
                      style={busy ? styles.buttonDisabled : styles.button}
                      disabled={busy}
                      onClick={() => handleReconcile(transaction, status)}
                    >
                      {formatStatusLabel(status)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
