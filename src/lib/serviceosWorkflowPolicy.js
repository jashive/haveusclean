const OFFICE = new Set(["owner_admin", "office_ops"]);
export const WORKER_EVENTS = Object.freeze(["acknowledged", "started", "checklist_updated", "evidence_added", "completed"]);

export function authorizeOperation({ identity, action, resource }) {
  if (!identity || !resource || resource.organization_id !== resource.identity_organization_id || !identity.allowedBusinessUnitIds.includes(resource.business_unit_id)) throw new Error("resource is outside canonical scope");
  if (["schedule", "assign", "dispatch", "job_transition"].includes(action)) return OFFICE.has(identity.role);
  if (WORKER_EVENTS.includes(action)) return identity.role === "worker" && identity.worker?.id === resource.assigned_worker_id;
  if (["qa_pass", "qa_fail"].includes(action)) return identity.role === "qa" && resource.qa_eligible === true;
  if (action === "corrective_action") return identity.role === "qa" && resource.qa_status === "failed";
  return false;
}

export function assertOperation(input) {
  if (!authorizeOperation(input)) throw new Error(`operation ${input.action} is not authorized`);
  return true;
}
