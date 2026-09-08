export function classifyFlightControlPipeline(pipeline) {
  const rows = Array.isArray(pipeline) ? pipeline : [];
  return {
    inbound: rows.filter((row) => ["ready_to_schedule", "scheduled"].includes(row.operational_status)),
    inFlight: rows.filter((row) => ["dispatched", "in_progress"].includes(row.operational_status)),
  };
}
