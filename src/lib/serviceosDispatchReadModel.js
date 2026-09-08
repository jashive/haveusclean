import { getJobHours, getTeamSize } from "../core/pricing/sharedPricing.js";
import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import { buildDispatchCascade } from "./serviceosDispatchCascade.js";

async function getJson(path) {
  const response = await authenticatedRestFetchWithRefresh(path);
  if (!response?.ok) throw new Error(`Operations read failed: HTTP ${response?.status ?? "network"} ${await response?.text().catch(() => "")}`);
  return response.json();
}

function firstRow(rows) { return Array.isArray(rows) ? rows[0] ?? null : rows ?? null; }
function pad2(value) { return String(value).padStart(2, "0"); }
function handoffIdSnippet(id) { return id ? `${String(id).slice(0, 8)}...` : "unknown"; }

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
  if (text.includes("morning") || text.includes("flexible")) return "09:00";
  if (text.includes("midday")) return "11:00";
  if (text.includes("afternoon")) return "13:00";
  if (text.includes("evening")) return "17:00";
  const match = text.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? `${pad2(hour)}:${pad2(minute)}` : null;
}

function resolveRequestedStart(preferredDate, preferredWindow, referenceDate) {
  const date = parsePreferredDate(preferredDate, referenceDate);
  const time = parsePreferredTime(preferredWindow);
  return date && time ? `${date}T${time}` : null;
}

function exactScopeSqft(scope) {
  const value = Number(scope?.sqft ?? scope?.squareFeet ?? scope?.square_feet);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resolveDurationHours(pricingSnapshot, scope) {
  for (const candidate of [pricingSnapshot?.labor_economics?.jobHours, pricingSnapshot?.calculation_outputs?.jobHours, pricingSnapshot?.raw_calculation_snapshot?.jobHours, scope?.estimatedDurationHours, scope?.estimated_duration_hours]) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const sqft = exactScopeSqft(scope);
  return sqft ? getJobHours(sqft) : null;
}

function resolveCrewSize(pricingSnapshot, scope) {
  for (const candidate of [pricingSnapshot?.labor_economics?.teamSize, pricingSnapshot?.raw_calculation_snapshot?.teamSize]) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  const sqft = exactScopeSqft(scope);
  return sqft ? getTeamSize(sqft) : null;
}

function timezoneForScope(scope, location) {
  const code = scope?.businessUnitCode || scope?.business_unit_code || "";
  return code === "HUC-AZ" || String(location?.subdivision || "").toUpperCase() === "AZ" ? "America/Phoenix" : "America/Toronto";
}

export async function enrichHandoffForDispatch(handoff) {
  if (!handoff?.id) return handoff;
  const [conversion, quoteVersion, pricingSnapshot] = await Promise.all([
    getJson(`conversion_record?id=eq.${encodeURIComponent(handoff.conversion_record_id)}&select=id,customer_id,contact_id,service_location_id&limit=1`).then(firstRow),
    getJson(`quote_version?id=eq.${encodeURIComponent(handoff.quote_version_id)}&select=id,title,estimate_id&limit=1`).then(firstRow),
    handoff.pricing_snapshot_id ? getJson(`pricing_snapshot?id=eq.${encodeURIComponent(handoff.pricing_snapshot_id)}&select=id,currency_code,tax_name,tax_rate,subtotal_amount,tax_amount,total_amount,labor_economics,calculation_outputs,raw_calculation_snapshot&limit=1`).then(firstRow) : null,
  ]);
  const estimate = quoteVersion?.estimate_id ? firstRow(await getJson(`estimate?id=eq.${encodeURIComponent(quoteVersion.estimate_id)}&select=id,opportunity_id,scope_snapshot&limit=1`)) : null;
  const opportunity = estimate?.opportunity_id ? firstRow(await getJson(`opportunity?id=eq.${encodeURIComponent(estimate.opportunity_id)}&select=id,service_request_id&limit=1`)) : null;
  const serviceRequest = opportunity?.service_request_id ? firstRow(await getJson(`service_request?id=eq.${encodeURIComponent(opportunity.service_request_id)}&select=id,requirements,created_at&limit=1`)) : null;
  const [customer, contact, location] = await Promise.all([
    conversion?.customer_id ? getJson(`customer?id=eq.${encodeURIComponent(conversion.customer_id)}&select=id,display_name&limit=1`).then(firstRow) : null,
    conversion?.contact_id ? getJson(`contact?id=eq.${encodeURIComponent(conversion.contact_id)}&select=id,first_name,last_name,email,phone&limit=1`).then(firstRow) : null,
    conversion?.service_location_id ? getJson(`service_location?id=eq.${encodeURIComponent(conversion.service_location_id)}&select=id,address_line1,address_line2,city,subdivision,postal_code,country_code,access_notes&limit=1`).then(firstRow) : null,
  ]);
  const booking = serviceRequest?.id ? firstRow(await getJson(`booking?service_request_id=eq.${encodeURIComponent(serviceRequest.id)}&select=id,requested_service_date,requested_arrival_window,service_package,frequency,currency_code,tax_name,tax_rate,estimated_subtotal,estimated_tax,estimated_total,pricing_snapshot&limit=1`)) : null;
  const cascade = buildDispatchCascade({ requirements: serviceRequest?.requirements, estimateScope: estimate?.scope_snapshot, booking, customer, contact, location, pricingSnapshot, quoteTitle: quoteVersion?.title });
  const scope = cascade.scope;
  const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  const customerName = customer?.display_name || contactName || serviceRequest?.requirements?.customer?.name || "Customer details unavailable";
  const serviceTier = quoteVersion?.title || "Service details unavailable";
  const city = location?.city || location?.subdivision || "Location unavailable";
  const locationLabel = location?.address_line1 ? `${city} / ${location.address_line1}` : city;
  const durationHours = resolveDurationHours(pricingSnapshot, scope);
  const crewSize = resolveCrewSize(pricingSnapshot, scope);
  return {
    ...handoff,
    dispatch_label: `${customerName} — ${serviceTier} — ${locationLabel} (${handoffIdSnippet(handoff.id)})`,
    customer_name: customerName,
    service_tier: serviceTier,
    location_label: locationLabel,
    requested_date: scope?.preferredDate || null,
    requested_window: scope?.preferredWindow || null,
    requested_start_local: resolveRequestedStart(scope?.preferredDate, scope?.preferredWindow, serviceRequest?.created_at || handoff.created_at),
    estimated_duration_hours: durationHours,
    crew_size: crewSize,
    suggested_timezone: timezoneForScope(scope, location),
    cascade,
  };
}

export async function fetchActiveDispatchPipeline() {
  const jobs = await getJson(["operational_job?select=id,job_handoff_id,operational_status,created_at", "operational_status=in.(ready_to_schedule,scheduled,dispatched,in_progress,service_complete,qa_pending,corrective_action_required)", "order=created_at.desc", "limit=50"].join("&"));
  if (!Array.isArray(jobs) || !jobs.length) return [];
  return Promise.all(jobs.map(async (job) => {
    try {
      const handoff = firstRow(await getJson(`job_handoff?id=eq.${encodeURIComponent(job.job_handoff_id)}&select=id,organization_id,business_unit_id,conversion_record_id,quote_version_id,pricing_snapshot_id,handoff_status,created_at&limit=1`));
      const enriched = handoff ? await enrichHandoffForDispatch(handoff) : null;
      const [scheduleWindow, workOrder, assignments] = await Promise.all([
        getJson(`schedule_window?operational_job_id=eq.${encodeURIComponent(job.id)}&select=scheduled_start,scheduled_end,timezone,status&order=created_at.desc&limit=1`).then(firstRow),
        getJson(`work_order?operational_job_id=eq.${encodeURIComponent(job.id)}&select=id,work_order_status,started_at,service_completed_at&order=created_at.desc&limit=1`).then(firstRow),
        getJson(`worker_assignment?operational_job_id=eq.${encodeURIComponent(job.id)}&select=worker_id,assignment_status&assignment_status=in.(assigned,acknowledged,in_progress,completed)&limit=20`),
      ]);
      const workerIds = Array.isArray(assignments) ? assignments.map((row) => row.worker_id).filter(Boolean) : [];
      const workers = workerIds.length ? await getJson(`worker?id=in.(${workerIds.join(",")})&select=id,display_name`) : [];
      return { ...job, ...enriched, schedule_window: scheduleWindow, work_order_id: workOrder?.id ?? null, work_order_status: workOrder?.work_order_status ?? null, started_at: workOrder?.started_at ?? null, service_completed_at: workOrder?.service_completed_at ?? null, worker_names: Array.isArray(workers) ? workers.map((row) => row.display_name).filter(Boolean).join(", ") : "" };
    } catch {
      return { ...job, dispatch_label: `Operational job ${handoffIdSnippet(job.id)}` };
    }
  }));
}
