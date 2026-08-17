// ── Wave 6: Intelligence UI formatters ───────────────────────────────────────
//
// Pure display helpers. Never fabricate a value: an absent measurement renders
// as an explicit "no data" marker rather than 0, NaN, or a placeholder chart.

export const NO_DATA = "—";

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Formats a count value. Returns NO_DATA when the value is absent. */
export function formatCount(value) {
  if (!isNumeric(value)) return NO_DATA;
  return Math.round(value).toLocaleString("en-CA");
}

/** Formats a currency amount in the governed currency. */
export function formatCurrency(value, currency = "CAD") {
  if (!isNumeric(value)) return NO_DATA;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Formats a 0..1 ratio as a percentage. Null ratios render as NO_DATA. */
export function formatRate(value, fractionDigits = 1) {
  if (!isNumeric(value)) return NO_DATA;
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** Formats a KPI value according to its governed unit. */
export function formatKpiValue(value, unit, currency = "CAD") {
  if (value === null || value === undefined) return NO_DATA;
  if (unit === "ratio") return formatRate(value);
  if (unit === "currency") return formatCurrency(value, currency);
  return formatCount(value);
}

/** Explains why a rate has no value (zero denominator vs. real basis). */
export function describeRateBasis(numerator, denominator) {
  if (!isNumeric(denominator) || denominator === 0) {
    return "No denominator in period — rate not computable";
  }
  return `${formatCount(numerator)} of ${formatCount(denominator)}`;
}

/** ISO timestamp → readable timestamp in the governed timezone. */
export function formatTimestamp(value, timezone = "America/Toronto") {
  if (!value) return NO_DATA;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_DATA;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Relative freshness label for a source timestamp. */
export function formatFreshness(value, now = new Date()) {
  if (!value) return "Freshness unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Freshness unknown";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "Fresh (under a minute)";
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h old`;
  return `${Math.round(hours / 24)} d old`;
}

/** "service_request, quote_response" style lineage disclosure. */
export function formatLineage(sourceTables) {
  if (!Array.isArray(sourceTables) || sourceTables.length === 0) return "No source declared";
  return sourceTables.join(", ");
}

/** Human label for a snake_case status token. */
export function formatStatusLabel(status) {
  if (!status || typeof status !== "string") return NO_DATA;
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Domain grouping label. */
export function formatDomainLabel(domain) {
  const labels = {
    sales: "Sales",
    operations: "Operations",
    quality: "Quality",
    finance: "Finance",
  };
  return labels[domain] ?? formatStatusLabel(domain);
}

/** Colour tone token for a governed status (presentation only). */
export function statusTone(status) {
  const good = ["passed", "closed", "reconciled", "matched", "completed"];
  const risk = ["blocked", "discrepancy", "actions_open", "waived"];
  const active = ["ready", "in_review", "fallback_active", "reconciling", "validate", "approve"];
  if (good.includes(status)) return "good";
  if (risk.includes(status)) return "risk";
  if (active.includes(status)) return "active";
  return "neutral";
}

/** Error → safe display string (never leaks tokens or headers). */
export function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  const message = typeof error === "string" ? error : error.message;
  if (!message) return "Unknown error";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "[redacted]");
}
