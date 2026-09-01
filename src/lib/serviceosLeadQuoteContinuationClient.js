import { authenticatedRestFetch } from "./serviceosAuthClient.js";

function assertId(value, label) {
  if (!value) throw new Error(`${label} is required for quote continuation.`);
}

async function patchOne(table, id, patch, accessToken) {
  assertId(id, `${table} id`);
  const res = await authenticatedRestFetch(`${table}?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Quote continuation update failed on ${table}: ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || row.id !== id) {
    throw new Error(`Quote continuation could not verify ${table} ${id} after update.`);
  }
  return row;
}

export async function saveExistingLeadDetails({ serviceRequest, requirements, metadata, appUserId, businessUnitId, accessToken }) {
  assertId(serviceRequest?.id, "Service request");
  if (serviceRequest.business_unit_id !== businessUnitId) throw new Error("Selected lead does not belong to the active business unit.");
  if (!["intake", "qualified"].includes(serviceRequest.lifecycle_status)) {
    throw new Error(`Only intake/qualified leads can save lead details; current status is ${serviceRequest.lifecycle_status || "unknown"}.`);
  }
  return patchOne("service_request", serviceRequest.id, {
    requirements,
    description: requirements?.scope?.notes || null,
    metadata: { ...(serviceRequest.metadata || {}), ...(metadata || {}), partial_intake: true },
    updated_by_app_user_id: appUserId || null,
  }, accessToken);
}

export async function promoteExistingLeadForQuote({
  serviceRequest,
  opportunity,
  requirements,
  metadata,
  title,
  summary,
  appUserId,
  businessUnitId,
  accessToken,
}) {
  assertId(serviceRequest?.id, "Service request");
  assertId(opportunity?.id, "Opportunity");
  if (serviceRequest.business_unit_id !== businessUnitId || opportunity.business_unit_id !== businessUnitId) {
    throw new Error("Selected lead does not belong to the active business unit.");
  }
  if (!["intake", "qualified"].includes(serviceRequest.lifecycle_status)) {
    throw new Error(`Only intake/qualified leads can continue to quote; current status is ${serviceRequest.lifecycle_status || "unknown"}.`);
  }
  if (!["open", "proposal"].includes(opportunity.stage)) {
    throw new Error(`Only open/proposal opportunities can continue to quote; current stage is ${opportunity.stage || "unknown"}.`);
  }

  const mergedMetadata = {
    ...(serviceRequest.metadata || {}),
    ...(metadata || {}),
    partial_intake: false,
    quote_ready: true,
    continued_from_partial_intake: true,
  };

  const updatedServiceRequest = await patchOne("service_request", serviceRequest.id, {
    lifecycle_status: "qualified",
    title,
    description: requirements?.scope?.notes || null,
    requirements,
    metadata: mergedMetadata,
    updated_by_app_user_id: appUserId || null,
  }, accessToken);

  const updatedOpportunity = await patchOne("opportunity", opportunity.id, {
    stage: "proposal",
    title,
    summary,
    metadata: { ...(opportunity.metadata || {}), ...mergedMetadata },
    updated_by_app_user_id: appUserId || null,
  }, accessToken);

  return { serviceRequest: updatedServiceRequest, opportunity: updatedOpportunity };
}
