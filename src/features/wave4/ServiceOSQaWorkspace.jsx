import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCorrectiveAction,
  createQaInspection,
  createWorkOrderEvent,
  fetchCorrectiveActionsForJob,
  fetchCompletionEvidenceForJob,
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
import { authenticatedRestFetchWithRefresh } from "../../lib/serviceosAuthClient.js";
import { getSupabaseConfig } from "../../lib/supabaseConfig.js";
import { invalidateServiceOSFinancials } from "../../lib/serviceosFinancialPerformance.js";

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
  queue: { display: "grid", gap: 10, marginTop: 16 },
  queueButton: { width: "100%", display: "grid", gridTemplateColumns: "minmax(170px,1.2fr) minmax(220px,2fr) minmax(150px,1fr) auto", gap: 12, alignItems: "center", textAlign: "left", border: "1px solid #344359", borderRadius: 12, background: "#0D1422", color: "#F5F8FC", padding: 14, cursor: "pointer" },
  selectedQueueButton: { borderColor: "#00D4AA", boxShadow: "0 0 0 2px rgba(0,212,170,.18)" },
  meta: { display: "block", color: "#AEBAC9", fontSize: 13, marginTop: 4 },
  badge: { display: "inline-flex", alignItems: "center", minHeight: 28, borderRadius: 999, padding: "4px 9px", background: "#26364B", color: "#E9F2FC", fontSize: 12, fontWeight: 800 },
  empty: { marginTop: 16, padding: 20, border: "1px dashed #344359", borderRadius: 12, color: "#AEBAC9", textAlign: "center" },
};

function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "Date unavailable"; }
function formatDuration(minutes) { if (!Number.isFinite(Number(minutes))) return "Duration unavailable"; const total=Number(minutes); return `${Math.floor(total/60)}h ${total%60}m`; }

export default function ServiceOSQaWorkspace({ session, revenueContext }) {
  const role = revenueContext?.roleCode ?? "unknown";
  const accessToken = session?.access_token ?? null;
  const appUserId = revenueContext?.appUserId ?? null;
  const organizationId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const businessUnitCode = revenueContext?.activeBusinessUnitCode ?? "Active market";
  const [queue, setQueue] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [score, setScore] = useState("100");
  const [findings, setFindings] = useState("QA review completed; no deficiencies found.");
  const [caseData, setCaseData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [finalizationSummary, setFinalizationSummary] = useState(null);

  const currentInspection = useMemo(() => {
    const rows = caseData?.qaInspections ?? [];
    return [...rows].reverse().find((row) => ["pending", "in_progress"].includes(row.inspection_status)) ?? null;
  }, [caseData]);

  const passedInspection = useMemo(() => {
    const rows = caseData?.qaInspections ?? [];
    return [...rows].reverse().find((row) => row.inspection_status === "passed") ?? null;
  }, [caseData]);

  const recoverablePassedInspection = useMemo(() => {
    if (!passedInspection || !caseData?.job || !caseData?.workOrder) return null;
    if (caseData.job.operational_status !== "qa_pending") return null;
    if (caseData.workOrder.work_order_status !== "service_complete") return null;
    return passedInspection;
  }, [passedInspection, caseData]);

  const passInspection = currentInspection ?? recoverablePassedInspection;

  const loadQueue = useCallback(async () => {
    if (!organizationId || !businessUnitId) return;
    setBusy(true); setError("");
    try {
      const response = await authenticatedRestFetchWithRefresh("rpc/get_qa_review_queue", { method:"POST", body:JSON.stringify({p_organization_id:organizationId,p_business_unit_id:businessUnitId,p_limit:100}) });
      const payload = await response?.json().catch(()=>null);
      if (!response?.ok) throw new Error(payload?.message || payload?.error || "Unable to load the QA review queue.");
      setQueue(Array.isArray(payload) ? payload : []);
    } catch (err) { setQueue([]); setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  }, [organizationId,businessUnitId]);

  const refresh = useCallback(async (target = selectedCase) => {
    setError("");
    if (!target?.operational_job_id || !target?.work_order_id) return;
    setBusy(true);
    try {
      const job = await fetchOperationalJobById(target.operational_job_id, accessToken);
      const workOrder = await fetchWorkOrderForJob(target.operational_job_id, accessToken);
      if (!job) throw new Error("Operational job not found or not visible to this QA role.");
      if (!workOrder || workOrder.id !== target.work_order_id) throw new Error("Work order does not match the selected operational job.");
      if (!["qa_pending", "qa_passed", "corrective_action_required"].includes(job.operational_status)) {
        throw new Error(`Job is not in a QA-stage status: ${job.operational_status}`);
      }
      const [qaInspections, correctiveActions, completionEvidence] = await Promise.all([
        fetchQaInspectionsForJob(job.id, accessToken),
        fetchCorrectiveActionsForJob(job.id, accessToken),
        fetchCompletionEvidenceForJob(job.id, accessToken),
      ]);
      setCaseData({ job, workOrder, qaInspections, correctiveActions, completionEvidence });
    } catch (err) {
      setCaseData(null);
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedCase, accessToken]);

  const selectCase = useCallback(async (row) => { setSelectedCase(row); setCaseData(null); await refresh(row); }, [refresh]);
  useEffect(() => { setSelectedCase(null); setCaseData(null); loadQueue(); }, [loadQueue]);
  useEffect(() => { const onFocus=()=>loadQueue(); window.addEventListener("focus",onFocus); return()=>window.removeEventListener("focus",onFocus); }, [loadQueue]);

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
    if (!passInspection || !caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      const numericScore = passInspection.inspection_status === "passed"
        ? Number(passInspection.score ?? score)
        : Number(score);
      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) throw new Error("QA score must be between 0 and 100.");

      if (passInspection.inspection_status !== "passed") {
        await updateQaInspectionStatus(passInspection.id, "passed", accessToken, appUserId, { score: numericScore });
      }
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
        event_payload: {
          score: numericScore,
          findings: findings.trim(),
          resumed_after_partial_failure: passInspection.inspection_status === "passed",
        },
        metadata: { source: "wave4_production_workspace", synthetic: false },
      }, accessToken);
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [passInspection, caseData, score, findings, accessToken, appUserId, refresh]);

  const finalizeQa = useCallback(async (outcome) => {
    if (!caseData?.job || !caseData?.workOrder) return;
    const reason = waiverReason.trim();
    if (outcome === "waived" && !reason) {
      setError("A governed waiver reason is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let inspection = currentInspection;
      if (!inspection) {
        inspection = await createQaInspection(buildQaInspectionPayload({
          organizationId:caseData.job.organization_id,businessUnitId:caseData.job.business_unit_id,
          operationalJobId:caseData.job.id,workOrderId:caseData.workOrder.id,inspectorAppUserId:appUserId,
          inspectionStatus:"pending",inspectionType:"standard",findings:{},metadata:{source:"wave4_governed_queue",synthetic:false},
        }),accessToken);
        inspection = await updateQaInspectionStatus(inspection.id,"in_progress",accessToken,appUserId);
      }
      const result = await authenticatedRestFetchWithRefresh("rpc/staff_finalize_qa_inspection", {
        method: "POST",
        body: JSON.stringify({
          p_qa_inspection_id: inspection.id,
          p_outcome: outcome,
          p_score: outcome === "passed" ? Number(score) : null,
          p_findings: findings.trim() || null,
          p_waiver_reason: outcome === "waived" ? reason : null,
        }),
      }).then(async (response) => {
        const text = await response?.text().catch(() => "");
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
        if (!response?.ok) throw new Error(`QA finalization failed: ${text}`);
        return Array.isArray(payload) ? payload[0] : payload;
      });
      setFinalizationSummary(result?.financial_summary ?? null);
      invalidateServiceOSFinancials({ businessUnitId: caseData.job.business_unit_id, operationalJobId: caseData.job.id, source: "qa_finalization" });
      await loadQueue();
      setSelectedCase(null);
      setCaseData(null);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [currentInspection, caseData, score, findings, waiverReason, loadQueue, appUserId, accessToken]);

  const openEvidence = useCallback(async (row) => {
    if (!row?.storage_reference) return;
    try {
      const { url, anon } = getSupabaseConfig(import.meta.env);
      const path = row.storage_reference.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`${url}/storage/v1/object/authenticated/serviceos-completion-evidence/${path}`, {
        headers: { apikey: anon, Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Completion photo is not available to this reviewer.");
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [accessToken]);

  const failQa = useCallback(async () => {
    if (!caseData?.job || !caseData?.workOrder) return;
    setBusy(true);
    setError("");
    try {
      const note = findings.trim();
      if (!note) throw new Error("Findings are required for a failed QA inspection.");
      let inspection = currentInspection;
      if (!inspection) {
        inspection = await createQaInspection(buildQaInspectionPayload({
          organizationId:caseData.job.organization_id,businessUnitId:caseData.job.business_unit_id,
          operationalJobId:caseData.job.id,workOrderId:caseData.workOrder.id,inspectorAppUserId:appUserId,
          inspectionStatus:"pending",inspectionType:"standard",findings:{},metadata:{source:"wave4_governed_queue",synthetic:false},
        }),accessToken);
        inspection = await updateQaInspectionStatus(inspection.id,"in_progress",accessToken,appUserId);
      }
      await updateQaInspectionStatus(inspection.id, "failed", accessToken, appUserId, { score: Number(score) || 0 });
      const corrective = await createCorrectiveAction(
        buildCorrectiveActionPayload({
          organizationId: caseData.job.organization_id,
          businessUnitId: caseData.job.business_unit_id,
          operationalJobId: caseData.job.id,
          workOrderId: caseData.workOrder.id,
          qaInspectionId: inspection.id,
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
  if (!["qa", "owner_admin", "office_ops"].includes(role)) return <section style={styles.panel}>QA access denied.</section>;

  return (
    <section style={styles.panel} data-serviceos-workspace="wave4-qa-production">
      <h2 style={styles.title}>Wave 4 Quality Assurance</h2>
      <p style={styles.copy}>Review completed jobs for {businessUnitCode}. Select a customer to load the governed QA case; database lifecycle guards remain the final authority.</p>
      <div style={styles.actions}><button type="button" style={{...styles.button,...styles.secondary}} onClick={loadQueue} disabled={busy}>{busy ? "Refreshing…" : `Refresh ${businessUnitCode}`}</button></div>
      <div style={styles.queue} role="list" aria-label={`${businessUnitCode} jobs pending QA`}>
        {queue.map((row)=><button className="qa-review-queue__item" key={row.operational_job_id} type="button" role="listitem" style={{...styles.queueButton,...(selectedCase?.operational_job_id===row.operational_job_id?styles.selectedQueueButton:{})}} onClick={()=>selectCase(row)} disabled={busy}>
          <span><strong>{row.customer_name}</strong><span style={styles.meta}>{row.cleaner_names}</span></span>
          <span><strong>{row.service_address || "Address unavailable"}</strong><span style={styles.meta}>{row.service_tier}</span></span>
          <span><strong>{formatDate(row.service_date || row.service_completed_at)}</strong><span style={styles.meta}>{formatDuration(row.elapsed_minutes)}</span></span>
          <span style={styles.badge}>{row.photo_count} photo{row.photo_count===1?"":"s"}</span>
        </button>)}
      </div>
      {!busy && queue.length===0 ? <div style={styles.empty}>No jobs are waiting for QA in {businessUnitCode}.</div> : null}
      {selectedCase ? <div style={styles.grid}>
        <label style={styles.field}><span style={styles.label}>QA score</span><input style={styles.input} value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" /></label>
        <label style={styles.field}><span style={styles.label}>Findings</span><input style={styles.input} value={findings} onChange={(e) => setFindings(e.target.value)} /></label>
        <label style={styles.field}><span style={styles.label}>Waiver reason</span><input style={styles.input} value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} placeholder="Required only when waiving QA" /></label>
      </div> : null}
      <div style={styles.actions}>
        <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={() => recoverablePassedInspection ? passQa() : finalizeQa("passed")} disabled={busy || !caseData}>{recoverablePassedInspection ? "Finalize Passed QA" : "Pass QA"}</button>
        <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => finalizeQa("waived")} disabled={busy || !caseData || !waiverReason.trim()}>Waive QA</button>
        <button type="button" style={{ ...styles.button, ...styles.danger }} onClick={failQa} disabled={busy || !caseData}>Fail QA + Open Rework</button>
      </div>
      {recoverablePassedInspection ? <div style={styles.status}>Recovery detected: QA inspection already passed. Finalize the governed work-order/job transition and audit event.</div> : null}
      {finalizationSummary ? <div style={styles.status}><strong>Financial close complete</strong>{"\n"}Revenue recognized: {new Intl.NumberFormat("en",{style:"currency",currency:finalizationSummary.currency_code}).format(Number(finalizationSummary.recognized_revenue_amount))}{"\n"}Cleaner labor accrued: {new Intl.NumberFormat("en",{style:"currency",currency:finalizationSummary.currency_code}).format(Number(finalizationSummary.direct_labor_cost))}{"\n"}Net contribution: {new Intl.NumberFormat("en",{style:"currency",currency:finalizationSummary.currency_code}).format(Number(finalizationSummary.net_contribution))}{"\n"}Payroll status: Pending</div> : null}
      {caseData?.completionEvidence?.filter((row) => row.storage_reference).length ? <div style={styles.status}><strong>Completion photos</strong>{caseData.completionEvidence.filter((row) => row.storage_reference).map((row, index) => <div key={row.id} style={{marginTop:8}}><button type="button" style={{...styles.button,...styles.secondary}} onClick={() => openEvidence(row)}>Open photo {index + 1}</button> <span>{row.evidence_type.replaceAll("_", " ")}</span></div>)}</div> : null}
      {caseData ? <div style={styles.status}>Job: {caseData.job.operational_status}{"\n"}Work order: {caseData.workOrder.work_order_status}{"\n"}QA inspections: {(caseData.qaInspections ?? []).length}{"\n"}Corrective actions: {(caseData.correctiveActions ?? []).length}</div> : null}
      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
    </section>
  );
}
