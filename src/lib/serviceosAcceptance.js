const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCENARIO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ACCEPTANCE_STAGES = Object.freeze(["pricing", "request", "opportunity", "estimate", "quote", "response", "customer", "contact", "location", "conversion", "handoff"]);

export function createAcceptanceEnvelope({ acceptanceMode, runId, scenario, organizationId, businessUnitId }) {
  if (acceptanceMode !== true) throw new Error("controlled acceptance mode is required");
  if (!UUID.test(runId)) throw new Error("acceptance run id must be a UUID");
  if (!SCENARIO.test(scenario)) throw new Error("scenario must be strict kebab-case");
  if (!UUID.test(organizationId) || !UUID.test(businessUnitId)) throw new Error("canonical organization and business unit UUIDs are required");
  return Object.freeze({ acceptance: true, runId, scenario, runName: `TEST-W6-${scenario}-${runId}`, organizationId, businessUnitId });
}

export function propagateAcceptanceEnvelope(record, envelope) {
  return { ...record, metadata: { ...(record.metadata ?? {}), serviceosAcceptance: envelope } };
}

export function assertCleanupOwnership(envelope, candidate) {
  const owned = envelope?.acceptance === true && candidate?.metadata?.serviceosAcceptance?.runId === envelope.runId && candidate.metadata.serviceosAcceptance.runName === envelope.runName && candidate.organization_id === envelope.organizationId && candidate.business_unit_id === envelope.businessUnitId;
  if (!owned) throw new Error("cleanup candidate is not owned by this exact acceptance run");
  return true;
}
