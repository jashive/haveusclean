import { authenticatedRestFetch } from "./serviceosAuthClient.js";

function assertRevenueEnabled() {
  let enabled = false;
  try {
    enabled = (typeof import.meta !== "undefined" ? import.meta.env?.VITE_SERVICEOS_REVENUE_ENABLED : "") === "true";
  } catch {
    enabled = false;
  }
  if (!enabled) throw new Error("ServiceOS revenue feature is disabled");
}

async function parseResponse(res, label) {
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`${label}: ${res?.status ?? "network error"} ${text}`);
  }
  return res.json();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inFilter(values) {
  return encodeURIComponent(`in.(${unique(values).join(",")})`);
}

async function fetchScopedRows({ accessToken, table, organizationId, businessUnitId, ids, select }) {
  const scopedIds = unique(ids);
  if (scopedIds.length === 0) return [];
  const query = [
    `organization_id=eq.${encodeURIComponent(organizationId)}`,
    `business_unit_id=eq.${encodeURIComponent(businessUnitId)}`,
    `id=${inFilter(scopedIds)}`,
    `select=${encodeURIComponent(select)}`,
  ].join("&");
  const res = await authenticatedRestFetch(`${table}?${query}`, accessToken);
  const rows = await parseResponse(res, `Unable to load ${table}`);
  return Array.isArray(rows) ? rows : [];
}

export const CUSTOMER_RESPONSE_OPTIONS = [
  { value: "accepted", label: "Accepted", converts: true },
  { value: "declined", label: "Declined", converts: false },
  { value: "requested_changes", label: "Needs Changes", converts: false },
  { value: "follow_up_required", label: "Follow-Up Required", converts: false },
  { value: "no_response", label: "No Response", converts: false },
];

export function responseCreatesConversion(responseType) {
  return responseType === "accepted";
}

export function serviceRequestHasCanonicalIdentity(serviceRequest) {
  return Boolean(
    serviceRequest?.customer_id &&
    serviceRequest?.contact_id &&
    serviceRequest?.service_location_id
  );
}

export async function listSentQuoteVersions({ accessToken, organizationId, businessUnitId }) {
  assertRevenueEnabled();
  if (!organizationId || !businessUnitId) throw new Error("Organization and business unit are required");

  const quoteVersionQuery = [
    `organization_id=eq.${encodeURIComponent(organizationId)}`,
    `business_unit_id=eq.${encodeURIComponent(businessUnitId)}`,
    "lifecycle_status=eq.sent",
    `select=${encodeURIComponent("id,title,sent_at,quote_id,pricing_snapshot_id,commercial_snapshot,line_items_snapshot")}`,
    "order=sent_at.desc",
    "limit=50",
  ].join("&");

  const quoteVersionRes = await authenticatedRestFetch(`quote_version?${quoteVersionQuery}`, accessToken);
  const quoteVersions = await parseResponse(quoteVersionRes, "Unable to load sent quotes");
  if (!Array.isArray(quoteVersions) || quoteVersions.length === 0) return [];

  const quotes = await fetchScopedRows({ accessToken, table: "quote", organizationId, businessUnitId, ids: quoteVersions.map((row) => row.quote_id), select: "id,opportunity_id" });
  const quoteById = new Map(quotes.map((row) => [row.id, row]));
  const opportunities = await fetchScopedRows({ accessToken, table: "opportunity", organizationId, businessUnitId, ids: quotes.map((row) => row.opportunity_id), select: "id,service_request_id" });
  const opportunityById = new Map(opportunities.map((row) => [row.id, row]));
  const serviceRequests = await fetchScopedRows({ accessToken, table: "service_request", organizationId, businessUnitId, ids: opportunities.map((row) => row.service_request_id), select: "id,title,requirements,customer_id,contact_id,service_location_id" });
  const serviceRequestById = new Map(serviceRequests.map((row) => [row.id, row]));

  return quoteVersions.map((quoteVersion) => {
    const quote = quoteById.get(quoteVersion.quote_id) || null;
    const opportunity = quote ? opportunityById.get(quote.opportunity_id) || null : null;
    const serviceRequest = opportunity ? serviceRequestById.get(opportunity.service_request_id) || null : null;
    return {
      ...quoteVersion,
      quote: quote ? { ...quote, opportunity: opportunity ? { ...opportunity, service_request: serviceRequest } : null } : null,
    };
  });
}

export async function recordCustomerResponse({ accessToken, quoteVersionId, responseType, responseChannel = "serviceos_office_ui", respondedByName, respondedByEmail, notes, customerName, customerEmail, customerPhone, addressLine1, city, postalCode, jurisdictionId, metadata = {} }) {
  assertRevenueEnabled();
  if (!quoteVersionId) throw new Error("Quote version is required");
  if (!CUSTOMER_RESPONSE_OPTIONS.some((item) => item.value === responseType)) throw new Error("Choose a supported customer response");
  const payload = {
    p_quote_version_id: quoteVersionId,
    p_response_type: responseType,
    p_response_channel: responseChannel,
    p_responded_by_name: respondedByName || null,
    p_responded_by_email: respondedByEmail || null,
    p_notes: notes || null,
    p_customer_name: customerName || null,
    p_customer_email: customerEmail || null,
    p_customer_phone: customerPhone || null,
    p_address_line1: addressLine1 || null,
    p_city: city || null,
    p_postal_code: postalCode || null,
    p_jurisdiction_id: jurisdictionId || null,
    p_metadata: metadata || {},
  };
  const res = await authenticatedRestFetch("rpc/record_quote_response_and_convert", accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return parseResponse(res, "Unable to record customer response");
}
