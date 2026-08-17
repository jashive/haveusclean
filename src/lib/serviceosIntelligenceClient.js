// ── Wave 6: ServiceOS Intelligence / Governance / Continuity Client ──────────
//
// Canonical Supabase REST client for the Wave 6 tables created in
// migration 014_wave6_intelligence_governance_continuity.sql.
//
// Rules:
//   - every request goes through authenticatedRestFetchWithRefresh (user JWT)
//   - no service-role key is ever referenced, imported, or serialized here
//   - fail closed: any non-OK response throws a descriptive error
//   - no token, header, or session value is ever logged
//
// Wave 6 tables:
//   kpi_definition, kpi_snapshot, management_review, change_control_record,
//   dependency_edge, continuity_session, continuity_transaction,
//   service_module_profile, release_gate
// Wave 6 view:
//   wave6_canonical_event

import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";
import {
  computeKpiValue,
  resolveContinuityReconciliation,
  traverseDependencyImpact,
  canTransitionCcr,
  canTransitionContinuity,
  canTransitionManagementReview,
  isValidOfflineCorrelationId,
  getKpiSpec,
} from "./serviceosIntelligenceUtils.js";

// ── Feature guard ────────────────────────────────────────────────────────────

export function isIntelligenceEnabled() {
  try {
    return (
      (typeof import.meta !== "undefined"
        ? import.meta.env?.VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED
        : "") === "true"
    );
  } catch {
    return false;
  }
}

function assertEnabled() {
  if (!isIntelligenceEnabled()) {
    throw new Error(
      "ServiceOS Wave 6 intelligence is disabled (VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED is not true)"
    );
  }
}

function requireValue(value, label) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Wave 6: ${label} is required`);
  }
  return value;
}

function eq(column, value) {
  return `${column}=eq.${encodeURIComponent(value)}`;
}

// ── REST primitives ──────────────────────────────────────────────────────────

async function failure(resource, res) {
  const detail = await res?.text().catch(() => "");
  throw new Error(
    `Wave 6 request failed on ${resource}: HTTP ${res?.status ?? "network error"} ${detail}`.trim()
  );
}

async function selectRows(resource, query) {
  const path = query ? `${resource}?${query}` : resource;
  const res = await authenticatedRestFetchWithRefresh(path);
  if (!res || !res.ok) return failure(resource, res);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function insertRow(resource, payload) {
  const res = await authenticatedRestFetchWithRefresh(resource, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res || !res.ok) return failure(resource, res);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error(`Wave 6 insert on ${resource} returned no row — treating as failure`);
  }
  return row;
}

async function patchRowById(resource, id, patch) {
  requireValue(id, `${resource} id`);
  if (!patch || Object.keys(patch).length === 0) {
    throw new Error(`Wave 6: empty patch rejected for ${resource}`);
  }
  const res = await authenticatedRestFetchWithRefresh(`${resource}?${eq("id", id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res || !res.ok) return failure(resource, res);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error(
      `Wave 6 update on ${resource} id=${id} matched no row — RLS or id mismatch`
    );
  }
  return row;
}

function periodFilters({ periodType, periodStart, periodEnd }) {
  const filters = [];
  if (periodType) filters.push(eq("period_type", periodType));
  if (periodStart) filters.push(`period_start=gte.${encodeURIComponent(periodStart)}`);
  if (periodEnd) filters.push(`period_end=lte.${encodeURIComponent(periodEnd)}`);
  return filters;
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// ── KPI definitions ──────────────────────────────────────────────────────────

export async function loadKpiDefinitions(session, { organizationId } = {}) {
  assertEnabled();
  const filters = ["select=*", "active=eq.true", "order=domain.asc,code.asc"];
  if (organizationId) {
    filters.push(`or=(organization_id.is.null,organization_id.eq.${encodeURIComponent(organizationId)})`);
  }
  return selectRows("kpi_definition", filters.join("&"));
}

// ── KPI source data + computation ────────────────────────────────────────────

const KPI_SOURCE_QUERIES = {
  "sales.leads_created": [{ table: "service_request", timestampColumn: "created_at" }],
  "sales.opportunities_created": [{ table: "opportunity", timestampColumn: "created_at" }],
  "sales.quotes_created": [{ table: "quote", timestampColumn: "created_at" }],
  "sales.quotes_accepted": [{ table: "quote_response", timestampColumn: "created_at" }],
  "sales.conversions": [{ table: "conversion_record", timestampColumn: "created_at" }],
  "sales.lead_to_conversion_rate": [
    { table: "conversion_record", timestampColumn: "created_at" },
    { table: "service_request", timestampColumn: "created_at" },
  ],
  "operations.jobs_created": [{ table: "operational_job", timestampColumn: "created_at" }],
  "operations.work_completed": [{ table: "work_order", timestampColumn: "updated_at" }],
  "quality.qa_inspections": [{ table: "qa_inspection", timestampColumn: "created_at" }],
  "quality.qa_pass_rate": [{ table: "qa_inspection", timestampColumn: "created_at" }],
  "quality.exceptions_opened": [{ table: "service_exception", timestampColumn: "reported_at" }],
  "quality.reclean_requests": [{ table: "customer_outcome", timestampColumn: "reported_at" }],
  "finance.invoice_subtotal_requested": [
    { table: "invoice_request", timestampColumn: "created_at" },
  ],
  "finance.payments_observed": [{ table: "payment_observation", timestampColumn: "observed_at" }],
  "finance.contractor_payable_approved": [
    { table: "contractor_payable", timestampColumn: "created_at" },
  ],
  "finance.recognized_revenue": [
    { table: "job_profitability_snapshot", timestampColumn: "snapshot_taken_at" },
  ],
  "finance.gross_contribution": [
    { table: "job_profitability_snapshot", timestampColumn: "snapshot_taken_at" },
  ],
  "finance.gross_margin": [
    { table: "job_profitability_snapshot", timestampColumn: "snapshot_taken_at" },
  ],
};

/** Returns the source table names a KPI reads from (lineage disclosure). */
export function getKpiSourceTables(kpiCode) {
  return (KPI_SOURCE_QUERIES[kpiCode] ?? []).map((source) => source.table);
}

/**
 * Loads the raw canonical rows a KPI is derived from, scoped to org/BU and
 * bounded by the governed period. Returns { [table]: rows[] }.
 */
export async function fetchKpiSourceData(
  session,
  { kpiCode, organizationId, businessUnitId, jurisdictionId, periodType, periodStart, periodEnd, timezone }
) {
  assertEnabled();
  requireValue(kpiCode, "kpiCode");
  requireValue(organizationId, "organizationId");
  requireValue(periodStart, "periodStart");
  requireValue(periodEnd, "periodEnd");
  if (!getKpiSpec(kpiCode)) {
    throw new Error(`Wave 6: unknown KPI code "${kpiCode}"`);
  }

  const sources = KPI_SOURCE_QUERIES[kpiCode] ?? [];
  const startIso = toIso(periodStart);
  const endIso = toIso(periodEnd);
  const result = {};

  for (const source of sources) {
    const filters = [
      "select=*",
      eq("organization_id", organizationId),
      `${source.timestampColumn}=gte.${encodeURIComponent(startIso)}`,
      `${source.timestampColumn}=lte.${encodeURIComponent(endIso)}`,
    ];
    if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
    if (jurisdictionId && source.table === "operational_job") {
      filters.push(eq("jurisdiction_id", jurisdictionId));
    }
    result[source.table] = await selectRows(source.table, filters.join("&"));
  }

  return {
    kpiCode,
    periodType: periodType ?? null,
    timezone: timezone ?? null,
    sourceRows: result,
  };
}

/**
 * Computes KPI values for a period from live canonical data.
 * Returns [{ kpiCode, value, numerator, denominator, sourceTables, freshnessAt }].
 * Computation itself is delegated to the pure utils module.
 */
export async function computePeriodKpis(
  session,
  { organizationId, businessUnitId, jurisdictionId, periodType, periodStart, periodEnd, timezone, kpiCodes }
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  requireValue(periodType, "periodType");
  requireValue(periodStart, "periodStart");
  requireValue(periodEnd, "periodEnd");
  requireValue(timezone, "timezone");

  const codes = Array.isArray(kpiCodes) && kpiCodes.length > 0 ? kpiCodes : Object.keys(KPI_SOURCE_QUERIES);
  const results = [];

  for (const kpiCode of codes) {
    const { sourceRows } = await fetchKpiSourceData(session, {
      kpiCode,
      organizationId,
      businessUnitId,
      jurisdictionId,
      periodType,
      periodStart,
      periodEnd,
      timezone,
    });
    const computed = computeKpiValue({ kpiCode, sourceRows, periodType });
    results.push({
      kpiCode,
      value: computed.value,
      numerator: computed.numerator,
      denominator: computed.denominator,
      sourceTables: getKpiSourceTables(kpiCode),
      rowCounts: Object.fromEntries(
        Object.entries(sourceRows).map(([table, rows]) => [table, rows.length])
      ),
      freshnessAt: new Date().toISOString(),
    });
  }

  return results;
}

/** Appends a KPI snapshot. Duplicate captures are rejected by the database. */
export async function captureKpiSnapshot(session, payload) {
  assertEnabled();
  requireValue(payload?.kpi_definition_id, "kpi_definition_id");
  requireValue(payload?.kpi_code, "kpi_code");
  requireValue(payload?.organization_id, "organization_id");
  requireValue(payload?.period_type, "period_type");
  requireValue(payload?.period_start, "period_start");
  requireValue(payload?.period_end, "period_end");
  requireValue(payload?.timezone, "timezone");
  return insertRow("kpi_snapshot", payload);
}

export async function loadKpiSnapshots(
  session,
  { organizationId, businessUnitId, periodType, periodStart, periodEnd } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=captured_at.desc"];
  if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
  filters.push(
    ...periodFilters({
      periodType,
      periodStart: toIso(periodStart),
      periodEnd: toIso(periodEnd),
    })
  );
  return selectRows("kpi_snapshot", filters.join("&"));
}

// ── Canonical events ─────────────────────────────────────────────────────────

export async function loadCanonicalEvents(
  session,
  { organizationId, businessUnitId, eventNames, limit = 100 } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = [
    "select=*",
    eq("organization_id", organizationId),
    "order=occurred_at.desc",
    `limit=${Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100}`,
  ];
  if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
  if (Array.isArray(eventNames) && eventNames.length > 0) {
    filters.push(`event_name=in.(${eventNames.map((n) => encodeURIComponent(n)).join(",")})`);
  }
  return selectRows("wave6_canonical_event", filters.join("&"));
}

// ── Management reviews ───────────────────────────────────────────────────────

export async function loadManagementReviews(session, { organizationId, periodType } = {}) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=period_start.desc"];
  if (periodType) filters.push(eq("period_type", periodType));
  return selectRows("management_review", filters.join("&"));
}

export async function createManagementReview(session, payload) {
  assertEnabled();
  requireValue(payload?.organization_id, "organization_id");
  requireValue(payload?.period_type, "period_type");
  requireValue(payload?.period_start, "period_start");
  requireValue(payload?.period_end, "period_end");
  requireValue(payload?.timezone, "timezone");
  return insertRow("management_review", payload);
}

export async function updateManagementReview(session, id, patch) {
  assertEnabled();
  if (patch?.review_status && patch?.current_status) {
    if (!canTransitionManagementReview(patch.current_status, patch.review_status)) {
      throw new Error(
        `Wave 6: illegal management review transition ${patch.current_status} → ${patch.review_status}`
      );
    }
  }
  const { current_status: _ignored, ...persistable } = patch ?? {};
  return patchRowById("management_review", id, persistable);
}

// ── Change control ───────────────────────────────────────────────────────────

export async function loadChangeControlRecords(session, { organizationId, changeStatus } = {}) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=created_at.desc"];
  if (changeStatus) filters.push(eq("change_status", changeStatus));
  return selectRows("change_control_record", filters.join("&"));
}

export async function createChangeControlRecord(session, payload) {
  assertEnabled();
  requireValue(payload?.change_code, "change_code");
  requireValue(payload?.change_type, "change_type");
  requireValue(payload?.title, "title");
  requireValue(payload?.organization_id, "organization_id");
  return insertRow("change_control_record", payload);
}

export async function updateChangeControlRecord(session, id, patch) {
  assertEnabled();
  if (patch?.change_status && patch?.current_status) {
    if (!canTransitionCcr(patch.current_status, patch.change_status)) {
      throw new Error(
        `Wave 6: illegal change control transition ${patch.current_status} → ${patch.change_status}`
      );
    }
  }
  const { current_status: _ignored, ...persistable } = patch ?? {};
  return patchRowById("change_control_record", id, {
    ...persistable,
    updated_at: new Date().toISOString(),
  });
}

// ── Dependency impact ────────────────────────────────────────────────────────

export async function loadDependencyEdges(session, { kgId } = {}) {
  assertEnabled();
  const filters = ["select=*", "order=kg_id.asc,from_node.asc"];
  if (kgId) filters.push(eq("kg_id", kgId));
  return selectRows("dependency_edge", filters.join("&"));
}

/**
 * Loads the dependency graph and returns the downstream impact set for a node.
 * Traversal is cycle-safe and depth-bounded (pure util).
 */
export async function loadDependencyImpact(session, { fromNode, maxDepth = 5 } = {}) {
  assertEnabled();
  requireValue(fromNode, "fromNode");
  const edges = await selectRows("dependency_edge", "select=*");
  return {
    fromNode,
    maxDepth,
    edges,
    impacted: traverseDependencyImpact(edges, fromNode, maxDepth),
  };
}

// ── Continuity ───────────────────────────────────────────────────────────────

export async function loadContinuitySessions(session, { organizationId, sessionStatus } = {}) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=declared_at.desc"];
  if (sessionStatus) filters.push(eq("session_status", sessionStatus));
  return selectRows("continuity_session", filters.join("&"));
}

export async function createContinuitySession(session, payload) {
  assertEnabled();
  requireValue(payload?.session_code, "session_code");
  requireValue(payload?.organization_id, "organization_id");
  requireValue(payload?.fallback_type, "fallback_type");
  return insertRow("continuity_session", payload);
}

export async function updateContinuitySession(session, id, patch) {
  assertEnabled();
  if (patch?.session_status && patch?.current_status) {
    if (!canTransitionContinuity(patch.current_status, patch.session_status)) {
      throw new Error(
        `Wave 6: illegal continuity transition ${patch.current_status} → ${patch.session_status}`
      );
    }
  }
  const { current_status: _ignored, ...persistable } = patch ?? {};
  return patchRowById("continuity_session", id, persistable);
}

export async function loadContinuityTransactions(session, { continuitySessionId } = {}) {
  assertEnabled();
  requireValue(continuitySessionId, "continuitySessionId");
  return selectRows(
    "continuity_transaction",
    ["select=*", eq("continuity_session_id", continuitySessionId), "order=created_at.asc"].join("&")
  );
}

export async function recordContinuityTransaction(session, payload) {
  assertEnabled();
  requireValue(payload?.continuity_session_id, "continuity_session_id");
  requireValue(payload?.organization_id, "organization_id");
  requireValue(payload?.transaction_type, "transaction_type");
  requireValue(payload?.offline_correlation_id, "offline_correlation_id");
  if (!isValidOfflineCorrelationId(payload.offline_correlation_id)) {
    throw new Error(
      "Wave 6: offline_correlation_id must be 4-64 chars of letters, digits, dot, dash or underscore"
    );
  }
  return insertRow("continuity_transaction", payload);
}

/**
 * Reconciles an offline transaction. Idempotent: a transaction that is already
 * reconciled is returned unchanged instead of being overwritten.
 */
export async function reconcileContinuityTransaction(session, id, reconciliation) {
  assertEnabled();
  requireValue(id, "continuity_transaction id");
  const existingRows = await selectRows(
    "continuity_transaction",
    ["select=*", eq("id", id), "limit=1"].join("&")
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new Error(`Wave 6: continuity_transaction ${id} not found or not visible`);
  }

  const resolved = resolveContinuityReconciliation(existing, reconciliation);
  if (!resolved.applied) {
    return { applied: false, transaction: existing };
  }

  const patch = {
    reconciliation_status: resolved.transaction.reconciliation_status,
    reconciled_at: resolved.transaction.reconciled_at,
  };
  if (resolved.transaction.discrepancy_notes !== undefined) {
    patch.discrepancy_notes = resolved.transaction.discrepancy_notes;
  }
  if (resolved.transaction.waiver_evidence !== undefined) {
    patch.waiver_evidence = resolved.transaction.waiver_evidence;
  }
  if (resolved.transaction.reconciled_by_app_user_id !== undefined) {
    patch.reconciled_by_app_user_id = resolved.transaction.reconciled_by_app_user_id;
  }
  if (resolved.transaction.serviceos_entity_type !== undefined) {
    patch.serviceos_entity_type = resolved.transaction.serviceos_entity_type;
  }
  if (resolved.transaction.serviceos_entity_id !== undefined) {
    patch.serviceos_entity_id = resolved.transaction.serviceos_entity_id;
  }

  const transaction = await patchRowById("continuity_transaction", id, patch);
  return { applied: true, transaction };
}

// ── Module profiles and release gates ────────────────────────────────────────

export async function loadServiceModuleProfiles(session, { organizationId } = {}) {
  assertEnabled();
  const filters = ["select=*", "order=profile_code.asc"];
  if (organizationId) {
    filters.push(
      `or=(organization_id.is.null,organization_id.eq.${encodeURIComponent(organizationId)})`
    );
  }
  return selectRows("service_module_profile", filters.join("&"));
}

export async function loadReleaseGates(session, { organizationId } = {}) {
  assertEnabled();
  const filters = ["select=*", "order=sequence_order.asc"];
  if (organizationId) {
    filters.push(
      `or=(organization_id.is.null,organization_id.eq.${encodeURIComponent(organizationId)})`
    );
  }
  return selectRows("release_gate", filters.join("&"));
}
