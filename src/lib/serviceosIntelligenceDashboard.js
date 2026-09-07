import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";

export async function fetchOs10IntelligenceDashboard({ organizationId, businessUnitId, dateFrom, dateTo }) {
  const response = await authenticatedRestFetchWithRefresh("rpc/get_os10_intelligence_dashboard", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_organization_id: organizationId, p_business_unit_id: businessUnitId, p_date_from: dateFrom, p_date_to: dateTo }),
  });
  const text = await response?.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response?.ok) throw new Error(data?.message || data?.error || "Intelligence dashboard could not be loaded.");
  return Array.isArray(data) ? data[0] : data;
}

export function isoDate(date) { return new Date(date).toISOString().slice(0, 10); }
