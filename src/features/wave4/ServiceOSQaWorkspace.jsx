import React, { useCallback, useMemo, useState } from "react";
import {
  createCorrectiveAction,
  createQaInspection,
  createWorkOrderEvent,
  fetchCorrectiveActionsForJob,
  fetchOperationalJobById,
  fetchQaInspectionsForJob,
  fetchWorkOrderForJob,
  updateOperationalJobStatus,
  updateQaInspectionStatus,
  updateWorkOrderStatus,
} from "../../lib/serviceosOperationsClient.js";
import {
  buildCorrectiveActionPayload,
  buildQaInspectionPayload,
} from "../../lib/serviceosOperationsUtils.js";

const QA_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_QA_ENABLED === "true";

const styles = {
  panel: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18 },
  title: { margin: "0 0 8px", fontSize: 20 },
  copy: { color: "#AEBAC9", fontSize: 14, lineHeight: 1.55 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 14 },
  field: { display: "grid", gap: 6 },
  label: { color: "#8291A6", fontSize: 12, fontWeight: 800, textTransform: "uppercase" },
  input: { border: "1px solid #344359", borderRadius: 8, background: "#0D1422", color: "#F5F8FC", padding: "10px 12px" },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 },
  button: { border: 0, borderRadius: 8, padding: "10px 14px", fontWeight: 800, cursor: "pointer" },
  primary: { background: "#00D4AA", color: "#07110F" },
  danger: { background: "#FF6B6B", color: "#220909" },
  secondary: { background: "#26364B", color: "#F5F8FC" },
  status: { marginTop: 14, padding: 12, borderRadius: 8, background: "#0D1422", color: "#C6D2E0", whiteSpace: "pre-wrap" },
  error: { marginTop: 14, color: "#FF8F8F" },
};

export default function ServiceOSQaWorkspace({ session, revenueContext }) {
  const role = revenueContext?.roleCode ?? "unknown";
  const accessToken = session?.access_token ?? null;
  const appUserId = revenueContext?.appUserId ?? null;
  const [jobId, setJobId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [score, setScore] = useState("100");
  const [findings, setFindings] = useState("QA review completed; no deficiencies found.");
  const [caseData, setCaseData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentInspection = useMemo(() => {
    const rows = caseData?.qaInspections ?? [];
    return [...rows].reverse().find((row) => ["pending", "in_progress"].includes(row.inspection_status)) ?? null;
  }, [caseData]);

  const refresh = useCallback(async () => {
    setError("");
    if (!jobId.trim() || !workOrderId.trim()) {
      setError("Operational job ID and work order ID are required.");
      return;
    }
    setBusy(true);
    try {
      const job = await fetchOperationalJobById(jobId.trim(), accessToken);
      const workOrder = await fetchWorkOrderForJob(jobId.trim(), accessToken);
      if (!job) throw new Error("Operational job not found or not visible to this QA role.");
      if (!workOrder || workOrder.id !== workOrderId.trim()) throw new Error("Work order does not match the selected operational job.");
      if (!["qa_pending", "qa_passed", "corrective_action_required"].includes(job.operational_status)) {
        throw new Error(`Job is not in a QA-stage status: ${job.operational_status}`);
      }
      const [qaInspections, correctiveActions] = await Promise.all([
        fetchQaInspectionsForJob(job.id, accessToken),
        fetchCorrectiveActionsForJob(job.id, accessToken),
      ]);
      setCaseData({ job, workOrder, qaInspections, correctiveActions });
    } catch (err) {
      setCaseData(null);
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [jobId, workOrderId, accessToken]);

  const startQa = useCallback(async () => {
    if (!caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      if (caseData.job.operational_status !== "qa_pending") throw new Error("QA can start only from qa_pending.");
      if ((caseData.qaInspections ?? []).some((q) => ["passed", "failed", "waived"].includes(q.inspection_status))) {
        throw new Error("A final QA outcome already exists for this case.");
      }
      const created = await createQaInspection(
        buildQaInspectionPayload({
          organizationId: caseData.job.organization_id,
          businessUnitId: caseData.job.business_unit_id,
          operationalJobId: caseData.job.id,
          workOrderId: caseData.workOrder.id,
          inspectorAppUserId: appUserId,
          inspectionStatus: "pending",
          inspectionType: "standard",
          findings: {},
          metadata: { source: "wave4_production_workspace", synthetic: false },
        }),
        accessToken
      );
      await updateQaInspectionStatus(created.id, "in_progress", accessToken, appUserId);
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [caseData, accessToken, appUserId, refresh]);

  const passQa = useCallback(async () => {
    if (!currentInspection || !caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) throw new Error("QA score must be between 0 and 100.");
      await updateQaInspectionStatus(currentInspection.id, "passed", accessToken, appUserId, { score: numericScore });
      await updateWorkOrderStatus(caseData.workOrder.id, "qa_complete", accessToken, appUserId);
      await updateOperationalJobStatus(caseData.job.id, "qa_passed", accessToken, appUserId);
      await createWorkOrderEvent({
        organization_id: caseData.job.organization_id,
        business_unit_id: caseData.job.business_unit_id,
        operational_job_id: caseData.job.id,
        work_order_id: caseData.workOrder.id,
        event_type: "qa_passed",
        event_at: new Date().toISOString(),
        actor_app_user_id: appUserId,
        event_payload: { score: numericScore, findings: findings.trim() },
        metadata: { source: "wave4_production_workspace", synthetic: false },
      }, accessToken);
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [currentInspection, caseData, score, findings, accessToken, appUserId, refresh]);

  const failQa = useCallback(async () => {
    if (!currentInspection || !caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      const note = findings.trim();
      if (!note) throw new Error("Findings are required for a failed QA inspection.");
      await updateQaInspectionStatus(currentInspection.id, "failed", accessToken, appUserId, { score: Number(score) || 0 });
      const corrective = await createCorrectiveAction(
        buildCorrectiveActionPayload({
          organizationId: caseData.job.organization_id,
          businessUnitId: caseData.job.business_unit_id,
          operationalJobId: caseData.job.id,
          workOrderId: caseData.workOrder.id,
          qaInspectionId: currentInspection.id,
          actionStatus: "open",
          actionType: "rework",
          description: note,
          resolutionPayload: {},
          metadata: { source: "wave4_production_workspace", synthetic: false },
          appUserId,
        }),
        accessToken
      );
      await updateOperationalJobStatus(caseData.job.id, "corrective_action_required", accessToken, appUserId);
      await createWorkOrderEvent({
        organization_id: caseData.job.organization_id,
        business_unit_id: caseData.job.business_unit_id,
        operational_job_id: caseData.job.id,
        work_order_id: caseData.workOrder.id,
        event_type: "qa_failed",
        event_at: new Date().toISOString(),
        actor_app_user_id: appUserId,
        event_payload: { findings: note, corrective_action_id: corrective.id },
        metadata: { source: "wave4_production_workspace", synthetic: false },
      }, accessToken);
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [currentInspection, caseData, score, findings, accessToken, appUserId, refresh]);

  if (!QA_ENABLED) return null;
  if (role !== "qa") return <section style={styles.panel}>QA access denied.</section>;

  return (
    <section style={styles.panel} data-serviceos-workspace="wave4-qa-production">
      <h2 style={styles.title}>Wave 4 Quality Assurance</h2>
      <p style={styles.copy}>QA-only Production workspace. Finance and Intelligence remain unavailable. Database lifecycle guards remain the final authority.</p>
      <div style={styles.grid}>
        <label style={styles.field}><span style={styles.label}>Operational job ID</span><input style={styles.input} value={jobId} onChange={(e) => setJobId(e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Work order ID</span><input style={styles.input} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>QA score</span><input style={styles.input} value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" /></label>
        <label style={styles.field}><span style={styles.label}>Findings</span><input style={styles.input} value={findings} onChange={(e) => setFindings(e.target.value)} /></label>
      </div>
      <div style={styles.actions}>
        <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={refresh} disabled={busy}>{busy ? "Working…" : "Load / Refresh QA Case"}</button>
        <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={startQa} disabled={busy || !caseData || caseData.job.operational_status !== "qa_pending" || !!currentInspection}>Start QA</button>
        <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={passQa} disabled={busy || !currentInspection}>Pass QA</button>
        <button type="button" style={{ ...styles.button, ...styles.danger }} onClick={failQa} disabled={busy || !currentInspection}>Fail QA + Open Rework</button>
      </div>
      {caseData ? <div style={styles.status}>Job: {caseData.job.operational_status}{"\n"}Work order: {caseData.workOrder.work_order_status}{"\n"}QA inspections: {(caseData.qaInspections ?? []).length}{"\n"}Corrective actions: {(caseData.correctiveActions ?? []).length}</div> : null}
      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
    </section>
  );
}
