// ── Wave 5: ServiceOS Finance Client ─────────────────────────────────────────
//
// Feature-flagged canonical REST client for the Wave 5 finance pipeline.
// All functions are HARD no-ops when VITE_SERVICEOS_FINANCE_ENABLED !== "true".
//
// Wave 5 tables:
//   billing_readiness_gate, invoice_request, accounting_sync_outbox,
//   payment_observation, contractor_compensation_version,
//   contractor_payable, job_profitability_snapshot

import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";

// ── Feature guard ─────────────────────────────────────────────────────────────

function isFinanceEnabled() {
  try {
    return (
      (typeof import.meta !== "undefined"
        ? import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED
        : "") === "true"
    );
  } catch {
    return false;
  }
}

function assertEnabled() {
  if (!isFinanceEnabled()) {
    throw new Error(
      "ServiceOS finance feature is disabled (VITE_SERVICEOS_FINANCE_ENABLED is not true)"
    );
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────

async function insertOne(table, payload, _accessToken) {
  const res = await authenticatedRestFetchWithRefresh(table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Finance insert failed on ${table}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateById(table, id, patch, _accessToken) {
  const res = await authenticatedRestFetchWithRefresh(
    `${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    }
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Finance update failed on ${table} id=${id}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function fetchOneById(table, id, _accessToken) {
  const res = await authenticatedRestFetchWithRefresh(
    `${table}?id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Finance fetch failed on ${table} id=${id}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}

async function fetchMany(table, filter, _accessToken) {
  const qs = filter ? `?${filter}` : "";
  const res = await authenticatedRestFetchWithRefresh(`${table}${qs}`);
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Finance fetchMany failed on ${table}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  return res.json();
}

// ── Billing Readiness Gate ────────────────────────────────────────────────────

export async function createBillingReadinessGate(payload, accessToken) {
  assertEnabled();
  return insertOne("billing_readiness_gate", payload, accessToken);
}

export async function updateBillingReadinessGate(id, patch, accessToken) {
  assertEnabled();
  return updateById("billing_readiness_gate", id, patch, accessToken);
}

export async function fetchBillingReadinessGateByJobId(operationalJobId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "billing_readiness_gate",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchBillingReadinessGateById(id, accessToken) {
  assertEnabled();
  return fetchOneById("billing_readiness_gate", id, accessToken);
}

// ── Invoice Request ───────────────────────────────────────────────────────────

export async function createInvoiceRequest(payload, accessToken) {
  assertEnabled();
  return insertOne("invoice_request", payload, accessToken);
}

export async function updateInvoiceRequest(id, patch, accessToken) {
  assertEnabled();
  return updateById("invoice_request", id, patch, accessToken);
}

export async function fetchInvoiceRequestByJobId(operationalJobId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "invoice_request",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.desc&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchInvoiceRequestById(id, accessToken) {
  assertEnabled();
  return fetchOneById("invoice_request", id, accessToken);
}

// ── Accounting Sync Outbox ────────────────────────────────────────────────────

export async function createAccountingSyncOutbox(payload, accessToken) {
  assertEnabled();
  return insertOne("accounting_sync_outbox", payload, accessToken);
}

export async function updateAccountingSyncOutbox(id, patch, accessToken) {
  assertEnabled();
  return updateById("accounting_sync_outbox", id, patch, accessToken);
}

export async function fetchAccountingSyncOutboxByIdempotencyKey(idempotencyKey, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "accounting_sync_outbox",
    `idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchAccountingSyncOutboxById(id, accessToken) {
  assertEnabled();
  return fetchOneById("accounting_sync_outbox", id, accessToken);
}

// ── Payment Observation ────────────────────────────────────────────────────────

export async function createPaymentObservation(payload, accessToken) {
  assertEnabled();
  return insertOne("payment_observation", payload, accessToken);
}

export async function fetchPaymentObservationsByInvoiceRequestId(invoiceRequestId, accessToken) {
  assertEnabled();
  return fetchMany(
    "payment_observation",
    `invoice_request_id=eq.${encodeURIComponent(invoiceRequestId)}&order=observed_at.desc`,
    accessToken
  );
}

export async function fetchPaymentObservationByProviderEvent(provider, providerEventId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "payment_observation",
    `provider=eq.${encodeURIComponent(provider)}&provider_event_id=eq.${encodeURIComponent(providerEventId)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

// ── Contractor Compensation Version ───────────────────────────────────────────

export async function createContractorCompensationVersion(payload, accessToken) {
  assertEnabled();
  return insertOne("contractor_compensation_version", payload, accessToken);
}

export async function updateContractorCompensationVersion(id, patch, accessToken) {
  assertEnabled();
  return updateById("contractor_compensation_version", id, patch, accessToken);
}

export async function fetchActiveCompensationVersionForWorker(workerId, organizationId, serviceFamily, accessToken) {
  assertEnabled();
  let filter = `worker_id=eq.${encodeURIComponent(workerId)}&organization_id=eq.${encodeURIComponent(organizationId)}&compensation_status=eq.active&order=effective_from.desc&limit=1`;
  if (serviceFamily) {
    filter += `&service_family=eq.${encodeURIComponent(serviceFamily)}`;
  }
  const rows = await fetchMany("contractor_compensation_version", filter, accessToken);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchContractorCompensationVersionById(id, accessToken) {
  assertEnabled();
  return fetchOneById("contractor_compensation_version", id, accessToken);
}

// ── Contractor Payable ─────────────────────────────────────────────────────────

export async function createContractorPayable(payload, accessToken) {
  assertEnabled();
  return insertOne("contractor_payable", payload, accessToken);
}

export async function updateContractorPayable(id, patch, accessToken) {
  assertEnabled();
  return updateById("contractor_payable", id, patch, accessToken);
}

export async function fetchContractorPayablesByJobId(operationalJobId, accessToken) {
  assertEnabled();
  return fetchMany(
    "contractor_payable",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.desc`,
    accessToken
  );
}

export async function fetchContractorPayableById(id, accessToken) {
  assertEnabled();
  return fetchOneById("contractor_payable", id, accessToken);
}

// ── Job Profitability Snapshot ─────────────────────────────────────────────────

export async function createJobProfitabilitySnapshot(payload, accessToken) {
  assertEnabled();
  return insertOne("job_profitability_snapshot", payload, accessToken);
}

export async function updateJobProfitabilitySnapshot(id, patch, accessToken) {
  assertEnabled();
  return updateById("job_profitability_snapshot", id, patch, accessToken);
}

export async function fetchJobProfitabilitySnapshotByJobId(operationalJobId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "job_profitability_snapshot",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=snapshot_taken_at.desc,created_at.desc&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
