import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedRestFetchWithRefresh, getValidAccessToken } from "../../lib/serviceosAuthClient.js";
import {
  fetchEligibleJobHandoffs,
  fetchActiveWorkers,
  fetchJobHandoffById,
  fetchConversionRecordById,
  fetchServiceLocationById,
  fetchPricingSnapshotById,
  fetchServiceDefinitionVersionByConfigurationVersion,
  fetchRequiredEvidencePoliciesByConfigurationVersion,
  createOperationalJob,
  createScheduleWindow,
  createWorkerAssignment,
  createWorkOrder,
  updateOperationalJobStatus,
  updateScheduleWindowStatus,
  updateWorkerAssignmentStatus,
  updateWorkOrderStatus,
} from "../../lib/serviceosOperationsClient.js";
import { materializeWave4Governance } from "../../lib/serviceosWave4Runtime.js";
import { evaluateDispatchConstraints, flattenChecklistItems, normalizeEvidenceContract, validateServiceDefinitionVersion } from "../../core/serviceDefinitions/serviceDefinitionContract.js";
import {
  buildOperationalJobPayload,
  buildScheduleWindowPayload,
  buildWorkerAssignmentPayload,
  buildWorkOrderPayload,
} from "../../lib/serviceosOperationsUtils.js";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import CleanerExecutionPlaybook from "./CleanerExecutionPlaybook.jsx";
import { invalidateServiceOSWorkspace, SERVICEOS_WORKSPACE_INVALIDATED_EVENT, serviceOSInvalidationMatches } from "../../lib/serviceosFinancialPerformance.js";
import { enrichHandoffForDispatch, fetchActiveDispatchPipeline } from "../../lib/serviceosDispatchReadModel.js";
import { mobileEvidenceEntry, persistMobileEvidenceEntry } from "../../lib/serviceosMobileEvidence.js";
import { EarnedPayoutBanner, ResilientEvidenceUploader, TechnicianExecutionCard } from "./TechnicianExecutionCard.jsx";

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
  pipeline: { marginTop: 14, padding: 14, border: "1px solid #31425A", borderRadius: 10, background: "#101827" },
  pipelineRow: { display: "grid", gridTemplateColumns: "minmax(260px,1.7fr) minmax(110px,.6fr) minmax(180px,1fr)", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid #253449", fontSize: 13 },
  badge: { display: "inline-flex", width: "fit-content", padding: "4px 8px", borderRadius: 999, background: "#20304A", color: "#BFD4F2", fontSize: 11, fontWeight: 850, textTransform: "uppercase" },
  badgeReady: { background: "#173A33", color: "#60E7C6" },
  badgeDispatched: { background: "#1F3358", color: "#AFCBFF" },
  badgeCompleted: { background: "#3A3120", color: "#FFD78A" },
  badgeCorrection: { background: "#461C25", color: "#FF9EAA" },
  laborMeta: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
  laborBadge: { display: "inline-flex", alignItems: "center", padding: "3px 7px", borderRadius: 999, border: "1px solid #34465F", color: "#B8C7D9", fontSize: 11, fontWeight: 750 },
  scheduleCard: { marginTop: 12, padding: "10px 12px", borderRadius: 9, border: "1px solid #2D4551", background: "#102329", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" },
  autoTag: { marginLeft: 6, padding: "2px 6px", borderRadius: 999, background: "#173A33", color: "#60E7C6", fontSize: 9, fontWeight: 900, letterSpacing: ".04em" },
  detailCard: { marginTop: 14, padding: 14, borderRadius: 10, border: "1px solid #31425A", background: "#101827" },
  detailRow: { display: "grid", gridTemplateColumns: "minmax(110px,.5fr) minmax(180px,1.5fr)", gap: 10, padding: "5px 0", alignItems: "start" },
};

async function getJson(path) {
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res?.ok) throw new Error(`Operations read failed: HTTP ${res?.status ?? "network"} ${await res?.text().catch(() => "")}`);
  return res.json();
}

async function postJson(path, payload, fallback) {
  const res = await authenticatedRestFetchWithRefresh(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res?.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res?.ok) throw new Error(data?.message || data?.error || data?.hint || `${fallback}: HTTP ${res?.status ?? "network"}`);
  return data;
}

async function postWorkerDispatchNotification(assignmentId, workOrderId) {
  const accessToken = await getValidAccessToken();
  const response = await fetch("/api/notifications?action=worker-dispatch", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId, workOrderId }),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || "Worker notification response was unreadable" }; }
  return { ok: response.ok, status: response.status, ...data };
}

async function postJobCompletion(assignmentId, completionNote) {
  const accessToken = await getValidAccessToken();
  const response = await fetch("/api/notifications?action=job-completion", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId, completionNote }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data?.completion) throw new Error(data?.error || "Job completion could not be submitted");
  return data;
}

async function acknowledgeWorkerNotificationDelivery(workerAssignmentId) {
  const response = await authenticatedRestFetchWithRefresh(
    `worker_notification_delivery?worker_assignment_id=eq.${encodeURIComponent(workerAssignmentId)}&delivery_status=in.(requested,sent,delivered)`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ delivery_status: "acknowledged", acknowledged_at: new Date().toISOString() }),
    }
  );
  if (!response?.ok) throw new Error(`Notification acknowledgement audit failed: HTTP ${response?.status ?? "network"}`);
}

function toIso(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) throw new Error("Enter a valid schedule date/time.");
  return d.toISOString();
}

function handoffIdSnippet(id) {
  return id ? `${String(id).slice(0, 8)}...` : "unknown";
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMoney(value, currency) {
  if (value == null || !currency) return "Not available";
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", { style: "currency", currency }).format(Number(value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}


function addHoursToLocalDateTime(localValue, hours) {
  if (!localValue || !Number.isFinite(Number(hours)) || Number(hours) <= 0) return "";
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setMinutes(parsed.getMinutes() + Math.round(Number(hours) * 60));
  return formatLocalDateTime(parsed);
}


function pipelineStatusLabel(status) {
  if (status === "ready_to_schedule" || status === "scheduled") return "Ready for Dispatch";
  if (status === "dispatched" || status === "in_progress") return "Dispatched";
  if (status === "service_complete" || status === "qa_pending") return "Completed";
  if (status === "corrective_action_required") return "Correction Required";
  return String(status || "Unknown").replaceAll("_", " ");
}

function pipelineStatusStyle(status) {
  if (status === "ready_to_schedule" || status === "scheduled") return styles.badgeReady;
  if (status === "dispatched" || status === "in_progress") return styles.badgeDispatched;
  if (status === "service_complete" || status === "qa_pending") return styles.badgeCompleted;
  if (status === "corrective_action_required") return styles.badgeCorrection;
  return {};
}

function timezoneForScope(scope, location) {
  const code = scope?.businessUnitCode || scope?.business_unit_code || "";
  const subdivision = String(location?.subdivision || "").toUpperCase();
  return code === "HUC-AZ" || subdivision === "AZ" ? "America/Phoenix" : "America/Toronto";
}

function OfficeOperations({ revenueContext }) {
  const [handoffs, setHandoffs] = useState([]);
  const [pipelineJobs, setPipelineJobs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [handoffId, setHandoffId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [endAutoCalculated, setEndAutoCalculated] = useState(false);
  const [timezone, setTimezone] = useState("America/Toronto");
  const [scheduleHint, setScheduleHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const appUserId = revenueContext?.appUserId ?? null;
  const selectedHandoff = useMemo(() => handoffs.find((handoff) => handoff.id === handoffId) ?? null, [handoffs, handoffId]);
  const filteredHandoffs = useMemo(() => {
    const query = pipelineSearch.trim().toLowerCase();
    return handoffs.filter((handoff) => !query || String(handoff.dispatch_label || "").toLowerCase().includes(query));
  }, [handoffs, pipelineSearch]);
  const filteredPipelineJobs = useMemo(() => {
    const query = pipelineSearch.trim().toLowerCase();
    return pipelineJobs.filter((job) => {
      const matchesQuery = !query || String(job.dispatch_label || "").toLowerCase().includes(query);
      const scheduledStart = String(job.schedule_window?.scheduled_start || "");
      return matchesQuery && (!scheduleDate || scheduledStart.startsWith(scheduleDate));
    });
  }, [pipelineJobs, pipelineSearch, scheduleDate]);

  const applyScheduleSuggestion = useCallback((handoff) => {
    if (!handoff) { setStart(""); setEnd(""); setEndAutoCalculated(false); setScheduleHint(""); return; }
    const requested = handoff.requested_start_local || "";
    const duration = handoff.estimated_duration_hours;
    const requestedDate = requested ? new Date(requested) : null;
    const isPast = requestedDate && !Number.isNaN(requestedDate.getTime()) && requestedDate.getTime() < Date.now();
    setTimezone(handoff.suggested_timezone || "America/Toronto");
    if (requested && !isPast) {
      setStart(requested);
      setEnd(duration ? addHoursToLocalDateTime(requested, duration) : "");
      setEndAutoCalculated(Boolean(duration));
      setScheduleHint(duration
        ? `Requested ${handoff.requested_date || "date"} · ${handoff.requested_window || "time"}. Estimated duration ${duration}h from accepted quote/intake data.`
        : `Requested ${handoff.requested_date || "date"} · ${handoff.requested_window || "time"}. No canonical service duration was captured; enter End manually.`);
    } else {
      setStart(""); setEnd(""); setEndAutoCalculated(false);
      setScheduleHint(requested
        ? `Customer requested ${handoff.requested_date || "date"} · ${handoff.requested_window || "time"}, but that target is in the past. Choose a new Start/End.`
        : "No parseable requested date/time was captured on this accepted handoff. Enter Start/End manually.");
    }
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const [rawHandoffs, nextWorkers, activePipeline] = await Promise.all([fetchEligibleJobHandoffs(), fetchActiveWorkers(), fetchActiveDispatchPipeline()]);
      const eligibleHandoffs = Array.isArray(rawHandoffs) ? rawHandoffs : [];
      const nextHandoffs = await Promise.all(eligibleHandoffs.map(async (handoff) => {
        try { return await enrichHandoffForDispatch(handoff); }
        catch { return { ...handoff, dispatch_label: `Customer details unavailable — Service details unavailable — Location unavailable (${handoffIdSnippet(handoff?.id)})` }; }
      }));
      setHandoffs(nextHandoffs);
      setPipelineJobs(Array.isArray(activePipeline) ? activePipeline : []);
      setWorkers(Array.isArray(nextWorkers) ? nextWorkers : []);
      if (!handoffId && nextHandoffs?.[0]?.id) {
        setHandoffId(nextHandoffs[0].id);
        applyScheduleSuggestion(nextHandoffs[0]);
      }
      setMessage(`Dispatch pipeline refreshed · ${nextHandoffs?.length ?? 0} ready · ${activePipeline?.length ?? 0} active job(s).`);
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, applyScheduleSuggestion]);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const refresh = (event) => { if (serviceOSInvalidationMatches(event, revenueContext?.primaryBusinessUnitId)) load(); };
    window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
    return () => window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
  }, [load, revenueContext?.primaryBusinessUnitId]);

  const selectHandoff = useCallback((id) => {
    setHandoffId(id);
    applyScheduleSuggestion(handoffs.find((handoff) => handoff.id === id) || null);
  }, [handoffs, applyScheduleSuggestion]);

  useEffect(() => {
    const openDispatch = (event) => {
      const id = event?.detail?.handoffId;
      if (!id || !handoffs.some((handoff) => handoff.id === id)) return;
      selectHandoff(id);
      document.getElementById("operations-dispatch")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("serviceos:open-dispatch", openDispatch);
    return () => window.removeEventListener("serviceos:open-dispatch", openDispatch);
  }, [handoffs, selectHandoff]);

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
      const pricingSnapshot = await fetchPricingSnapshotById(handoff.pricing_snapshot_id);
      if (!pricingSnapshot?.configuration_version_id) throw new Error("Accepted pricing snapshot has no configuration authority.");
      const definition = validateServiceDefinitionVersion(await fetchServiceDefinitionVersionByConfigurationVersion(pricingSnapshot.configuration_version_id));
      const selectedWorker = workers.find((worker) => worker.id === workerId);
      if (!selectedWorker) throw new Error("Selected worker is no longer active.");
      const declaredCapabilities = Array.isArray(selectedWorker.metadata?.capabilities) ? selectedWorker.metadata.capabilities : [];
      const compatibilityCapabilities = definition.service_key === "residential_cleaning"
        ? [...new Set([...declaredCapabilities, "residential_cleaning"])]
        : declaredCapabilities;
      const dispatchEvaluation = evaluateDispatchConstraints(
        definition.dispatch_contract,
        {
          capabilities: compatibilityCapabilities,
          equipment: Array.isArray(selectedWorker.metadata?.equipment) ? selectedWorker.metadata.equipment : [],
        },
        Number(selectedHandoff?.crew_size || 1)
      );
      if (!dispatchEvaluation.eligible) {
        throw new Error(`Selected worker does not satisfy this service definition: ${[
          ...dispatchEvaluation.missing_capabilities,
          ...dispatchEvaluation.missing_equipment,
        ].join(", ") || "crew size constraint"}`);
      }
      const sourcePolicyRows = await fetchRequiredEvidencePoliciesByConfigurationVersion(pricingSnapshot.configuration_version_id);
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
        serviceFamily: definition.service_key || "residential_cleaning",
        operationalStatus: "ready_to_schedule",
        serviceScopeSnapshot: { ...selectedHandoff?.cascade?.scope, service_definition_version_id: definition.id },
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
        scopeSnapshot: { ...selectedHandoff?.cascade?.scope, service_definition_version_id: definition.id, measurement_contract: definition.measurement_contract },
        customerInstructionSnapshot: selectedHandoff?.cascade?.customerInstructions,
        accessInstructionSnapshot: selectedHandoff?.cascade?.accessInstructions,
        checklistTemplateSnapshot: definition.checklist_contract,
        pricingReferenceSnapshot: { quote_version_id: handoff.quote_version_id, ...selectedHandoff?.cascade?.pricing },
        metadata,
        appUserId,
      }));
      await materializeWave4Governance({
        organizationId: handoff.organization_id,
        businessUnitId: handoff.business_unit_id,
        jurisdictionId: location.jurisdiction_id,
        operationalJobId: job.id,
        workOrderId: workOrder.id,
        configurationVersionId: pricingSnapshot.configuration_version_id,
        checklistVersionReference: `${definition.service_definition_id}:${definition.id}`,
        taskDefinitionReference: definition.id,
        sopReferenceSnapshot: [],
        governanceSnapshot: {
          service_definition_id: definition.service_definition_id,
          service_definition_version_id: definition.id,
          measurement_contract: definition.measurement_contract,
          duration_contract: definition.duration_contract,
          dispatch_contract: definition.dispatch_contract,
          checklist_contract: definition.checklist_contract,
          qa_evidence_contract: definition.qa_evidence_contract,
        },
        sourcePolicyRows,
        appUserId,
      });
      await updateWorkOrderStatus(workOrder.id, "published", null, appUserId);
      await updateOperationalJobStatus(job.id, "dispatched", null, appUserId);
      let notificationSummary = "notification audit unavailable";
      try {
        const notification = await postWorkerDispatchNotification(assignment.id, workOrder.id);
        const channelStates = Array.isArray(notification.results)
          ? notification.results.map((item) => `${item.channel}:${item.delivery?.delivery_status || (item.error ? "failed" : "unknown")}`).join(", ")
          : (notification.error || `HTTP ${notification.status}`);
        notificationSummary = `worker notification ${channelStates}`;
      } catch (notificationError) {
        notificationSummary = `worker notification request error: ${notificationError?.message || String(notificationError)}`;
      }
      setMessage(`DISPATCHED · job ${job.id} · assignment ${assignment.id} · work order ${workOrder.id} · ${notificationSummary}. Worker must acknowledge and execute next.`);
      setHandoffId(""); setStart(""); setEnd(""); setEndAutoCalculated(false); setScheduleHint("");
      await load();
      invalidateServiceOSWorkspace({ businessUnitId: handoff.business_unit_id, operationalJobId: job.id, affectedDomains: ["operations"] });
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, workerId, start, end, timezone, appUserId, load, selectedHandoff, workers]);

  return <section id="operations-dispatch" style={styles.card} data-wave3-office-workspace="true" className="admin-workspace-card">
    <div className="admin-section-heading"><div><p className="admin-eyebrow">Operations &amp; Dispatch</p><h2 style={styles.title}>Dispatch schedule and work orders</h2></div><StatusBadge tone="info">{revenueContext?.activeBusinessUnitCode || "HUC"}</StatusBadge></div>
    <p style={styles.note}>Uses canonical accepted Revenue handoffs and Operations records. Ready work and active jobs load automatically; Refresh updates the live pipeline.</p>

    <div style={styles.pipeline} data-wave3-dispatch-pipeline="true">
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <strong>Dispatch Pipeline</strong>
        <button style={styles.secondary} onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh pipeline"}</button>
      </div>
      <div className="admin-filter-bar admin-filter-bar--dark" aria-label="Dispatch filters">
        <label className="admin-search-field"><span>Search work</span><input type="search" value={pipelineSearch} onChange={(event) => setPipelineSearch(event.target.value)} placeholder="Customer, service, or location" /></label>
        <label className="admin-select-field"><span>Territory</span><select value={revenueContext?.activeBusinessUnitCode || ""} disabled aria-label="Active dispatch territory"><option>{revenueContext?.activeBusinessUnitCode || "HUC"}</option></select></label>
        <label className="admin-select-field"><span>Service date</span><input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label>
      </div>
      <div style={{...styles.label,marginTop:12}}>Approved / Ready for dispatch · {handoffs.length}</div>
      {filteredHandoffs.length ? filteredHandoffs.map((handoff) => <div key={handoff.id} style={styles.pipelineRow}>
        <div><div>{handoff.dispatch_label}</div><div style={styles.laborMeta}>{handoff.crew_size ? <span style={styles.laborBadge}>Crew {handoff.crew_size}</span> : null}{handoff.estimated_duration_hours ? <span style={styles.laborBadge}>{handoff.estimated_duration_hours}h planned</span> : null}</div></div>
        <span style={{...styles.badge,...styles.badgeReady}}>Ready for Dispatch</span>
        <button style={styles.secondary} onClick={()=>selectHandoff(handoff.id)}>Select for dispatch</button>
      </div>) : <div style={styles.note}>No approved handoffs are waiting for dispatch.</div>}
      <div style={{...styles.label,marginTop:14}}>Active Operations · {pipelineJobs.length}</div>
      {filteredPipelineJobs.length ? filteredPipelineJobs.map((job) => <div key={job.id} style={styles.pipelineRow}>
        <div><div>{job.dispatch_label || `Operational job ${handoffIdSnippet(job.id)}`}</div><div style={styles.laborMeta}>{job.crew_size ? <span style={styles.laborBadge}>Crew {job.crew_size}</span> : null}{job.estimated_duration_hours ? <span style={styles.laborBadge}>{job.estimated_duration_hours}h planned</span> : null}</div></div>
        <span style={{...styles.badge,...pipelineStatusStyle(job.operational_status)}}>{pipelineStatusLabel(job.operational_status)}</span>
        <div>{job.schedule_window?.scheduled_start ? `${job.schedule_window.scheduled_start} → ${job.schedule_window.scheduled_end || "end pending"}` : "Schedule pending"}<TechnicalDetails><span>Operational job: {job.id}</span><span>Work status: {job.operational_status}</span></TechnicalDetails></div>
      </div>) : <div style={styles.note}>No active operational jobs.</div>}
    </div>

    <div style={{...styles.grid, marginTop: 16}}>
      <label><span style={styles.label}>Revenue handoff</span><select style={styles.input} value={handoffId} onChange={e=>selectHandoff(e.target.value)}><option value="">Select…</option>{handoffs.map(h=><option key={h.id} value={h.id}>{h.dispatch_label || `Handoff ${handoffIdSnippet(h.id)}`}</option>)}</select></label>
      <label><span style={styles.label}>Worker</span><select style={styles.input} value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">Select…</option>{workers.map(w=><option key={w.id} value={w.id}>{w.display_name || w.email || w.id}</option>)}</select></label>
      <label><span style={styles.label}>Start</span><input style={styles.input} type="datetime-local" value={start} onChange={e=>{const next=e.target.value;setStart(next);const duration=selectedHandoff?.estimated_duration_hours;if(duration&&next){setEnd(addHoursToLocalDateTime(next,duration));setEndAutoCalculated(true);}else{setEndAutoCalculated(false);}}} /></label>
      <label><span style={styles.label}>End{selectedHandoff?.estimated_duration_hours ? <span style={styles.autoTag}>AUTO</span> : null}</span><input style={styles.input} type="datetime-local" value={end} onChange={e=>{setEnd(e.target.value);setEndAutoCalculated(false);}} /></label>
      <label><span style={styles.label}>Timezone</span><select style={styles.input} value={timezone} onChange={e=>setTimezone(e.target.value)}><option value="America/Toronto">Ontario · America/Toronto</option><option value="America/Phoenix">Arizona · America/Phoenix</option></select></label>
    </div>
    {selectedHandoff ? <div style={styles.detailCard} data-wave3-dispatch-plan="true">
      <div style={styles.scheduleCard}><strong>Pre-populated dispatch plan</strong><div style={styles.laborMeta}>{selectedHandoff.crew_size ? <span style={styles.laborBadge}>Crew {selectedHandoff.crew_size}</span> : null}{selectedHandoff.estimated_duration_hours ? <span style={styles.laborBadge}>{selectedHandoff.estimated_duration_hours}h duration</span> : null}{endAutoCalculated && end ? <span style={{...styles.laborBadge,...styles.badgeReady}}>End auto-calculated</span> : null}</div></div>
      <div style={styles.detailRow}><span style={styles.label}>Customer</span><span>{selectedHandoff.cascade?.customer?.name} · {selectedHandoff.cascade?.customer?.email || "No email"} · {selectedHandoff.cascade?.customer?.phone || "No phone"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Location</span><span>{[selectedHandoff.cascade?.location?.address_line1, selectedHandoff.cascade?.location?.address_line2, selectedHandoff.cascade?.location?.city, selectedHandoff.cascade?.location?.postal_code].filter(Boolean).join(", ")}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Scope</span><span>{humanize(selectedHandoff.cascade?.scope?.packageKey)} · {selectedHandoff.cascade?.scope?.beds ?? "—"} bed · {selectedHandoff.cascade?.scope?.baths ?? "—"} bath · {selectedHandoff.cascade?.scope?.sqft ?? "—"} sq ft · {selectedHandoff.cascade?.scope?.addons?.length ? selectedHandoff.cascade.scope.addons.map(humanize).join(", ") : "No add-ons"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Access</span><span>{selectedHandoff.cascade?.location?.access_notes || "No special access notes"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Accepted total</span><span>{formatMoney(selectedHandoff.cascade?.pricing?.total_amount, selectedHandoff.cascade?.pricing?.currency_code)} · {selectedHandoff.cascade?.pricing?.tax_name || "Tax"} {formatMoney(selectedHandoff.cascade?.pricing?.tax_amount, selectedHandoff.cascade?.pricing?.currency_code)}</span></div>
    </div> : null}
    {scheduleHint ? <div style={{...styles.note,marginTop:10}} data-wave3-schedule-prefill-hint="true">{scheduleHint}</div> : null}
    <div style={styles.row}><button style={styles.button} onClick={schedule} disabled={busy || !handoffId || !workerId || !start || !end}>Assign &amp; Dispatch</button></div>
    {message ? <div style={styles.ok}>{message}</div> : null}{error ? <div style={styles.error}>{error}</div> : null}
  </section>;
}

function WorkerOperations({ revenueContext }) {
  const [worker, setWorker] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [contexts, setContexts] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [completedTasks, setCompletedTasks] = useState([]);
  const [photoEntries, setPhotoEntries] = useState([]);
  const appUserId = revenueContext?.appUserId ?? null;

  const selected = useMemo(()=>assignments.find(a=>a.id===selectedId) ?? null,[assignments,selectedId]);
  const context = selectedId ? contexts[selectedId] ?? null : null;
  const scope = context?.scope || {};
  const addons = Array.isArray(scope?.addons) ? scope.addons : [];
  const completionLocked = context?.operational_status === "qa_pending" || selected?.assignment_status === "completed";
  const executionActive = context?.operational_status === "in_progress";
  const fieldTasks = useMemo(() => {
    if (Array.isArray(context?.checklist?.sections)) return flattenChecklistItems(context.checklist);
    const configured = context?.checklist?.tasks || context?.checklist?.items || context?.checklist;
    if (Array.isArray(configured)) return configured.map((item, index) => typeof item === "string" ? { key: `legacy_${index}`, label: item, required: true } : item).filter((item) => item?.label || item?.title);
    return [{ key: "review_scope", label: "Review scope and access notes", required: true }, { key: "complete_service_scope", label: "Complete the configured service scope", required: true }, { key: "final_quality_walkthrough", label: "Complete final quality walkthrough", required: true }, { key: "upload_completion_evidence", label: "Upload required completion evidence", required: true }];
  }, [context]);
  const evidenceRequirements = useMemo(() => {
    if (Array.isArray(context?.evidenceRequirements) && context.evidenceRequirements.length) return context.evidenceRequirements.map((item) => ({
      requirement_key: item.requirement_key,
      evidence_type: item.evidence_type,
      evidence_tag: item.storage_rule_payload?.evidence_tag || item.metadata?.evidence_tag || item.requirement_key,
      label: item.metadata?.label || item.requirement_key,
      required_count: item.required_count,
    }));
    return normalizeEvidenceContract(context?.checklist?.qa_evidence_contract || { requirements: [{ requirement_key: "service_after", evidence_type: "photo_after", evidence_tag: "after_clean", label: "Completed service", required_count: 1 }] }).requirements;
  }, [context]);

  const load = useCallback(async () => {
    if (!appUserId) return;
    setBusy(true); setError("");
    try {
      const rows = await getJson(`worker?app_user_id=eq.${encodeURIComponent(appUserId)}&status=eq.active&limit=1`);
      const w = Array.isArray(rows) ? rows[0] : null;
      if (!w) throw new Error("No active canonical worker profile is linked to this user.");
      setWorker(w);
      const a = await getJson(`worker_assignment?worker_id=eq.${encodeURIComponent(w.id)}&assignment_status=in.(assigned,acknowledged,completed)&order=created_at.desc&limit=20`);
      const nextAssignments = Array.isArray(a) ? a : [];
      const nextContexts = {};
      await Promise.all(nextAssignments.map(async (assignment) => {
        try {
          const [raw,payables] = await Promise.all([
            postJson("rpc/worker_get_assignment_context", { p_worker_assignment_id: assignment.id }, "Unable to load worker job details"),
            getJson(`contractor_payable?select=id,computed_amount,currency_code,payable_status,basis_value,compensation_method&worker_assignment_id=eq.${encodeURIComponent(assignment.id)}&order=created_at.desc&limit=1`).catch(()=>[]),
          ]);
          const normalized = Array.isArray(raw) ? raw[0] : raw;
          const evidenceRequirements = normalized?.work_order_id
            ? await getJson(`work_order_evidence_requirement?work_order_id=eq.${encodeURIComponent(normalized.work_order_id)}&order=requirement_key.asc`).catch(() => [])
            : [];
          nextContexts[assignment.id] = { ...normalized, evidenceRequirements, earnedPayable: Array.isArray(payables) ? payables[0] ?? null : null };
        } catch (contextError) {
          nextContexts[assignment.id] = { assignment_id: assignment.id, operational_job_id: assignment.operational_job_id, context_error: contextError?.message || String(contextError) };
        }
      }));
      setAssignments(nextAssignments);
      setContexts(nextContexts);
      setSelectedId((current) => current && nextAssignments.some((assignment) => assignment.id === current)
        ? current
        : nextAssignments?.[0]?.id || "");
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [appUserId]);

  useEffect(()=>{ load(); }, []);
  useEffect(() => {
    const refresh = (event) => { if (serviceOSInvalidationMatches(event, selected?.business_unit_id)) load(); };
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    return () => { window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisibility); window.clearInterval(timer); };
  }, [load, selected?.business_unit_id]);

  const updatePhotoEntry = useCallback((id, patch) => setPhotoEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)), []);
  const uploadPhoto = useCallback(async (entry) => {
    try {
      return await persistMobileEvidenceEntry({ entry, worker, assignment: selected, context, appUserId, onState: (patch) => updatePhotoEntry(entry.id, patch) });
    } catch (uploadError) {
      updatePhotoEntry(entry.id, { state: "error", error: uploadError?.message || String(uploadError) });
      throw uploadError;
    }
  }, [appUserId, context, selected, updatePhotoEntry, worker]);
  const addPhotos = (files, requirement) => setPhotoEntries((current) => [...current, ...files.map((file, index) => mobileEvidenceEntry(file, current.length + index, requirement))]);
  const retryPhoto = async (id) => {
    const entry = photoEntries.find((item) => item.id === id);
    if (!entry) return;
    setBusy(true); setError("");
    try { await uploadPhoto(entry); } catch (retryError) { setError(retryError?.message || String(retryError)); }
    finally { setBusy(false); }
  };

  const acknowledge = async () => {
    if (!selected || selected.assignment_status !== "assigned") return;
    setBusy(true); setError("");
    try {
      await updateWorkerAssignmentStatus(selected.id, "acknowledged", null, appUserId);
      try { await acknowledgeWorkerNotificationDelivery(selected.id); } catch {}
      await load();
      setMessage("Assignment acknowledged. Review the job details below, then start work when you arrive.");
    } catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  const startWork = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await postJson("rpc/worker_start_assigned_job", { p_worker_assignment_id: selected.id }, "Unable to start assigned work");
      await load();
      setMessage("Work started successfully. Job status is IN PROGRESS.");
    } catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  const completeWork = async () => {
    if (!selected) return;
    if (!note.trim()) { setError("Enter a completion note before submitting to QA."); return; }
    setBusy(true); setError("");
    try {
      const pendingPhotos = photoEntries.filter((entry) => entry.state !== "linked");
      for (const entry of pendingPhotos) await uploadPhoto(entry);
      const result = await postJobCompletion(selected.id, note.trim());
      const warning = result?.notificationWarning ? ` ${result.notificationWarning}` : "";
      setNote("");
      setPhotoEntries([]);
      await load();
      setMessage(`Submitted to QA successfully. Your work is complete; QA review is now pending.${warning}`);
    } catch(e){setError(e?.message??String(e));} finally{setBusy(false);}
  };

  const assignmentLabel = (assignment) => {
    const c = contexts[assignment.id];
    if (!c) return `Assignment ${handoffIdSnippet(assignment.id)} · ${humanize(assignment.assignment_status)}`;
    return `${c.customer_name || "Customer"} · ${c.service_title || "Cleaning service"} · ${humanize(assignment.assignment_status)}`;
  };

  return <section style={styles.card} data-wave3-worker-workspace="true" className="field-workspace">
    <p className="admin-eyebrow">Today&apos;s assigned work</p>
    <h2 style={styles.title}>Cleaner job execution</h2>
    <p style={styles.note}>Your view is limited to your assigned work. Completion stops at <strong>QA PENDING</strong>; workers cannot approve, fail, or waive QA.</p>
    <div style={styles.row}><button style={styles.secondary} onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh assignments"}</button></div>
    <label style={{display:"block",marginTop:12}}><span style={styles.label}>Assigned job</span><select style={styles.input} value={selectedId} onChange={e=>{setSelectedId(e.target.value);setMessage("");setError("");}}><option value="">Select…</option>{assignments.map(a=><option key={a.id} value={a.id}>{assignmentLabel(a)}</option>)}</select></label>

    {context ? <div style={styles.detailCard} data-worker-job-details="true">
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div><strong style={{fontSize:17}}>{context.customer_name || "Customer"}</strong><div style={styles.note}>{context.service_title || "Cleaning service"}</div></div>
        <span style={{...styles.badge,...(context.operational_status === "qa_pending" ? styles.badgeCompleted : styles.badgeDispatched)}}>{humanize(context.operational_status)}</span>
      </div>
      <div style={styles.detailRow}><span style={styles.label}>Address</span><span>{[context.address_line1 || scope.location?.address_line1, scope.location?.address_line2, context.city || scope.location?.city, context.subdivision || scope.location?.subdivision, scope.location?.postal_code].filter(Boolean).join(", ") || "Address unavailable"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Schedule</span><span>{context.scheduled_start ? `${context.scheduled_start} → ${context.scheduled_end || "end pending"} (${context.timezone || "local time"})` : "Schedule unavailable"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Package</span><span>{humanize(scope.packageKey || context.checklist?.package || context.service_title)}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Property</span><span>{[scope.dwellingType, scope.beds ? `${scope.beds} bed` : null, scope.baths ? `${scope.baths} bath` : null, scope.sqft ? `${scope.sqft} sqft` : null].filter(Boolean).join(" · ") || "Scope details unavailable"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Condition</span><span>{humanize(scope.condition || "not specified")}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Add-ons</span><span>{addons.length ? addons.map(humanize).join(", ") : "None"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Access notes</span><span>{context.access_instructions?.notes || context.access_instructions?.instructions || (typeof context.access_instructions === "string" ? context.access_instructions : "No special access notes")}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Instructions</span><span>{context.customer_instructions?.notes || scope.notes || "No special instructions"}</span></div>
      <div style={styles.detailRow}><span style={styles.label}>Work order</span><span>{humanize(context.work_order_status)}</span></div>
      <EarnedPayoutBanner payable={context.earnedPayable} qaPending={context.operational_status === "qa_pending"} />
      <TechnicalDetails><span>Work order: {context.work_order_id}</span><span>Assignment: {selected?.id}</span></TechnicalDetails>
      {context.context_error ? <div style={styles.error}>{context.context_error}</div> : null}
    </div> : null}

    {executionActive ? <CleanerExecutionPlaybook key={selectedId} context={context} addons={addons} /> : null}

    {executionActive ? <TechnicianExecutionCard tasks={fieldTasks} completedTasks={completedTasks} assignmentId={selectedId} disabled={completionLocked} onToggle={(key) => setCompletedTasks((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} /> : null}

    {executionActive ? <ResilientEvidenceUploader entries={photoEntries} requirements={evidenceRequirements} disabled={busy || completionLocked} onFiles={addPhotos} onRetry={retryPhoto} /> : null}

    <div style={styles.row}>
      <button className="field-primary-action" style={styles.secondary} onClick={acknowledge} disabled={busy||!selected||selected.assignment_status!=="assigned"}>Acknowledge</button>
      <button className="field-primary-action" style={styles.button} onClick={startWork} disabled={busy||!selected||selected.assignment_status!=="acknowledged"||context?.operational_status!=="dispatched"}>Start Job</button>
    </div>
    {executionActive || completionLocked ? <label style={{display:"block",marginTop:12}}><span style={styles.label}>Completion note</span><textarea style={{...styles.input,minHeight:90}} value={note} onChange={e=>setNote(e.target.value)} disabled={completionLocked} placeholder={completionLocked ? "Completion submitted to QA." : "Describe completed service and evidence."} /></label> : null}
    {executionActive ? <div style={styles.row}><button className="field-primary-action" style={styles.button} onClick={completeWork} disabled={busy||!selected||selected.assignment_status!=="acknowledged"}>Submit Completion to QA</button></div> : null}
    {completionLocked ? <div style={styles.ok}>Submitted to QA. No further worker action is required unless the office or QA team returns the job for correction.</div> : null}
    {message ? <div style={styles.ok}>{message}</div> : null}{error ? <div style={styles.error}>{error}</div> : null}
  </section>;
}

export default function ServiceOSOperationsWorkspace({ revenueContext }) {
  const role = revenueContext?.roleCode ?? "unknown";
  if (role === "worker") return <WorkerOperations revenueContext={revenueContext} />;
  if (role === "owner_admin" || role === "office_ops") return <OfficeOperations revenueContext={revenueContext} />;
  return null;
}
