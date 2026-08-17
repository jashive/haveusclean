// ── Wave 6: Change Control Panel ─────────────────────────────────────────────
//
// Lists HEMS change control records and drives the governed FSM.
// Every control performs a real persisted action through
// serviceosIntelligenceClient.js.

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  createChangeControlRecord,
  loadDependencyEdges,
  loadDependencyImpact,
  updateChangeControlRecord,
} from "../../lib/serviceosIntelligenceClient.js";
import { canCloseChangeControlRecord, nextCcrStatuses } from "../../lib/serviceosIntelligenceUtils.js";
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

function toJson(value, fallback) {
  if (!value || value.trim() === "") return fallback;
  return JSON.parse(value);
}

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
  const [dependencyEdges, setDependencyEdges] = useState([]);
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    let cancelled = false;
    loadDependencyEdges(session, {})
      .then((rows) => {
        if (!cancelled) setDependencyEdges(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setDependencyEdges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const edgeSources = useMemo(
    () => [...new Set(dependencyEdges.map((edge) => edge?.from_node).filter(Boolean))].sort(),
    [dependencyEdges]
  );

  const resolveDraft = useCallback((record) => {
    const existing = drafts[record.id];
    if (existing) return existing;
    return {
      impact_assessment: JSON.stringify(record.impact_assessment ?? {}, null, 2),
      implementation_plan: record.implementation_plan ?? "",
      training_required: Boolean(record.training_required),
      training_status: record.training_status ?? "",
      validation_result: JSON.stringify(record.validation_result ?? {}, null, 2),
      hems_decision_reference: record.hems_decision_reference ?? "",
      release_reference: record.release_reference ?? "",
      source_kpi_codes: Array.isArray(record.source_kpi_codes) ? record.source_kpi_codes.join(",") : "",
      source_kpi_snapshot_manifest: JSON.stringify(record.source_kpi_snapshot_manifest ?? [], null, 2),
      dependency_source_node: "",
    };
  }, [drafts]);

  const setDraftField = useCallback((recordId, field, value) => {
    setDrafts((prev) => {
      // On first edit of a record, initialize from the full record baseline so
      // that save never submits undefined-field payloads for untouched fields.
      const existing = prev[recordId];
      if (!existing) {
        const record = records.find((r) => r.id === recordId);
        const baseline = record ? resolveDraft(record) : {};
        return { ...prev, [recordId]: { ...baseline, [field]: value } };
      }
      return { ...prev, [recordId]: { ...existing, [field]: value } };
    });
  }, [records, resolveDraft]);

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
        await updateChangeControlRecord(session, record.id, {
          current_status: record.change_status,
          change_status: nextStatus,
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

  const handlePersistEvidence = useCallback(async (record) => {
    setError(null);
    setBusy(true);
    try {
      const draft = resolveDraft(record);
      await updateChangeControlRecord(session, record.id, {
        current_status: record.change_status,
        source_kpi_codes: draft.source_kpi_codes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        source_kpi_snapshot_manifest: toJson(draft.source_kpi_snapshot_manifest, []),
        impact_assessment: toJson(draft.impact_assessment, {}),
        implementation_plan: draft.implementation_plan.trim() || null,
        training_required: Boolean(draft.training_required),
        training_status: draft.training_status.trim() || null,
        validation_result: toJson(draft.validation_result, {}),
        hems_decision_reference: draft.hems_decision_reference.trim() || null,
        release_reference: draft.release_reference.trim() || null,
      });
      if (onChanged) await onChanged();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [onChanged, resolveDraft, session]);

  const handleLoadImpact = useCallback(async (record) => {
    setError(null);
    setBusy(true);
    try {
      const draft = resolveDraft(record);
      const node = draft.dependency_source_node;
      if (!node) throw new Error("Select a dependency graph source node first.");
      const result = await loadDependencyImpact(session, { fromNode: node, maxDepth: 8 });
      const impacted = Array.isArray(result?.impacted) ? result.impacted : [];
      if (impacted.length === 0) throw new Error(`No downstream nodes reachable from ${node}.`);
      const affected = impacted.map((entry) => entry.node).filter(Boolean);

      // Build structured dependency assessment preserving control_rule.
      const dependencyPaths = impacted.map((entry) => ({
        kg_id: entry.kg_id ?? null,
        from_node: entry.from_node,
        to_node: entry.to_node ?? entry.node,
        edge_type: entry.edge_type ?? "depends_on",
        control_rule: entry.control_rule ?? null,
        depth: entry.depth,
      }));

      // Validate structured assessment: each affected node must be a real graph node.
      const knownNodes = new Set([
        ...dependencyEdges.map((e) => e.from_node),
        ...dependencyEdges.map((e) => e.to_node),
      ]);
      for (const n of affected) {
        if (!knownNodes.has(n)) {
          throw new Error(`Impact node "${n}" does not exist in the dependency graph.`);
        }
      }

      // Merge with the current draft's existing impact_assessment, not only the
      // stale persisted record, so unsaved operator assessment is not discarded.
      let existingAssessment = {};
      try {
        existingAssessment = toJson(draft.impact_assessment, {});
      } catch {
        existingAssessment = {};
      }

      const newAssessment = {
        ...existingAssessment,
        dependency_graph_source: node,
        dependency_edge_count: impacted.length,
        dependency_paths: dependencyPaths,
        affected_node_count: affected.length,
      };

      // Show the operator a preview of impacted nodes and control rules before persisting.
      const controlRuleSummary = dependencyPaths
        .filter((p) => p.control_rule)
        .map((p) => `  ${p.from_node} → ${p.to_node} [${p.control_rule}]`)
        .join("\n");
      const preview =
        `Dependency impact from "${node}":\n` +
        `  ${affected.length} affected node(s): ${affected.slice(0, 8).join(", ")}${affected.length > 8 ? "…" : ""}\n` +
        (controlRuleSummary ? `Control rules:\n${controlRuleSummary}\n` : "") +
        `\nPersist this impact assessment?`;
      if (!window.confirm(preview)) {
        setBusy(false);
        return;
      }

      await updateChangeControlRecord(session, record.id, {
        current_status: record.change_status,
        affected_dependencies: affected,
        impact_assessment: newAssessment,
      });
      if (onChanged) await onChanged();
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [dependencyEdges, onChanged, resolveDraft, session]);

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
          <div style={styles.note}>No change control records for this business-unit scope yet.</div>
        )}
        {records.map((record) => {
          const transitions = nextCcrStatuses(record.change_status);
          const draft = resolveDraft(record);
          return (
            <div key={record.id} style={styles.row}>
              <div style={styles.rowTitle}>
                {record.change_code} — {record.title}
              </div>
              <div style={styles.rowMeta}>
                {formatStatusLabel(record.change_status)} · {formatStatusLabel(record.change_type)} ·{" "}
                {record.material_change ? "Material" : "Non-material"} ·{" "}
                {formatTimestamp(record.created_at)}
              </div>

              <input
                style={styles.input}
                placeholder="Source KPI codes (comma separated)"
                value={draft.source_kpi_codes}
                onChange={(e) => setDraftField(record.id, "source_kpi_codes", e.target.value)}
              />
              <textarea
                style={styles.input}
                placeholder='Source KPI snapshot manifest JSON (e.g. [{"kpi_snapshot_id":"...","kpi_code":"...","definition_version":"1"}])'
                value={draft.source_kpi_snapshot_manifest}
                onChange={(e) =>
                  setDraftField(record.id, "source_kpi_snapshot_manifest", e.target.value)
                }
              />
              <textarea
                style={styles.input}
                placeholder="Impact assessment JSON"
                value={draft.impact_assessment}
                onChange={(e) => setDraftField(record.id, "impact_assessment", e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Implementation plan"
                value={draft.implementation_plan}
                onChange={(e) => setDraftField(record.id, "implementation_plan", e.target.value)}
              />
              <label style={{ ...styles.note, display: "block" }}>
                <input
                  type="checkbox"
                  checked={Boolean(draft.training_required)}
                  onChange={(e) => setDraftField(record.id, "training_required", e.target.checked)}
                />{" "}
                Training required
              </label>
              <input
                style={styles.input}
                placeholder="Training status"
                value={draft.training_status}
                onChange={(e) => setDraftField(record.id, "training_status", e.target.value)}
              />
              <textarea
                style={styles.input}
                placeholder='Validation result JSON (must include passed true for closure, plus evidence/ref)'
                value={draft.validation_result}
                onChange={(e) => setDraftField(record.id, "validation_result", e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="HEMS decision reference"
                value={draft.hems_decision_reference}
                onChange={(e) => setDraftField(record.id, "hems_decision_reference", e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Release reference"
                value={draft.release_reference}
                onChange={(e) => setDraftField(record.id, "release_reference", e.target.value)}
              />

              <select
                style={styles.input}
                value={draft.dependency_source_node}
                onChange={(e) => setDraftField(record.id, "dependency_source_node", e.target.value)}
              >
                <option value="">Select dependency source node</option>
                {edgeSources.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>

              <div style={styles.actions}>
                <button
                  type="button"
                  style={busy ? styles.buttonDisabled : styles.button}
                  disabled={busy}
                  onClick={() => handlePersistEvidence(record)}
                >
                  Save workflow evidence
                </button>
                <button
                  type="button"
                  style={busy ? styles.buttonDisabled : styles.button}
                  disabled={busy || !draft.dependency_source_node}
                  onClick={() => handleLoadImpact(record)}
                >
                  Load & persist dependency impact
                </button>
                {transitions.length === 0 && (
                  <span style={styles.note}>Terminal state — no further transition.</span>
                )}
                {transitions.map((nextStatus) => {
                  const blocked = nextStatus === "closed" && !canCloseChangeControlRecord(record);
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
                  Closure blocked: material change needs dependency/impact evidence and a
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
