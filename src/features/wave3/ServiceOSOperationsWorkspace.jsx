import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedRestFetchWithRefresh } from "../../lib/serviceosAuthClient.js";
import {
  fetchEligibleJobHandoffs,
  fetchActiveWorkers,
  fetchJobHandoffById,
  fetchConversionRecordById,
  fetchServiceLocationById,
  createOperationalJob,
  createScheduleWindow,
  createWorkerAssignment,
  createWorkOrder,
  createWorkOrderEvent,
  createCompletionEvidence,
  createChecklistResult,
  updateOperationalJobStatus,
  updateScheduleWindowStatus,
  updateWorkerAssignmentStatus,
  updateWorkOrderStatus,
} from "../../lib/serviceosOperationsClient.js";
import {
  buildOperationalJobPayload,
  buildScheduleWindowPayload,
  buildWorkerAssignmentPayload,
  buildWorkOrderPayload,
  buildWorkOrderEventPayload,
  buildCompletionEvidencePayload,
  buildChecklistResultPayload,
} from "../../lib/serviceosOperationsUtils.js";

const styles = {
  card: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18, marginTop: 14 },
  title: { margin: "0 0 8px", fontSize: 17 },
  note: { margin: "0 0 12px", color: "#AEBAC9", lineHeight: 1.55, fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 },
  label: { display: "block", color: "#8291A6", fontSize: 12, fontWeight: 800, marginBottom: 5, textTransform: "uppercase" },
  input: { width: "100%", boxSizing: "border-box", borderRadius: 7, border: "1px solid #40516A", background: "#0D1523", color: "#F5F8FC", padding: "9px 10px" },
  button: { border: 0, borderRadius: 8, background: "#00D4AA", color: "#07110F", fontWeight: 850, padding: "10px 14px", cursor: "pointer" },
  secondary: { border: "1px solid #40516A", borderRadius: 8, background: "#1B2638", color: "#F5F8FC", fontWeight: 750, padding: "10px 14px", cursor: "pointer" },
  row: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 },
  ok: { color: "#54E5C2", marginTop: 10, fontSize: 13 },
  error: { color: "#FF7D8A", marginTop: 10, fontSize: 13, whiteSpace: "pre-wrap" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "#9FB2C9", overflowWrap: "anywhere" },
};

async function getJson(path) {
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res?.ok) throw new Error(`Operations read failed: HTTP ${res?.status ?? "network"} ${await res?.text().catch(() => "")}`);
  return res.json();
}

function toIso(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) throw new Error("Enter a valid schedule date/time.");
  return d.toISOString();
}

function OfficeOperations({ revenueContext }) {
  const [handoffs, setHandoffs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [handoffId, setHandoffId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [timezone, setTimezone] = useState("America/Toronto");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const appUserId = revenueContext?.appUserId ?? null;

  const load = useCallback(async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const [nextHandoffs, nextWorkers] = await Promise.all([fetchEligibleJobHandoffs(), fetchActiveWorkers()]);
      setHandoffs(Array.isArray(nextHandoffs) ? nextHandoffs : []);
      setWorkers(Array.isArray(nextWorkers) ? nextWorkers : []);
      if (!handoffId && nextHandoffs?.[0]?.id) setHandoffId(nextHandoffs[0].id);
      if (!workerId && nextWorkers?.[0]?.id) setWorkerId(nextWorkers[0].id);
      setMessage(`Loaded ${nextHandoffs?.length ?? 0} eligible handoff(s) and ${nextWorkers?.length ?? 0} active worker(s).`);
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, workerId]);

  const schedule = useCallback(async () => {
    if (!handoffId || !workerId || !start || !end) { setError("Select a handoff, worker, start, and end time."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const handoff = await fetchJobHandoffById(handoffId);
      if (!handoff) throw new Error("Selected job handoff is no longer available.");
      const conversion = await fetchConversionRecordById(handoff.conversion_record_id);
      if (!conversion) throw new Error("Conversion lineage is unavailable.");
      const location = await fetchServiceLocationById(conversion.service_location_id);
      if (!location?.jurisdiction_id) throw new Error("Service location jurisdiction is unavailable.");
      const metadata = { source: "wave3_production_workspace", synthetic: false };
      const job = await createOperationalJob(buildOperationalJobPayload({
        organizationId: handoff.organization_id,
        businessUnitId: handoff.business_unit_id,
        jurisdictionId: location.jurisdiction_id,
        jobHandoffId: handoff.id,
        conversionRecordId: handoff.conversion_record_id,
        quoteVersionId: handoff.quote_version_id,
        pricingSnapshotId: handoff.pricing_snapshot_id,
        customerId: conversion.customer_id,
        contactId: conversion.contact_id,
        serviceLocationId: conversion.service_location_id,
        serviceFamily: "residential",
        operationalStatus: "ready_to_schedule",
        metadata,
        appUserId,
      }));
      const window = await createScheduleWindow(buildScheduleWindowPayload({
        organizationId: handoff.organization_id,
        businessUnitId: handoff.business_unit_id,
        jurisdictionId: location.jurisdiction_id,
        operationalJobId: job.id,
        scheduledStart: toIso(start),
        scheduledEnd: toIso(end),
        timezone,
        status: "planned",
        metadata,
        appUserId,
      }));
      await updateScheduleWindowStatus(window.id, "confirmed", null, appUserId);
      await updateOperationalJobStatus(job.id, "scheduled", null, appUserId);
      const assignment = await createWorkerAssignment(buildWorkerAssignmentPayload({
        organizationId: handoff.organization_id,
        businessUnitId: handoff.business_unit_id,
        operationalJobId: job.id,
        scheduleWindowId: window.id,
        workerId,
        assignmentRole: "service_worker",
        assignmentStatus: "proposed",
        metadata,
        appUserId,
      }));
      await updateWorkerAssignmentStatus(assignment.id, "assigned", null, appUserId);
      const workOrder = await createWorkOrder(buildWorkOrderPayload({
        organizationId: handoff.organization_id,
        businessUnitId: handoff.business_unit_id,
        jurisdictionId: location.jurisdiction_id,
        operationalJobId: job.id,
        scheduleWindowId: window.id,
        workOrderStatus: "draft",
        pricingReferenceSnapshot: { quote_version_id: handoff.quote_version_id, pricing_snapshot_id: handoff.pricing_snapshot_id },
        metadata,
        appUserId,
      }));
      await updateWorkOrderStatus(workOrder.id, "published", null, appUserId);
      await updateOperationalJobStatus(job.id, "dispatched", null, appUserId);
      setMessage(`DISPATCHED · job ${job.id} · assignment ${assignment.id} · work order ${workOrder.id}. Worker must acknowledge and execute next.`);
      await load();
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, workerId, start, end, timezone, appUserId, load]);

  return <section style={styles.card} data-wave3-office-workspace="true">
    <h2 style={styles.title}>Wave 3 Operations · Office Dispatch</h2>
    <p style={styles.note}>Uses real accepted Revenue handoffs. This Production workspace does not create synthetic data and stops before worker execution and QA.</p>
    <div style={styles.row}><button style={styles.secondary} onClick={load} disabled={busy}>{busy ? "Working…" : "Load eligible work"}</button></div>
    <div style={{...styles.grid, marginTop: 12}}>
      <label><span style={styles.label}>Revenue handoff</span><select style={styles.input} value={handoffId} onChange={e=>setHandoffId(e.target.value)}><option value="">Select…</option>{handoffs.map(h=><option key={h.id} value={h.id}>{h.id}</option>)}</select></label>
      <label><span style={styles.label}>Worker</span><select style={styles.input} value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">Select…</option>{workers.map(w=><option key={w.id} value={w.id}>{w.display_name || w.email || w.id}</option>)}</select></label>
      <label><span style={styles.label}>Start</span><input style={styles.input} type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} /></label>
      <label><span style={styles.label}>End</span><input style={styles.input} type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} /></label>
      <label><span style={styles.label}>Timezone</span><select style={styles.input} value={timezone} onChange={e=>setTimezone(e.target.value)}><option value="America/Toronto">Ontario · America/Toronto</option><option value="America/Phoenix">Arizona · America/Phoenix</option></select></label>
    </div>
    <div style={styles.row}><button style={styles.button} onClick={schedule} disabled={busy}>Schedule & Dispatch</button></div>
    {message ? <div style={styles.ok}>{message}</div> : null}{error ? <div style={styles.error}>{error}</div> : null}
  </section>;
}

function WorkerOperations({ revenueContext }) {
  const [worker, setWorker] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const appUserId = revenueContext?.appUserId ?? null;

  const selected = useMemo(()=>assignments.find(a=>a.id===selectedId) ?? null,[assignments,selectedId]);

  const load = useCallback(async () => {
    if (!appUserId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const rows = await getJson(`worker?app_user_id=eq.${encodeURIComponent(appUserId)}&status=eq.active&limit=1`);
      const w = Array.isArray(rows) ? rows[0] : null;
      if (!w) throw new Error("No active canonical worker profile is linked to this user.");
      setWorker(w);
      const a = await getJson(`worker_assignment?worker_id=eq.${encodeURIComponent(w.id)}&assignment_status=in.(assigned,acknowledged)&order=created_at.desc&limit=20`);
      setAssignments(Array.isArray(a) ? a : []);
      if (!selectedId && a?.[0]?.id) setSelectedId(a[0].id);
      setMessage(`Loaded ${a?.length ?? 0} active assignment(s).`);
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [appUserId, selectedId]);

  useEffect(()=>{ load(); }, []); // intentional first-load only

  async function resolveWork() {
    if (!selected || !worker) throw new Error("Select an assignment first.");
    const jobs = await getJson(`operational_job?id=eq.${encodeURIComponent(selected.operational_job_id)}&limit=1`);
    const job = jobs?.[0];
    if (!job) throw new Error("Assigned operational job is unavailable.");
    const orders = await getJson(`work_order?operational_job_id=eq.${encodeURIComponent(job.id)}&limit=1`);
    const workOrder = orders?.[0];
    if (!workOrder) throw new Error("Assigned work order is unavailable.");
    return { job, workOrder };
  }

  const acknowledge = async () => {
    setBusy(true); setError(""); setMessage("");
    try { await updateWorkerAssignmentStatus(selected.id, "acknowledged", null, appUserId); setMessage("Assignment acknowledged."); await load(); }
    catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  const startWork = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const { job, workOrder } = await resolveWork();
      if (selected.assignment_status !== "acknowledged") throw new Error("Acknowledge the assignment before starting work.");
      await createWorkOrderEvent(buildWorkOrderEventPayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,workerAssignmentId:selected.id,eventType:"arrived",actorAppUserId:appUserId,actorWorkerId:worker.id,metadata:{source:"wave3_production_workspace"}}));
      await createWorkOrderEvent(buildWorkOrderEventPayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,workerAssignmentId:selected.id,eventType:"work_started",actorAppUserId:appUserId,actorWorkerId:worker.id,metadata:{source:"wave3_production_workspace"}}));
      await updateWorkOrderStatus(workOrder.id,"in_progress",null,appUserId);
      await updateOperationalJobStatus(job.id,"in_progress",null,appUserId);
      setMessage("Work started. Operations is now in progress.");
    } catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  const completeWork = async () => {
    if (!note.trim()) { setError("Enter a completion note before submitting to QA."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const { job, workOrder } = await resolveWork();
      await createCompletionEvidence(buildCompletionEvidencePayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,workerAssignmentId:selected.id,evidenceType:"note",evidencePayload:{note:note.trim()},capturedAt:new Date().toISOString(),capturedByWorkerId:worker.id,capturedByAppUserId:appUserId,metadata:{source:"wave3_production_workspace"}}));
      await createChecklistResult(buildChecklistResultPayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,checklistItemKey:"worker_completion_confirmation",checklistItemLabel:"Worker completion confirmation",resultStatus:"pass",resultPayload:{note:note.trim()},completedByWorkerId:worker.id,completedByAppUserId:appUserId,completedAt:new Date().toISOString(),metadata:{source:"wave3_production_workspace"}}));
      await createWorkOrderEvent(buildWorkOrderEventPayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,workerAssignmentId:selected.id,eventType:"work_completed",actorAppUserId:appUserId,actorWorkerId:worker.id,metadata:{source:"wave3_production_workspace"}}));
      await createWorkOrderEvent(buildWorkOrderEventPayload({organizationId:job.organization_id,businessUnitId:job.business_unit_id,operationalJobId:job.id,workOrderId:workOrder.id,workerAssignmentId:selected.id,eventType:"completion_submitted",actorAppUserId:appUserId,actorWorkerId:worker.id,metadata:{source:"wave3_production_workspace"}}));
      await updateWorkOrderStatus(workOrder.id,"service_complete",null,appUserId);
      await updateOperationalJobStatus(job.id,"service_complete",null,appUserId);
      await updateOperationalJobStatus(job.id,"qa_pending",null,appUserId);
      setMessage("Service completion submitted. Wave 3 is complete for this job; status is QA PENDING. Wave 4 must perform QA.");
      setNote(""); await load();
    } catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  return <section style={styles.card} data-wave3-worker-workspace="true">
    <h2 style={styles.title}>Wave 3 Operations · Worker Execution</h2>
    <p style={styles.note}>Worker actions are limited to assigned jobs. Completion stops at <strong>QA PENDING</strong>; this workspace cannot create, pass, fail, or waive QA inspections.</p>
    <div style={styles.row}><button style={styles.secondary} onClick={load} disabled={busy}>Refresh assignments</button></div>
    <label style={{display:"block",marginTop:12}}><span style={styles.label}>Assignment</span><select style={styles.input} value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">Select…</option>{assignments.map(a=><option key={a.id} value={a.id}>{a.id} · {a.assignment_status}</option>)}</select></label>
    {selected ? <div style={{...styles.mono,marginTop:8}}>Operational job: {selected.operational_job_id}</div> : null}
    <div style={styles.row}><button style={styles.secondary} onClick={acknowledge} disabled={busy||!selected}>Acknowledge</button><button style={styles.button} onClick={startWork} disabled={busy||!selected}>Start Work</button></div>
    <label style={{display:"block",marginTop:12}}><span style={styles.label}>Completion note</span><textarea style={{...styles.input,minHeight:90}} value={note} onChange={e=>setNote(e.target.value)} placeholder="Describe completed service and evidence." /></label>
    <div style={styles.row}><button style={styles.button} onClick={completeWork} disabled={busy||!selected}>Submit Completion to QA</button></div>
    {message ? <div style={styles.ok}>{message}</div> : null}{error ? <div style={styles.error}>{error}</div> : null}
  </section>;
}

export default function ServiceOSOperationsWorkspace({ revenueContext }) {
  const role = revenueContext?.roleCode ?? "unknown";
  if (role === "worker") return <WorkerOperations revenueContext={revenueContext} />;
  if (role === "owner_admin" || role === "office_ops") return <OfficeOperations revenueContext={revenueContext} />;
  return null;
}
