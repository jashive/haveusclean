import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import { fetchEligibleJobHandoffs } from "./serviceosOperationsClient.js";
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

export function normalizeDispatchJob(row) {
  const windows = (row.schedule_window || []).filter((item) => ACTIVE_WINDOWS.has(item.status));
  const schedule = newest(windows, "scheduled_start") || newest(row.schedule_window, "scheduled_start");
  const workOrder = newest(row.work_order);
  const assignments = (row.worker_assignment || []).filter((item) => ACTIVE_ASSIGNMENTS.has(item.assignment_status));
  const workerNames = assignments.map((item) => related(item.worker)?.display_name).filter(Boolean);
  const { amount, currencyCode } = amountFrom(row);
  return {
    id: row.id,
    handoffId: row.job_handoff_id,
    operationalStatus: row.operational_status,
    serviceFamily: row.service_family,
    customerName: related(row.customer)?.display_name || "Customer unavailable",
    address: [related(row.service_location)?.address_line1, related(row.service_location)?.city, related(row.service_location)?.subdivision].filter(Boolean).join(", ") || "Address unavailable",
    scheduledStart: schedule?.scheduled_start ?? null,
    scheduledEnd: schedule?.scheduled_end ?? null,
    scheduleStatus: schedule?.status ?? null,
    workerNames,
    workOrderId: workOrder?.id ?? null,
    workOrderNumber: workOrder?.work_order_number ?? null,
    workOrderStatus: workOrder?.work_order_status ?? null,
    serviceCompletedAt: workOrder?.service_completed_at ?? null,
    totalAmount: amount,
    currencyCode,
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
    "id,job_handoff_id,operational_status,service_family,created_at",
    "customer:customer_id(display_name)",
    "service_location:service_location_id(address_line1,city,subdivision,postal_code)",
    "pricing_snapshot:pricing_snapshot_id(total_amount,currency_code)",
    "schedule_window(id,scheduled_start,scheduled_end,status,created_at)",
    "work_order(id,work_order_number,work_order_status,service_completed_at,created_at)",
    "worker_assignment(assignment_status,worker:worker_id(display_name))",
  ].join(",");
  const path = `operational_job?select=${select}&business_unit_id=eq.${encodeURIComponent(businessUnitId)}&order=created_at.desc&limit=${limit}`;
  const rows = await getJson(path);
  return (Array.isArray(rows) ? rows : []).map(normalizeDispatchJob);
}

export async function fetchUnscheduledDispatchHandoffs(businessUnitId) {
  const handoffs = await fetchEligibleJobHandoffs();
  const scoped = (Array.isArray(handoffs) ? handoffs : []).filter((row) => row.business_unit_id === businessUnitId);
  return Promise.all(scoped.map(async (row) => {
    try {
      const enriched = await enrichHandoffForDispatch(row);
      return { id: row.id, handoffId: row.id, customerName: enriched.customer_name, address: enriched.location_label, serviceFamily: enriched.service_tier, createdAt: row.created_at, scheduledStart: null, operationalStatus: "ready_to_schedule" };
    } catch {
      return { id: row.id, handoffId: row.id, customerName: "Accepted work", address: "Customer details unavailable", serviceFamily: "Service scope retained", createdAt: row.created_at, scheduledStart: null, operationalStatus: "ready_to_schedule" };
    }
  }));
}
