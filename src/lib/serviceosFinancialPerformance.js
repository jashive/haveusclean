import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";

export const MARKET_CURRENCY = Object.freeze({ "HUC-ON": "CAD", "HUC-AZ": "USD" });

export function formatFinancialAmount(value, currencyCode) {
  if (!MARKET_CURRENCY["HUC-ON"] || !["CAD", "USD"].includes(currencyCode)) return "Unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  return new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).format(amount);
}

export function formatContributionMargin(value) {
  if (value === null || value === undefined || value === "") return "No governed data";
  const margin = Number(value);
  return Number.isFinite(margin) ? `${margin.toFixed(1)}%` : "No governed data";
}

export async function fetchFinancialPerformance({ organizationId, businessUnitId, periodStart, periodEnd }) {
  const response = await authenticatedRestFetchWithRefresh("rpc/get_financial_performance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_business_unit_id: businessUnitId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    }),
  });
  const text = await response?.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response?.ok) throw new Error(data?.message || data?.error || "Financial performance could not be loaded.");
  return Array.isArray(data) ? data[0] : data;
}
