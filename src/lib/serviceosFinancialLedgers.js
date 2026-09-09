import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import { fetchFinancialPerformance } from "./serviceosFinancialPerformance.js";

async function rpc(name, body) {
  const response = await authenticatedRestFetchWithRefresh(`rpc/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await response?.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response?.ok) throw new Error(data?.message || data?.error || `${name} failed.`);
  return Array.isArray(data) ? data[0] : data;
}

async function workOrderNumbers(jobs) {
  const ids = jobs.map((job) => job.operational_job_id).filter(Boolean);
  if (!ids.length) return new Map();
  const encoded = encodeURIComponent(`(${ids.join(",")})`);
  const response = await authenticatedRestFetchWithRefresh(`work_order?select=id,operational_job_id,work_order_number&operational_job_id=in.${encoded}`);
  if (!response?.ok) return new Map();
  const rows = await response.json();
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.operational_job_id, row]));
}

export async function fetchFinancialLedgers({ organizationId, businessUnitId, periodStart, periodEnd }) {
  const [performance, payables] = await Promise.all([
    fetchFinancialPerformance({ organizationId, businessUnitId, periodStart, periodEnd }),
    rpc("get_cleaner_payables_dashboard", { p_organization_id: organizationId, p_business_unit_id: businessUnitId, p_limit: 1000 }),
  ]);
  const jobs = Array.isArray(performance?.jobs) ? performance.jobs : [];
  const workOrders = await workOrderNumbers(jobs);
  return {
    performance,
    payables,
    jobs: jobs.map((job) => ({ ...job, ...workOrders.get(job.operational_job_id) })),
  };
}

export function approveContractorPayable({ organizationId, businessUnitId, payableId }) {
  return rpc("staff_approve_contractor_payables", {
    p_organization_id: organizationId,
    p_business_unit_id: businessUnitId,
    p_payable_ids: [payableId],
    p_note: "Approved in Financial Ledgers workspace",
  });
}

export function outstandingPayables(payables) {
  return Number(payables?.pending_total || 0) + Number(payables?.approved_total || 0);
}

export function profitabilityTone(value) {
  if (value === null || value === undefined || value === "") return "neutral";
  const margin = Number(value);
  if (!Number.isFinite(margin)) return "neutral";
  if (margin >= 50) return "success";
  if (margin >= 30) return "warning";
  return "danger";
}
