import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import { fetchEligibleJobHandoffs } from "./serviceosOperationsClient.js";
import { enrichHandoffForDispatch, fetchActiveDispatchPipeline } from "./serviceosDispatchReadModel.js";
import { classifyFlightControlPipeline } from "./serviceosFlightControlClassification.js";

async function rpc(name, body) {
  const response = await authenticatedRestFetchWithRefresh(`rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response?.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response?.ok) throw new Error(data?.message || data?.error || `${name} failed.`);
  return Array.isArray(data) && name !== "get_qa_review_queue" ? data[0] : data;
}

export async function fetchFlightControlBoard({ organizationId, businessUnitId }) {
  const [rawHandoffs, rawPipeline, qaQueue, payables] = await Promise.all([
    fetchEligibleJobHandoffs(),
    fetchActiveDispatchPipeline(),
    rpc("get_qa_review_queue", { p_organization_id: organizationId, p_business_unit_id: businessUnitId, p_limit: 100 }),
    rpc("get_cleaner_payables_dashboard", { p_organization_id: organizationId, p_business_unit_id: businessUnitId, p_limit: 1000 }),
  ]);
  const scopedHandoffs = (Array.isArray(rawHandoffs) ? rawHandoffs : []).filter((row) => row.business_unit_id === businessUnitId);
  const inbound = await Promise.all(scopedHandoffs.map(async (row) => {
    try { return await enrichHandoffForDispatch(row); }
    catch { return { ...row, dispatch_label: "Accepted work awaiting customer detail recovery" }; }
  }));
  const pipeline = (Array.isArray(rawPipeline) ? rawPipeline : []).filter((row) => row.business_unit_id === businessUnitId);
  const classified = classifyFlightControlPipeline(pipeline);
  return {
    inbound: [
      ...inbound,
      ...classified.inbound,
    ],
    inFlight: classified.inFlight,
    qa: Array.isArray(qaQueue) ? qaQueue : [],
    settlement: (Array.isArray(payables?.rows) ? payables.rows : []).filter((row) => ["pending", "approved"].includes(row.status)),
    currencyCode: payables?.scope?.currency_code ?? null,
  };
}

export async function finalizeFlightControlQa({ inspectionId, outcome, score = 100, waiverReason }) {
  return rpc("staff_finalize_qa_inspection", {
    p_qa_inspection_id: inspectionId,
    p_outcome: outcome,
    p_score: outcome === "passed" ? score : null,
    p_findings: outcome === "passed" ? "QA review completed in Flight Control; no deficiencies found." : null,
    p_waiver_reason: outcome === "waived" ? waiverReason : null,
  });
}

export async function approveFlightControlPayable({ organizationId, businessUnitId, payableId }) {
  return rpc("staff_approve_contractor_payables", {
    p_organization_id: organizationId,
    p_business_unit_id: businessUnitId,
    p_payable_ids: [payableId],
    p_note: "Approved in ServiceOS Flight Control",
  });
}
