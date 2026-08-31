import React, { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedRestFetchWithRefresh, getValidAccessToken } from "../../lib/serviceosAuthClient.js";
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
  pipeline: { marginTop: 14, padding: 14, border: "1px solid #31425A", borderRadius: 10, background: "#101827" },
  pipelineRow: { display: "grid", gridTemplateColumns: "minmax(260px,1.7fr) minmax(110px,.6fr) minmax(180px,1fr)", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid #253449", fontSize: 13 },
  badge: { display: "inline-flex", width: "fit-content", padding: "4px 8px", borderRadius: 999, background: "#20304A", color: "#BFD4F2", fontSize: 11, fontWeight: 850, textTransform: "uppercase" },
  badgeReady: { background: "#173A33", color: "#60E7C6" },
  badgeDispatched: { background: "#1F3358", color: "#AFCBFF" },
  badgeCompleted: { background: "#3A3120", color: "#FFD78A" },
  laborMeta: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 },
  laborBadge: { display: "inline-flex", alignItems: "center", padding: "3px 7px", borderRadius: 999, border: "1px solid #34465F", color: "#B8C7D9", fontSize: 11, fontWeight: 750 },
  scheduleCard: { marginTop: 12, padding: "10px 12px", borderRadius: 9, border: "1px solid #2D4551", background: "#102329", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" },
  autoTag: { marginLeft: 6, padding: "2px 6px", borderRadius: 999, background: "#173A33", color: "#60E7C6", fontSize: 9, fontWeight: 900, letterSpacing: ".04em" },
};

async function getJson(path) {
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res?.ok) throw new Error(`Operations read failed: HTTP ${res?.status ?? "network"} ${await res?.text().catch(() => "")}`);
  return res.json();
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parsePreferredDate(value, referenceDate) {
  const text = String(value || "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const reference = referenceDate ? new Date(referenceDate) : new Date();
  const year = Number.isNaN(reference.getTime()) ? new Date().getFullYear() : reference.getFullYear();
  const parsed = new Date(`${text} ${year}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

function parsePreferredTime(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("morning")) return "09:00";
  if (text.includes("afternoon")) return "13:00";
  if (text.includes("evening")) return "17:00";
  const match = text.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function resolveRequestedStart(preferredDate, preferredWindow, referenceDate) {
  const date = parsePreferredDate(preferredDate, referenceDate);
  const time = parsePreferredTime(preferredWindow);
  return date && time ? `${date}T${time}` : null;
}

function addHoursToLocalDateTime(localValue, hours) {
  if (!localValue || !Number.isFinite(Number(hours)) || Number(hours) <= 0) return "";
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setMinutes(parsed.getMinutes() + Math.round(Number(hours) * 60));
  return formatLocalDateTime(parsed);
}

function resolveDurationHours(pricingSnapshot, scope) {
  const candidates = [
    pricingSnapshot?.labor_economics?.jobHours,
    pricingSnapshot?.calculation_outputs?.jobHours,
    pricingSnapshot?.raw_calculation_snapshot?.jobHours,
    scope?.estimatedDurationHours,
    scope?.estimated_duration_hours,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function resolveCrewSize(pricingSnapshot) {
  const candidates = [
    pricingSnapshot?.labor_economics?.teamSize,
    pricingSnapshot?.raw_calculation_snapshot?.teamSize,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function pipelineStatusLabel(status) {
  if (status === "ready_to_schedule" || status === "scheduled") return "Ready for Dispatch";
  if (status === "dispatched" || status === "in_progress") return "Dispatched";
  if (status === "service_complete" || status === "qa_pending" || status === "corrective_action_required") return "Completed";
  return String(status || "Unknown").replaceAll("_", " ");
}

function pipelineStatusStyle(status) {
  if (status === "ready_to_schedule" || status === "scheduled") return styles.badgeReady;
  if (status === "dispatched" || status === "in_progress") return styles.badgeDispatched;
  if (status === "service_complete" || status === "qa_pending" || status === "corrective_action_required") return styles.badgeCompleted;
  return {};
}

function timezoneForScope(scope, location) {
  const code = scope?.businessUnitCode || scope?.business_unit_code || "";
  const subdivision = String(location?.subdivision || "").toUpperCase();
  return code === "HUC-AZ" || subdivision === "AZ" ? "America/Phoenix" : "America/Toronto";
}

async function enrichHandoffForDispatch(handoff) {
  if (!handoff?.id) return handoff;

  const [conversionRows, quoteVersionRows, pricingRows] = await Promise.all([
    getJson(`conversion_record?id=eq.${encodeURIComponent(handoff.conversion_record_id)}&select=id,customer_id,contact_id,service_location_id&limit=1`),
    getJson(`quote_version?id=eq.${encodeURIComponent(handoff.quote_version_id)}&select=id,title,estimate_id&limit=1`),
    handoff.pricing_snapshot_id
      ? getJson(`pricing_snapshot?id=eq.${encodeURIComponent(handoff.pricing_snapshot_id)}&select=id,labor_economics,calculation_outputs,raw_calculation_snapshot&limit=1`)
      : Promise.resolve([]),
  ]);
  const conversion = firstRow(conversionRows);
  const quoteVersion = firstRow(quoteVersionRows);
  const pricingSnapshot = firstRow(pricingRows);

  const estimateRows = quoteVersion?.estimate_id
    ? await getJson(`estimate?id=eq.${encodeURIComponent(quoteVersion.estimate_id)}&select=id,opportunity_id,scope_snapshot&limit=1`)
    : [];
  const estimate = firstRow(estimateRows);
  const opportunityRows = estimate?.opportunity_id
    ? await getJson(`opportunity?id=eq.${encodeURIComponent(estimate.opportunity_id)}&select=id,service_request_id&limit=1`)
    : [];
  const opportunity = firstRow(opportunityRows);
  const serviceRequestRows = opportunity?.service_request_id
    ? await getJson(`service_request?id=eq.${encodeURIComponent(opportunity.service_request_id)}&select=id,requirements,created_at&limit=1`)
    : [];
  const serviceRequest = firstRow(serviceRequestRows);

  const [customerRows, contactRows, locationRows] = await Promise.all([
    conversion?.customer_id
      ? getJson(`customer?id=eq.${encodeURIComponent(conversion.customer_id)}&select=id,display_name&limit=1`)
      : Promise.resolve([]),
    conversion?.contact_id
      ? getJson(`contact?id=eq.${encodeURIComponent(conversion.contact_id)}&select=id,first_name,last_name&limit=1`)
      : Promise.resolve([]),
    conversion?.service_location_id
      ? getJson(`service_location?id=eq.${encodeURIComponent(conversion.service_location_id)}&select=id,address_line1,city,subdivision&limit=1`)
      : Promise.resolve([]),
  ]);

  const customer = firstRow(customerRows);
  const contact = firstRow(contactRows);
  const location = firstRow(locationRows);
  const scope = serviceRequest?.requirements?.scope || estimate?.scope_snapshot || {};
  const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  const customerName = customer?.display_name || contactName || serviceRequest?.requirements?.customer?.name || "Customer";
  const serviceTier = quoteVersion?.title || "Service details unavailable";
  const city = location?.city || location?.subdivision || "Location unavailable";
  const locationLabel = location?.address_line1 ? `${city} / ${location.address_line1}` : city;
  const requestedStartLocal = resolveRequestedStart(scope?.preferredDate, scope?.preferredWindow, serviceRequest?.created_at || handoff.created_at);
  const durationHours = resolveDurationHours(pricingSnapshot, scope);
  const crewSize = resolveCrewSize(pricingSnapshot);

  return {
    ...handoff,
    dispatch_label: `${customerName} — ${serviceTier} — ${locationLabel} (${handoffIdSnippet(handoff.id)})`,
    customer_name: customerName,
    service_tier: serviceTier,
    location_label: locationLabel,
    requested_date: scope?.preferredDate || null,
    requested_window: scope?.preferredWindow || null,
    requested_start_local: requestedStartLocal,
    estimated_duration_hours: durationHours,
    crew_size: crewSize,
    suggested_timezone: timezoneForScope(scope, location),
  };
}

async function fetchActiveDispatchPipeline() {
  const jobs = await getJson([
    "operational_job?select=id,job_handoff_id,operational_status,created_at",
    "operational_status=in.(ready_to_schedule,scheduled,dispatched,in_progress,service_complete,qa_pending,corrective_action_required)",
    "order=created_at.desc",
    "limit=50",
  ].join("&"));
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return Promise.all(jobs.map(async (job) => {
    try {
      const handoff = firstRow(await getJson(`job_handoff?id=eq.${encodeURIComponent(job.job_handoff_id)}&select=id,organization_id,business_unit_id,conversion_record_id,quote_version_id,pricing_snapshot_id,handoff_status,created_at&limit=1`));
      const enriched = handoff ? await enrichHandoffForDispatch(handoff) : null;
      const scheduleWindow = firstRow(await getJson(`schedule_window?operational_job_id=eq.${encodeURIComponent(job.id)}&select=scheduled_start,scheduled_end,timezone,status&order=created_at.desc&limit=1`));
      return { ...job, ...enriched, schedule_window: scheduleWindow };
    } catch {
      return { ...job, dispatch_label: `Operational job ${handoffIdSnippet(job.id)}` };
    }
  }));
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
  const appUserId = revenueContext?.appUserId ?? null;
  const selectedHandoff = useMemo(() => handoffs.find((handoff) => handoff.id === handoffId) ?? null, [handoffs, handoffId]);

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
      if (!workerId && nextWorkers?.[0]?.id) setWorkerId(nextWorkers[0].id);
      setMessage(`Dispatch pipeline refreshed · ${nextHandoffs?.length ?? 0} ready · ${activePipeline?.length ?? 0} active job(s).`);
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, workerId, applyScheduleSuggestion]);

  useEffect(() => { load(); }, []); // intentional initial pipeline load

  const selectHandoff = useCallback((id) => {
    setHandoffId(id);
    applyScheduleSuggestion(handoffs.find((handoff) => handoff.id === id) || null);
  }, [handoffs, applyScheduleSuggestion]);

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
    } catch (e) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }, [handoffId, workerId, start, end, timezone, appUserId, load]);

  return <section style={styles.card} data-wave3-office-workspace="true">
    <h2 style={styles.title}>Wave 3 Operations · Office Dispatch</h2>
    <p style={styles.note}>Uses canonical accepted Revenue handoffs and Operations records. Ready work and active jobs load automatically; Refresh updates the live pipeline.</p>

    <div style={styles.pipeline} data-wave3-dispatch-pipeline="true">
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <strong>Dispatch Pipeline</strong>
        <button style={styles.secondary} onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh pipeline"}</button>
      </div>
      <div style={{...styles.label,marginTop:12}}>Approved / Ready for dispatch · {handoffs.length}</div>
      {handoffs.length ? handoffs.map((handoff) => <div key={handoff.id} style={styles.pipelineRow}>
        <div><div>{handoff.dispatch_label}</div><div style={styles.laborMeta}>{handoff.crew_size ? <span style={styles.laborBadge}>Crew {handoff.crew_size}</span> : null}{handoff.estimated_duration_hours ? <span style={styles.laborBadge}>{handoff.estimated_duration_hours}h planned</span> : null}</div></div>
        <span style={{...styles.badge,...styles.badgeReady}}>Ready for Dispatch</span>
        <button style={styles.secondary} onClick={()=>selectHandoff(handoff.id)}>Select for dispatch</button>
      </div>) : <div style={styles.note}>No approved handoffs are waiting for dispatch.</div>}
      <div style={{...styles.label,marginTop:14}}>Active Operations · {pipelineJobs.length}</div>
      {pipelineJobs.length ? pipelineJobs.map((job) => <div key={job.id} style={styles.pipelineRow}>
        <div><div>{job.dispatch_label || `Operational job ${handoffIdSnippet(job.id)}`}</div><div style={styles.laborMeta}>{job.crew_size ? <span style={styles.laborBadge}>Crew {job.crew_size}</span> : null}{job.estimated_duration_hours ? <span style={styles.laborBadge}>{job.estimated_duration_hours}h planned</span> : null}</div></div>
        <span style={{...styles.badge,...pipelineStatusStyle(job.operational_status)}}>{pipelineStatusLabel(job.operational_status)}</span>
        <div style={styles.mono}>{job.schedule_window?.scheduled_start ? `${job.schedule_window.scheduled_start} → ${job.schedule_window.scheduled_end || "end pending"}` : "Schedule pending"}</div>
      </div>) : <div style={styles.note}>No active operational jobs.</div>}
    </div>

    <div style={{...styles.grid, marginTop: 16}}>
      <label><span style={styles.label}>Revenue handoff</span><select style={styles.input} value={handoffId} onChange={e=>selectHandoff(e.target.value)}><option value="">Select…</option>{handoffs.map(h=><option key={h.id} value={h.id}>{h.dispatch_label || `Handoff ${handoffIdSnippet(h.id)}`}</option>)}</select></label>
      <label><span style={styles.label}>Worker</span><select style={styles.input} value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">Select…</option>{workers.map(w=><option key={w.id} value={w.id}>{w.display_name || w.email || w.id}</option>)}</select></label>
      <label><span style={styles.label}>Start</span><input style={styles.input} type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} /></label>
      <label><span style={styles.label}>End{selectedHandoff?.estimated_duration_hours ? <span style={styles.autoTag}>AUTO</span> : null}</span><input style={styles.input} type="datetime-local" value={end} onChange={e=>{setEnd(e.target.value);setEndAutoCalculated(false);}} /></label>
      <label><span style={styles.label}>Timezone</span><select style={styles.input} value={timezone} onChange={e=>setTimezone(e.target.value)}><option value="America/Toronto">Ontario · America/Toronto</option><option value="America/Phoenix">Arizona · America/Phoenix</option></select></label>
    </div>
    {selectedHandoff ? <div style={styles.scheduleCard} data-wave3-dispatch-plan="true"><strong>Dispatch plan</strong><div style={styles.laborMeta}>{selectedHandoff.crew_size ? <span style={styles.laborBadge}>Crew {selectedHandoff.crew_size}</span> : null}{selectedHandoff.estimated_duration_hours ? <span style={styles.laborBadge}>{selectedHandoff.estimated_duration_hours}h duration</span> : null}{endAutoCalculated && end ? <span style={{...styles.laborBadge,...styles.badgeReady}}>End auto-calculated</span> : null}</div></div> : null}
    {scheduleHint ? <div style={{...styles.note,marginTop:10}} data-wave3-schedule-prefill-hint="true">{scheduleHint}</div> : null}
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
    try {
      await updateWorkerAssignmentStatus(selected.id, "acknowledged", null, appUserId);
      try {
        await acknowledgeWorkerNotificationDelivery(selected.id);
        setMessage("Assignment acknowledged. Worker notification audit is acknowledged.");
      } catch (auditError) {
        setMessage(`Assignment acknowledged. Notification audit sync needs review: ${auditError?.message || String(auditError)}`);
      }
      await load();
    }
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
