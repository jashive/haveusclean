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

async function parseResponse(res) {
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Unable to save lead: ${res?.status ?? "network error"} ${text}`);
  }
  return res.json();
}

export function normalizeExternalSourceSystem(value) {
  const source = String(value || "").trim().toLowerCase();
  return source || null;
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
