import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import { createQaInspection, fetchCompletionEvidenceForJob } from "../../lib/serviceosOperationsClient.js";
import { getValidAccessToken } from "../../lib/serviceosAuthClient.js";
import { getSupabaseConfig } from "../../lib/supabaseConfig.js";
import { buildQaInspectionPayload } from "../../lib/serviceosOperationsUtils.js";
import {
  approveFlightControlPayable,
  fetchFlightControlBoard,
  finalizeFlightControlQa,
} from "../../lib/serviceosFlightControl.js";
import {
  invalidateServiceOSFinancials,
  invalidateServiceOSWorkspace,
  SERVICEOS_WORKSPACE_INVALIDATED_EVENT,
  serviceOSInvalidationMatches,
} from "../../lib/serviceosFinancialPerformance.js";

function money(value, currency) {
  if (!currency || !Number.isFinite(Number(value))) return "Amount unavailable";
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value));
}

function dateTime(value) {
  if (!value) return "Schedule pending";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Schedule pending" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function elapsed(startedAt, now) {
  if (!startedAt) return "Clock-in pending";
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
}

function Lane({ id, title, eyebrow, count, children, empty }) {
  return <section className="flight-control-lane" aria-labelledby={`${id}-title`} data-tip={`${title} contains ${count} current item${count === 1 ? "" : "s"}. Open a card action to move work forward.`}>
    <header><div><p>{eyebrow}</p><h3 id={`${id}-title`}>{title}</h3></div><span>{count}</span></header>
    <div className="flight-control-lane__body">{count ? children : <div className="flight-control-empty"><StatusBadge tone="neutral">Clear</StatusBadge><p>{empty}</p></div>}</div>
  </section>;
}

export function AssignmentQuickAction({ row }) {
  const open = () => {
    window.dispatchEvent(new CustomEvent("serviceos:open-secondary-workspace", { detail: { workspace: "operations" } }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("serviceos:open-dispatch", { detail: { handoffId: row.id } })), 50);
  };
  return <button className="huc-button" data-tip="Open Dispatch with this accepted job selected and assign an operable cleaner." onClick={open}>Assign cleaner</button>;
}

export function QaEvidenceDrawer({ row, busy, waiverReason, onWaiverReason, onFinalize }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [evidenceError, setEvidenceError] = useState("");
  useEffect(() => {
    if (!open || !row.operational_job_id) return undefined;
    let active = true;
    const objectUrls = [];
    (async () => {
      try {
        setEvidenceError("");
        const evidence = await fetchCompletionEvidenceForJob(row.operational_job_id);
        const { url, anon } = getSupabaseConfig(import.meta.env);
        const accessToken = await getValidAccessToken();
        const loaded = await Promise.all((evidence || []).filter((item) => item.storage_reference).map(async (item) => {
          const path = item.storage_reference.split("/").map(encodeURIComponent).join("/");
          const response = await fetch(`${url}/storage/v1/object/authenticated/serviceos-completion-evidence/${path}`, { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` } });
          if (!response.ok) throw new Error(`Photo could not be loaded (${response.status}).`);
          const objectUrl = URL.createObjectURL(await response.blob());
          objectUrls.push(objectUrl);
          return { ...item, objectUrl };
        }));
        if (active) setPhotos(loaded);
      } catch (error) { if (active) setEvidenceError(error?.message || "Evidence could not be loaded."); }
    })();
    return () => { active = false; objectUrls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [open, row.operational_job_id]);
  return <div className="qa-evidence-drawer">
    <button className="huc-button huc-button--secondary" data-tip="Inspect linked completion evidence before passing or waiving QA." onClick={() => setOpen((current) => !current)} aria-expanded={open}>{open ? "Close evidence" : `Review ${row.photo_count || 0} photo${row.photo_count === 1 ? "" : "s"}`}</button>
    {open ? <div className="qa-evidence-drawer__panel"><p>{row.photo_count ? `${row.photo_count} governed completion photo${row.photo_count === 1 ? " is" : "s are"} linked to this case.` : "No completion photo is linked. Review the evidence policy before waiving."}</p>{photos.length ? <div className="qa-evidence-preview-grid">{photos.map((photo, index) => <a href={photo.objectUrl} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.objectUrl} alt={`${photo.evidence_type?.replaceAll("_", " ") || "Completion evidence"} ${index + 1}`} /><span>{photo.evidence_type?.replaceAll("_", " ")}</span></a>)}</div> : null}{evidenceError ? <div className="financial-alert" role="alert">{evidenceError}</div> : null}<div className="flight-control-card__actions"><button className="huc-button" disabled={busy} onClick={() => onFinalize("passed")}>Pass QA</button><button className="huc-button huc-button--secondary" onClick={() => window.dispatchEvent(new CustomEvent("serviceos:open-secondary-workspace", { detail: { workspace: "qa" } }))}>Full QA record</button></div><label className="flight-control-waiver"><span>Governed waiver reason</span><input value={waiverReason} onChange={(event) => onWaiverReason(event.target.value)} placeholder="Required for waiver" /><button className="huc-button huc-button--secondary" disabled={busy || !waiverReason.trim()} onClick={() => onFinalize("waived")}>Waive QA</button></label></div> : null}
  </div>;
}

export function SettlementQuickAction({ row, role, busy, onApprove }) {
  return row.status === "pending" && role === "owner_admin"
    ? <button className="huc-button" data-tip="Approve the accrued cleaner liability; payment remains a separate disbursement step." disabled={busy} onClick={onApprove}>Approve payout</button>
    : <button className="huc-button huc-button--secondary" onClick={() => window.dispatchEvent(new CustomEvent("serviceos:open-secondary-workspace", { detail: { workspace: "payables" } }))}>Payables history</button>;
}

export default function ServiceOSFlightControlBoard({ session, revenueContext }) {
  const organizationId = revenueContext?.orgId;
  const businessUnitId = revenueContext?.primaryBusinessUnitId;
  const marketCode = revenueContext?.activeBusinessUnitCode;
  const role = revenueContext?.roleCode;
  const appUserId = revenueContext?.appUserId;
  const [data, setData] = useState({ inbound: [], inFlight: [], qa: [], settlement: [], currencyCode: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [waiverReasons, setWaiverReasons] = useState({});
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!organizationId || !businessUnitId) return;
    if (!quiet) setLoading(true);
    setError("");
    try { setData(await fetchFlightControlBoard({ organizationId, businessUnitId })); }
    catch (nextError) { setError(nextError?.message || "Flight Control could not be refreshed."); }
    finally { if (!quiet) setLoading(false); }
  }, [organizationId, businessUnitId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = (event) => { if (serviceOSInvalidationMatches(event, businessUnitId)) load({ quiet: true }); };
    const onVisibility = () => { if (document.visibilityState === "visible") load({ quiet: true }); };
    window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    const refreshTimer = window.setInterval(() => { if (document.visibilityState === "visible") load({ quiet: true }); }, 30000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => {
      window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [businessUnitId, load]);

  const total = useMemo(() => data.inbound.length + data.inFlight.length + data.qa.length + data.settlement.length, [data]);

  async function finalizeQa(row, outcome) {
    const waiverReason = String(waiverReasons[row.operational_job_id] || "").trim();
    if (outcome === "waived" && !waiverReason) return setError("Enter a governed waiver reason before waiving QA.");
    if (row.qa_inspection_status === "passed") return setError("This case needs recovery in the full QA workspace because its inspection was already finalized.");
    setBusyId(row.operational_job_id); setError(""); setNotice("");
    try {
      let inspectionId = row.qa_inspection_id;
      if (!inspectionId) {
        const inspection = await createQaInspection(buildQaInspectionPayload({
          organizationId,
          businessUnitId,
          operationalJobId: row.operational_job_id,
          workOrderId: row.work_order_id,
          inspectorAppUserId: appUserId,
          inspectionStatus: "pending",
          inspectionType: "standard",
          findings: {},
          metadata: { source: "admin_flight_control", synthetic: false },
        }), session?.access_token);
        inspectionId = inspection.id;
      }
      const result = await finalizeFlightControlQa({ inspectionId, outcome, score: 100, waiverReason });
      setNotice(`${row.customer_name}: QA ${outcome}; profitability sealed and cleaner labor staged.`);
      invalidateServiceOSFinancials({ businessUnitId, operationalJobId: row.operational_job_id, affectedDomains: ["qa", "financials", "settlement"] });
      await load({ quiet: true });
      return result;
    } catch (nextError) { setError(nextError?.message || "QA finalization failed."); }
    finally { setBusyId(""); }
  }

  async function approvePayable(row) {
    setBusyId(row.id); setError(""); setNotice("");
    try {
      await approveFlightControlPayable({ organizationId, businessUnitId, payableId: row.id });
      setNotice(`${row.worker_name}: ${money(row.amount, row.currency_code)} approved for payout.`);
      invalidateServiceOSWorkspace({ businessUnitId, affectedDomains: ["settlement", "financials"] });
      await load({ quiet: true });
    } catch (nextError) { setError(nextError?.message || "Payout approval failed."); }
    finally { setBusyId(""); }
  }

  if (!["owner_admin", "office_ops"].includes(role)) return null;

  return <section className="flight-control-board" aria-labelledby="flight-control-title" data-flight-control-market={marketCode} data-tour="flight-control-cards">
    <header className="flight-control-board__header"><div><p className="admin-eyebrow">Administrative flight control · {marketCode}</p><h2 id="flight-control-title">Live service lifecycle</h2><p>One governed operating view from accepted work through cleaner settlement.</p></div><div><StatusBadge tone={error ? "danger" : "success"}>{total} active</StatusBadge><button className="huc-button huc-button--secondary" onClick={() => load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh board"}</button></div></header>
    {error ? <div className="financial-alert" role="alert">{error}</div> : null}
    {notice ? <div className="financial-alert financial-alert--success" role="status">{notice}</div> : null}
    <div className="flight-control-grid" aria-busy={loading}>
      <Lane id="inbound" title="Inbound & Dispatch" eyebrow="Accepted work" count={data.inbound.length} empty={`No accepted work is awaiting assignment in ${marketCode}.`}>
        {data.inbound.map((row) => <article className="flight-control-card" key={row.id}><StatusBadge tone="info">{row.operational_status === "scheduled" ? "Scheduled" : "Ready"}</StatusBadge><h4>{row.customer_name || row.dispatch_label}</h4><p>{row.service_tier || "Service scope retained in accepted handoff"}</p><small>{row.location_label || dateTime(row.schedule_window?.scheduled_start || row.requested_start_local)}</small><strong>{money(row.cascade?.pricing?.total_amount, row.cascade?.pricing?.currency_code)}</strong><AssignmentQuickAction row={row} /><TechnicalDetails><span>Governed handoff: {row.job_handoff_id || row.id}</span></TechnicalDetails></article>)}
      </Lane>
      <Lane id="in-flight" title="In-Flight" eyebrow="Field execution" count={data.inFlight.length} empty={`No technicians are currently clocked in or dispatched in ${marketCode}.`}>
        {data.inFlight.map((row) => <article className="flight-control-card" key={row.id}><StatusBadge tone={row.operational_status === "in_progress" ? "warning" : "info"}>{row.operational_status === "in_progress" ? "Clocked in" : "Dispatched"}</StatusBadge><h4>{row.customer_name || row.dispatch_label}</h4><p>{row.worker_names || "Cleaner assignment acknowledged in governed work order"}</p><strong>{row.operational_status === "in_progress" ? elapsed(row.started_at, now) : dateTime(row.schedule_window?.scheduled_start)}</strong><TechnicalDetails><span>Operational job: {row.id}</span><span>Work order: {row.work_order_id || "Pending publication"}</span></TechnicalDetails></article>)}
      </Lane>
      <Lane id="qa" title="QA Review" eyebrow="Completed work" count={data.qa.length} empty={`No completed jobs are waiting for QA in ${marketCode}.`}>
        {data.qa.map((row) => <article className="flight-control-card" key={row.operational_job_id}><StatusBadge tone={row.photo_count ? "success" : "warning"}>{row.photo_count} photo{row.photo_count === 1 ? "" : "s"}</StatusBadge><h4>{row.customer_name}</h4><p>{row.service_address || "Service address unavailable"}</p><small>{row.cleaner_names} · {dateTime(row.service_date || row.service_completed_at)}</small><QaEvidenceDrawer row={row} busy={busyId === row.operational_job_id} waiverReason={String(waiverReasons[row.operational_job_id] || "")} onWaiverReason={(value) => setWaiverReasons((current) => ({ ...current, [row.operational_job_id]: value }))} onFinalize={(outcome) => finalizeQa(row, outcome)} /></article>)}
      </Lane>
      <Lane id="settlement" title="Settlement" eyebrow="Cleaner accruals" count={data.settlement.length} empty={`No cleaner accruals require settlement action in ${marketCode}.`}>
        {data.settlement.map((row) => <article className="flight-control-card" key={row.id}><StatusBadge tone={row.status === "pending" ? "warning" : "info"}>{row.status === "pending" ? "Pending approval" : "Approved to pay"}</StatusBadge><h4>{row.worker_name}</h4><strong>{money(row.amount, row.currency_code || data.currencyCode)}</strong><p>{row.compensation_method === "hourly" ? `${Number(row.actual_hours).toFixed(2)} hours accrued` : "Governed flat compensation"}</p><SettlementQuickAction row={row} role={role} busy={busyId === row.id} onApprove={() => approvePayable(row)} /><TechnicalDetails><span>Payable: {row.id}</span></TechnicalDetails></article>)}
      </Lane>
    </div>
  </section>;
}
