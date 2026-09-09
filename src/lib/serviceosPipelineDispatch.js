import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import { createWorkerAssignment, fetchActiveWorkers, fetchEligibleJobHandoffs, updateWorkerAssignmentStatus } from "./serviceosOperationsClient.js";
import { enrichHandoffForDispatch } from "./serviceosDispatchReadModel.js";

const ACTIVE_ASSIGNMENTS = new Set(["assigned", "acknowledged", "in_progress", "completed"]);
const ACTIVE_WINDOWS = new Set(["planned", "confirmed", "dispatched", "fulfilled"]);

async function getJson(path) {
  const response = await authenticatedRestFetchWithRefresh(path);
  if (!response?.ok) throw new Error(`Dispatch workspace read failed: HTTP ${response?.status ?? "network"} ${await response?.text().catch(() => "")}`);
  return response.json();
}

function newest(rows, field = "created_at") {
  return [...(Array.isArray(rows) ? rows : rows ? [rows] : [])].sort((a, b) => String(b?.[field] || "").localeCompare(String(a?.[field] || "")))[0] ?? null;
}

function amountFrom(row) {
  const snapshot = row.pricing_snapshot;
  const pricing = Array.isArray(snapshot) ? snapshot[0] : snapshot;
  const amount = Number(pricing?.total_amount);
  return { amount: Number.isFinite(amount) ? amount : null, currencyCode: pricing?.currency_code ?? null };
}

function related(value) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

function scopeDetails(scope = {}) {
  const measurement = scope.measurements || scope.measurement_values || scope;
  const squareFeet = Number(measurement.sqft ?? measurement.square_feet ?? measurement.squareFeet ?? scope.facility_sqft);
  const serviceText = [scope.service_type, scope.service_family, scope.measurement_type, scope.scope_type].filter(Boolean).join(" ").toLowerCase();
  return { commercial: /commercial|janitorial|walkthrough|flat_walkthrough/.test(serviceText), squareFeet: Number.isFinite(squareFeet) && squareFeet > 0 ? squareFeet : null };
}

export function dispatchJobBadge(job) {
  return job?.isCommercial ? { label: "Commercial", tone: "commercial" } : { label: "Recurring", tone: "recurring" };
}

export function normalizeDispatchJob(row) {
  const windows = (row.schedule_window || []).filter((item) => ACTIVE_WINDOWS.has(item.status));
  const schedule = newest(windows, "scheduled_start") || newest(row.schedule_window, "scheduled_start");
  const workOrder = newest(row.work_order);
  const assignments = (row.worker_assignment || []).filter((item) => ACTIVE_ASSIGNMENTS.has(item.assignment_status));
  const workerNames = assignments.map((item) => related(item.worker)?.display_name).filter(Boolean);
  const { amount, currencyCode } = amountFrom(row);
  const scope = row.service_scope_snapshot || {};
  const details = scopeDetails(scope);
  return {
    id: row.id,
    organizationId: row.organization_id,
    businessUnitId: row.business_unit_id,
    handoffId: row.job_handoff_id,
    operationalStatus: row.operational_status,
    serviceFamily: row.service_family,
    customerName: related(row.customer)?.display_name || "Customer unavailable",
    address: [related(row.service_location)?.address_line1, related(row.service_location)?.city, related(row.service_location)?.subdivision].filter(Boolean).join(", ") || "Address unavailable",
    scheduledStart: schedule?.scheduled_start ?? null,
    scheduledEnd: schedule?.scheduled_end ?? null,
    scheduleStatus: schedule?.status ?? null,
    scheduleWindowId: schedule?.id ?? null,
    workerNames,
    workerId: assignments[0]?.worker_id ?? null,
    workerAssignmentIds: assignments.map((item) => item.id).filter(Boolean),
    workOrderId: workOrder?.id ?? null,
    workOrderNumber: workOrder?.work_order_number ?? null,
    workOrderStatus: workOrder?.work_order_status ?? null,
    serviceCompletedAt: workOrder?.service_completed_at ?? null,
    totalAmount: amount,
    currencyCode,
    isCommercial: details.commercial || /commercial|janitorial|walkthrough/.test(String(row.service_family || "").toLowerCase()),
    squareFeet: details.squareFeet,
    facilityContact: [related(row.contact)?.first_name, related(row.contact)?.last_name].filter(Boolean).join(" ") || null,
    cadence: scope.frequency || scope.cadence || null,
    createdAt: row.created_at,
  };
}

export function filterWorkOrderHistory(rows, query, status = "all") {
  const needle = String(query || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    const matchesStatus = status === "all" || row.operationalStatus === status || row.workOrderStatus === status;
    const haystack = [row.customerName, row.address, row.workOrderNumber, row.serviceFamily, ...row.workerNames].join(" ").toLowerCase();
    return matchesStatus && (!needle || haystack.includes(needle));
  });
}

export async function fetchPipelineDispatchJobs({ businessUnitId, limit = 250 }) {
  if (!businessUnitId) return [];
  const select = [
    "id,organization_id,business_unit_id,job_handoff_id,operational_status,service_family,created_at",
    "customer:customer_id(display_name)",
    "service_location:service_location_id(address_line1,city,subdivision,postal_code)",
    "pricing_snapshot:pricing_snapshot_id(total_amount,currency_code)",
    "service_scope_snapshot",
    "contact:contact_id(first_name,last_name)",
    "schedule_window(id,scheduled_start,scheduled_end,status,created_at)",
    "work_order(id,work_order_number,work_order_status,service_completed_at,created_at)",
    "worker_assignment(id,worker_id,assignment_status,worker:worker_id(display_name))",
  ].join(",");
  const path = `operational_job?select=${select}&business_unit_id=eq.${encodeURIComponent(businessUnitId)}&order=created_at.desc&limit=${limit}`;
  const rows = await getJson(path);
  return (Array.isArray(rows) ? rows : []).map(normalizeDispatchJob);
}

async function patch(path, body) {
  const response = await authenticatedRestFetchWithRefresh(path, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!response?.ok) throw new Error(`Dispatch assignment update failed: HTTP ${response?.status ?? "network"}`);
  return response.json();
}

export { fetchActiveWorkers };

export async function updateScheduledDispatchAssignment({ job, workerId, scheduledStart, scheduledEnd, appUserId }) {
  if (!job?.scheduleWindowId || !workerId || !scheduledStart || !scheduledEnd) throw new Error("Schedule, time window, and contractor are required.");
  if (new Date(scheduledEnd) <= new Date(scheduledStart)) throw new Error("The assignment end must be after its start.");
  await patch(`schedule_window?id=eq.${encodeURIComponent(job.scheduleWindowId)}`, { scheduled_start: new Date(scheduledStart).toISOString(), scheduled_end: new Date(scheduledEnd).toISOString(), updated_by_app_user_id: appUserId });
  if (workerId !== job.workerId) {
    for (const assignmentId of job.workerAssignmentIds || []) await updateWorkerAssignmentStatus(assignmentId, "released", "Reassigned in Pipeline & Dispatch", appUserId);
    const assignment = await createWorkerAssignment({ organization_id: job.organizationId, business_unit_id: job.businessUnitId, operational_job_id: job.id, schedule_window_id: job.scheduleWindowId, worker_id: workerId, assignment_role: "service_worker", assignment_status: "proposed", metadata: { source: "pipeline_dispatch_workspace", synthetic: false }, created_by_app_user_id: appUserId, updated_by_app_user_id: appUserId });
    await updateWorkerAssignmentStatus(assignment.id, "assigned", null, appUserId);
  }
  return { scheduledStart, scheduledEnd, workerId };
}

export async function fetchUnscheduledDispatchHandoffs(businessUnitId) {
  const handoffs = await fetchEligibleJobHandoffs();
  const scoped = (Array.isArray(handoffs) ? handoffs : []).filter((row) => row.business_unit_id === businessUnitId);
  return Promise.all(scoped.map(async (row) => {
    try {
      const enriched = await enrichHandoffForDispatch(row);
      const scope = enriched.cascade?.scope || {};
      const details = scopeDetails(scope);
      return { id: row.id, handoffId: row.id, customerName: enriched.customer_name, address: enriched.location_label, serviceFamily: enriched.service_tier, createdAt: row.created_at, scheduledStart: null, operationalStatus: "ready_to_schedule", isCommercial: details.commercial || /commercial|janitorial|walkthrough/.test(String(enriched.service_tier || "").toLowerCase()), squareFeet: details.squareFeet, facilityContact: enriched.cascade?.contact?.display_name || enriched.cascade?.contact?.name || null, cadence: scope.frequency || scope.cadence || null };
    } catch {
      return { id: row.id, handoffId: row.id, customerName: "Accepted work", address: "Customer details unavailable", serviceFamily: "Service scope retained", createdAt: row.created_at, scheduledStart: null, operationalStatus: "ready_to_schedule" };
    }
  }));
}
