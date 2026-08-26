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

async function parseResponse(res, label = "Unable to save lead") {
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`${label}: ${res?.status ?? "network error"} ${text}`);
  }
  return res.json();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeExternalSourceSystem(value) {
  const source = String(value || "").trim().toLowerCase();
  return source || null;
}

export async function listRecentInboundLeads({ accessToken, organizationId, businessUnitId, limit = 25 }) {
  assertRevenueEnabled();
  if (!organizationId || !businessUnitId) throw new Error("Organization and business unit are required");
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const requestQuery = [
    `organization_id=eq.${encodeURIComponent(organizationId)}`,
    `business_unit_id=eq.${encodeURIComponent(businessUnitId)}`,
    `lifecycle_status=${encodeURIComponent("in.(intake,qualified)")}`,
    `select=${encodeURIComponent("id,title,lifecycle_status,requirements,metadata,customer_id,contact_id,service_location_id,created_at,updated_at")}`,
    "order=created_at.desc",
    `limit=${safeLimit}`,
  ].join("&");
  const requestRes = await authenticatedRestFetch(`service_request?${requestQuery}`, accessToken);
  const serviceRequests = await parseResponse(requestRes, "Unable to load recent leads");
  if (!Array.isArray(serviceRequests) || serviceRequests.length === 0) return [];

  const requestIds = unique(serviceRequests.map((row) => row.id));
  const opportunityQuery = [
    `organization_id=eq.${encodeURIComponent(organizationId)}`,
    `business_unit_id=eq.${encodeURIComponent(businessUnitId)}`,
    `service_request_id=${encodeURIComponent(`in.(${requestIds.join(",")})`)}`,
    `select=${encodeURIComponent("id,service_request_id,stage,title,summary,metadata,created_at,updated_at")}`,
    "order=created_at.desc",
  ].join("&");
  const opportunityRes = await authenticatedRestFetch(`opportunity?${opportunityQuery}`, accessToken);
  const opportunities = await parseResponse(opportunityRes, "Unable to load recent lead opportunities");
  const opportunityByServiceRequest = new Map();
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    if (!opportunityByServiceRequest.has(opportunity.service_request_id)) {
      opportunityByServiceRequest.set(opportunity.service_request_id, opportunity);
    }
  }

  return serviceRequests
    .map((serviceRequest) => ({
      created: false,
      restored_from_canonical_store: true,
      service_request: serviceRequest,
      opportunity: opportunityByServiceRequest.get(serviceRequest.id) || null,
      duplicate_review_required: false,
    }))
    .filter((row) => row.opportunity?.id);
}

export async function savePartialInboundLead({
  accessToken,
  organizationId,
  businessUnitId,
  serviceCategory = "residential",
  intakeChannel = "office_manual",
  leadSource,
  externalSourceSystem,
  externalSourceId,
  customerName,
  customerPhone,
  customerEmail,
  addressLine1,
  city,
  postalCode,
  propertyType,
  bedrooms,
  bathrooms,
  squareFeet,
  cleanType,
  frequency,
  preferredDate,
  preferredTime,
  notes,
  metadata = {},
}) {
  assertRevenueEnabled();
  if (!organizationId || !businessUnitId) throw new Error("Organization and business unit are required");
  if (!String(customerName || "").trim() && !String(customerPhone || "").trim() && !String(customerEmail || "").trim() && !String(externalSourceId || "").trim()) {
    throw new Error("Enter at least a name, phone, email, or external lead/reference ID.");
  }

  const res = await authenticatedRestFetch("rpc/record_inbound_lead", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_business_unit_id: businessUnitId,
      p_service_category: serviceCategory,
      p_intake_channel: intakeChannel,
      p_lead_source: leadSource || null,
      p_external_source_system: normalizeExternalSourceSystem(externalSourceSystem),
      p_external_source_id: String(externalSourceId || "").trim() || null,
      p_customer_name: String(customerName || "").trim() || null,
      p_customer_phone: String(customerPhone || "").trim() || null,
      p_customer_email: String(customerEmail || "").trim() || null,
      p_address_line1: String(addressLine1 || "").trim() || null,
      p_city: String(city || "").trim() || null,
      p_postal_code: String(postalCode || "").trim() || null,
      p_property_type: String(propertyType || "").trim() || null,
      p_bedrooms: bedrooms === "" || bedrooms == null ? null : Number(bedrooms),
      p_bathrooms: bathrooms === "" || bathrooms == null ? null : Number(bathrooms),
      p_square_feet: squareFeet === "" || squareFeet == null ? null : Number(squareFeet),
      p_clean_type: String(cleanType || "").trim() || null,
      p_frequency: String(frequency || "").trim() || null,
      p_preferred_date: String(preferredDate || "").trim() || null,
      p_preferred_time: String(preferredTime || "").trim() || null,
      p_notes: String(notes || "").trim() || null,
      p_metadata: metadata || {},
    }),
  });
  return parseResponse(res);
}
