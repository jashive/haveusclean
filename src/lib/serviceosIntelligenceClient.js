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
// Call convention (identical to serviceosWave5FinanceClient.js): every exported
// function accepts the caller's `session` for call-site symmetry, but the value
// is intentionally unused — authenticatedRestFetchWithRefresh resolves and
// refreshes the stored session itself, so no credential is ever passed around
// or serialized by this module.
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
    const flag =
      typeof import.meta !== "undefined"
        ? (import.meta.env?.VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED ??
          process.env.VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED)
        : process.env.VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED;
    return flag === "true";
  } catch {
    return process.env.VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED === "true";
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
  if (periodStart) filters.push(`period_start=eq.${encodeURIComponent(periodStart)}`);
  if (periodEnd) filters.push(`period_end=eq.${encodeURIComponent(periodEnd)}`);
  return filters;
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function isPopulatedObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
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

const SOURCE_PAGE_SIZE = 1000;

function sourceConfig(
  table,
  {
    timestampColumn,
    selectColumns,
    predicateFilters = [],
    jurisdictionScoped = false,
    unverifiedSchema = false,
  }
) {
  return {
    table,
    timestampColumn,
    selectColumns,
    predicateFilters,
    jurisdictionScoped,
    unverifiedSchema,
  };
}

function eqFilter(column, value) {
  return { column, operator: "eq", value };
}

function inFilter(column, values) {
  return { column, operator: "in", value: values };
}

// Source-table map for KPI computation.
//
// `unverifiedSchema: true` marks Wave 1-2 tables whose DDL is NOT vendored in
// this repository. Those live schemas have been independently verified, so the
// runtime uses the verified business-event timestamps and fields below. A read
// failure must still be treated as "source unavailable" (null) rather than a
// fabricated zero.
const KPI_SOURCE_QUERIES = {
  "sales.leads_created": [
    sourceConfig("service_request", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at"],
      unverifiedSchema: true,
    }),
  ],
  "sales.opportunities_created": [
    sourceConfig("opportunity", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at"],
      unverifiedSchema: true,
    }),
  ],
  "sales.quotes_created": [
    sourceConfig("quote", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at"],
      unverifiedSchema: true,
    }),
  ],
  "sales.quotes_accepted": [
    sourceConfig("quote_response", {
      timestampColumn: "responded_at",
      selectColumns: ["id", "responded_at", "response_type"],
      predicateFilters: [eqFilter("response_type", "accepted")],
      unverifiedSchema: true,
    }),
  ],
  "sales.conversions": [
    sourceConfig("conversion_record", {
      timestampColumn: "converted_at",
      selectColumns: ["id", "converted_at"],
      unverifiedSchema: true,
    }),
  ],
  "sales.lead_to_conversion_rate": [
    sourceConfig("conversion_record", {
      timestampColumn: "converted_at",
      selectColumns: ["id", "converted_at"],
      unverifiedSchema: true,
    }),
    sourceConfig("service_request", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at"],
      unverifiedSchema: true,
    }),
  ],
  "operations.jobs_created": [
    sourceConfig("operational_job", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at", "jurisdiction_id"],
      jurisdictionScoped: true,
    }),
  ],
  "operations.work_completed": [
    sourceConfig("work_order", {
      timestampColumn: "service_completed_at",
      selectColumns: ["id", "service_completed_at", "work_order_status", "jurisdiction_id"],
      predicateFilters: [inFilter("work_order_status", ["qa_complete", "closed"])],
      jurisdictionScoped: true,
    }),
  ],
  "quality.qa_inspections": [
    sourceConfig("qa_inspection", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at"],
    }),
  ],
  "quality.qa_pass_rate": [
    sourceConfig("qa_inspection", {
      timestampColumn: "inspected_at",
      selectColumns: ["id", "inspected_at", "inspection_status"],
      predicateFilters: [inFilter("inspection_status", ["passed", "failed"])],
    }),
  ],
  "quality.exceptions_opened": [
    sourceConfig("service_exception", {
      timestampColumn: "reported_at",
      selectColumns: ["id", "reported_at"],
    }),
  ],
  "quality.reclean_requests": [
    sourceConfig("customer_outcome", {
      timestampColumn: "reported_at",
      selectColumns: ["id", "reported_at", "outcome_type"],
      predicateFilters: [eqFilter("outcome_type", "reclean_request")],
    }),
  ],
  "finance.invoice_subtotal_requested": [
    sourceConfig("invoice_request", {
      timestampColumn: "created_at",
      selectColumns: ["id", "created_at", "subtotal_amount"],
    }),
  ],
  "finance.payments_observed": [
    sourceConfig("payment_observation", {
      timestampColumn: "observed_at",
      selectColumns: ["id", "observed_at", "amount_observed"],
    }),
  ],
  "finance.contractor_payable_approved": [
    sourceConfig("contractor_payable", {
      timestampColumn: "approved_at",
      selectColumns: ["id", "approved_at", "payable_status", "computed_amount"],
      predicateFilters: [eqFilter("payable_status", "approved")],
    }),
  ],
  "finance.recognized_revenue": [
    sourceConfig("job_profitability_snapshot", {
      timestampColumn: "snapshot_taken_at",
      selectColumns: ["id", "snapshot_taken_at", "recognized_revenue_amount"],
    }),
  ],
  "finance.gross_contribution": [
    sourceConfig("job_profitability_snapshot", {
      timestampColumn: "snapshot_taken_at",
      selectColumns: ["id", "snapshot_taken_at", "gross_contribution"],
    }),
  ],
  "finance.gross_margin": [
    sourceConfig("job_profitability_snapshot", {
      timestampColumn: "snapshot_taken_at",
      selectColumns: ["id", "snapshot_taken_at", "recognized_revenue_amount", "gross_contribution"],
    }),
  ],
};

/** Returns the source table names a KPI reads from (lineage disclosure). */
export function getKpiSourceTables(kpiCode) {
  return (KPI_SOURCE_QUERIES[kpiCode] ?? []).map((source) => source.table);
}

function encodeInList(values) {
  return `(${values.map((value) => encodeURIComponent(String(value))).join(",")})`;
}

function predicateFilterToQuery(filter) {
  if (!filter) return null;
  if (filter.operator === "eq") {
    return eq(filter.column, filter.value);
  }
  if (filter.operator === "in") {
    return `${filter.column}=in.${encodeInList(filter.value ?? [])}`;
  }
  throw new Error(`Wave 6: unsupported filter operator "${filter.operator}"`);
}

function predicateFilterToLineage(filter) {
  if (!filter) return null;
  return {
    column: filter.column,
    operator: filter.operator,
    value: Array.isArray(filter.value) ? [...filter.value] : filter.value,
  };
}

function buildSourceQueryParts(source, scope) {
  const {
    organizationId,
    businessUnitId,
    jurisdictionId,
    startIso,
    endIso,
    limit,
    offset,
  } = scope;
  const filters = [
    `select=${source.selectColumns.join(",")}`,
    eq("organization_id", organizationId),
    `${source.timestampColumn}=gte.${encodeURIComponent(startIso)}`,
    `${source.timestampColumn}=lte.${encodeURIComponent(endIso)}`,
    `order=${source.timestampColumn}.asc,id.asc`,
    `limit=${limit}`,
    `offset=${offset}`,
  ];
  if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
  if (jurisdictionId && source.jurisdictionScoped) {
    filters.push(eq("jurisdiction_id", jurisdictionId));
  }
  for (const filter of source.predicateFilters) {
    filters.push(predicateFilterToQuery(filter));
  }
  return filters;
}

function latestTimestampForRows(rows, column) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let latest = null;
  for (const row of rows) {
    const raw = row?.[column];
    if (!raw) continue;
    const millis = Date.parse(raw);
    if (!Number.isFinite(millis)) continue;
    if (latest === null || millis > latest) latest = millis;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

function deriveSourceFreshnessAt(sourceStates) {
  const participating = sourceStates
    .map((state) => state.latestSourceTimestamp)
    .filter((value) => typeof value === "string");
  if (participating.length === 0) return null;
  const earliestLatestMillis = Math.min(...participating.map((value) => Date.parse(value)));
  return Number.isFinite(earliestLatestMillis) ? new Date(earliestLatestMillis).toISOString() : null;
}

async function fetchSourceRows(selectRowsImpl, source, scope) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await selectRowsImpl(
      source.table,
      buildSourceQueryParts(source, {
        ...scope,
        limit: SOURCE_PAGE_SIZE,
        offset,
      }).join("&")
    );
    if (!Array.isArray(page)) {
      throw new Error(`Wave 6: expected array rows from ${source.table}`);
    }
    rows.push(...page);
    if (page.length < SOURCE_PAGE_SIZE) break;
    offset += SOURCE_PAGE_SIZE;
  }
  return rows;
}

/**
 * Loads the raw canonical rows a KPI is derived from, scoped to org/BU and
 * bounded by the governed period. Returns { [table]: rows[] }.
 */
export async function fetchKpiSourceData(
  session,
  { kpiCode, organizationId, businessUnitId, jurisdictionId, periodType, periodStart, periodEnd, timezone },
  { selectRowsImpl = selectRows, readAt = () => new Date().toISOString() } = {}
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
  const unavailableSources = [];
  const sourceStates = [];
  const readTimestamp = readAt();

  for (const source of sources) {
    if (source.unverifiedSchema) {
      // A verified live Wave 1-2 source may still be unavailable to the runtime.
      try {
        result[source.table] = await fetchSourceRows(selectRowsImpl, source, {
          organizationId,
          businessUnitId,
          jurisdictionId,
          startIso,
          endIso,
        });
      } catch {
        result[source.table] = null;
        unavailableSources.push(source.table);
      }
    } else {
      result[source.table] = await fetchSourceRows(selectRowsImpl, source, {
        organizationId,
        businessUnitId,
        jurisdictionId,
        startIso,
        endIso,
      });
    }

    const rows = result[source.table];
    const latestSourceTimestamp = latestTimestampForRows(rows, source.timestampColumn);
    sourceStates.push({
      table: source.table,
      selectColumns: [...source.selectColumns],
      timestampColumn: source.timestampColumn,
      predicateFilters: source.predicateFilters.map(predicateFilterToLineage),
      rowCount: Array.isArray(rows) ? rows.length : null,
      latestSourceTimestamp,
      unavailable: rows === null,
      jurisdictionScoped: source.jurisdictionScoped,
    });
  }

  const jurisdictionApplied =
    !!jurisdictionId && sourceStates.some((state) => state.jurisdictionScoped === true);
  const runtimeLineage = {
    kpi_code: kpiCode,
    period_type: periodType ?? null,
    period_start: startIso,
    period_end: endIso,
    timezone: timezone ?? null,
    organization_id: organizationId,
    business_unit_id: businessUnitId ?? null,
    jurisdiction_id: jurisdictionApplied ? jurisdictionId : null,
    effective_scope: {
      organization_id: organizationId,
      business_unit_id: businessUnitId ?? null,
      jurisdiction_id: jurisdictionApplied ? jurisdictionId : null,
    },
    timestamp_columns: Object.fromEntries(
      sourceStates.map((state) => [state.table, state.timestampColumn])
    ),
    filters: {
      organization_id: organizationId,
      business_unit_id: businessUnitId ?? null,
      jurisdiction_id: jurisdictionApplied ? jurisdictionId : null,
      period_type: periodType ?? null,
      period_start: startIso,
      period_end: endIso,
      timezone: timezone ?? null,
      per_source: Object.fromEntries(
        sourceStates.map((state) => [
          state.table,
          {
            timestamp_column: state.timestampColumn,
            predicates: state.predicateFilters,
          },
        ])
      ),
    },
    row_counts: Object.fromEntries(sourceStates.map((state) => [state.table, state.rowCount])),
    unavailable_sources: [...unavailableSources],
    freshness_rule: "minimum_of_per_source_latest_timestamps",
    calculated_at: readTimestamp,
    sources: sourceStates.map((state) => ({
      table: state.table,
      select_columns: state.selectColumns,
      timestamp_column: state.timestampColumn,
      predicates: state.predicateFilters,
      row_count: state.rowCount,
      latest_source_timestamp: state.latestSourceTimestamp,
      unavailable: state.unavailable,
    })),
  };

  return {
    kpiCode,
    periodType: periodType ?? null,
    timezone: timezone ?? null,
    sourceRows: result,
    unavailableSources,
    rowCounts: runtimeLineage.row_counts,
    sourceLineage: { runtime: runtimeLineage },
    effectiveScope: runtimeLineage.effective_scope,
    sourceFreshnessAt: deriveSourceFreshnessAt(sourceStates),
  };
}

/**
 * Computes KPI values for a period from live canonical data.
 * Returns [{ kpiCode, value, numerator, denominator, sourceTables, freshnessAt }].
 * Computation itself is delegated to the pure utils module.
 */
export async function computePeriodKpis(
  session,
  { organizationId, businessUnitId, jurisdictionId, periodType, periodStart, periodEnd, timezone, kpiCodes },
  deps
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
    const {
      sourceRows,
      unavailableSources,
      rowCounts,
      sourceLineage,
      effectiveScope,
      sourceFreshnessAt,
    } = await fetchKpiSourceData(session, {
      kpiCode,
      organizationId,
      businessUnitId,
      jurisdictionId,
      periodType,
      periodStart,
      periodEnd,
      timezone,
    }, deps);
    const computed = computeKpiValue({ kpiCode, sourceRows, periodType });
    results.push({
      kpiCode,
      value: computed.value,
      numerator: computed.numerator,
      denominator: computed.denominator,
      unavailable: computed.unavailable === true,
      unavailableSources,
      sourceTables: getKpiSourceTables(kpiCode),
      rowCounts,
      sourceLineage,
      effectiveScope,
      freshnessAt: sourceFreshnessAt,
      sourceFreshnessAt,
    });
  }

  return results;
}

function buildSnapshotNaturalKeyFilters(payload) {
  const filters = [
    "select=*",
    eq("kpi_code", payload.kpi_code),
    eq("definition_version", payload.definition_version ?? "1"),
    eq("organization_id", payload.organization_id),
    eq("period_type", payload.period_type),
    `period_start=eq.${encodeURIComponent(toIso(payload.period_start))}`,
    `period_end=eq.${encodeURIComponent(toIso(payload.period_end))}`,
    eq("timezone", payload.timezone),
    "limit=2",
  ];
  filters.push(
    payload.business_unit_id ? eq("business_unit_id", payload.business_unit_id) : "business_unit_id=is.null"
  );
  filters.push(
    payload.jurisdiction_id ? eq("jurisdiction_id", payload.jurisdiction_id) : "jurisdiction_id=is.null"
  );
  return filters.join("&");
}

async function resolveExistingKpiSnapshot(payload, { selectRowsImpl = selectRows } = {}) {
  const rows = await selectRowsImpl("kpi_snapshot", buildSnapshotNaturalKeyFilters(payload));
  if (rows.length !== 1) {
    throw new Error(
      `Wave 6: duplicate snapshot could not be resolved unambiguously for ${payload.kpi_code}`
    );
  }
  return rows[0];
}

function isDuplicateSnapshotError(message) {
  const text = String(message ?? "").toLowerCase();
  return text.includes("duplicate") || text.includes("unique");
}

/** Appends a KPI snapshot or resolves the existing governed evidence row. */
export async function captureKpiSnapshot(
  session,
  payload,
  { insertRowImpl = insertRow, selectRowsImpl = selectRows } = {}
) {
  assertEnabled();
  requireValue(payload?.kpi_definition_id, "kpi_definition_id");
  requireValue(payload?.kpi_code, "kpi_code");
  requireValue(payload?.organization_id, "organization_id");
  requireValue(payload?.period_type, "period_type");
  requireValue(payload?.period_start, "period_start");
  requireValue(payload?.period_end, "period_end");
  requireValue(payload?.timezone, "timezone");
  if (payload?.numeric_value !== null && payload?.numeric_value !== undefined) {
    if (!isPopulatedObject(payload?.source_lineage)) {
      throw new Error(
        `Wave 6: non-null KPI snapshot ${payload.kpi_code} requires non-empty source_lineage`
      );
    }
  }
  try {
    return await insertRowImpl("kpi_snapshot", payload);
  } catch (error) {
    if (!isDuplicateSnapshotError(error?.message)) throw error;
    const existing = await resolveExistingKpiSnapshot(payload, { selectRowsImpl });
    return { ...existing, resolved_existing: true };
  }
}

export async function loadKpiSnapshots(
  session,
  { organizationId, businessUnitId, jurisdictionId, periodType, periodStart, periodEnd, kpiCode } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=captured_at.desc"];
  if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
  if (kpiCode) filters.push(eq("kpi_code", kpiCode));
  if (jurisdictionId) {
    filters.push(
      `or=(jurisdiction_id.is.null,jurisdiction_id.eq.${encodeURIComponent(jurisdictionId)})`
    );
  } else {
    filters.push("jurisdiction_id=is.null");
  }
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
  { organizationId, businessUnitId, eventNames, periodStart, periodEnd, limit = 1000 } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = [
    "select=*",
    eq("organization_id", organizationId),
    "order=occurred_at.desc",
    `limit=${Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 1000}`,
  ];
  if (businessUnitId) filters.push(eq("business_unit_id", businessUnitId));
  if (Array.isArray(eventNames) && eventNames.length > 0) {
    filters.push(`event_name=in.(${eventNames.map((n) => encodeURIComponent(n)).join(",")})`);
  }
  if (periodStart) {
    filters.push(`occurred_at=gte.${encodeURIComponent(toIso(periodStart))}`);
  }
  if (periodEnd) {
    filters.push(`occurred_at=lte.${encodeURIComponent(toIso(periodEnd))}`);
  }
  return selectRows("wave6_canonical_event", filters.join("&"));
}

// ── Management reviews ───────────────────────────────────────────────────────

export async function loadManagementReviews(
  session,
  { organizationId, businessUnitId, periodType, periodStart, periodEnd, timezone } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=period_start.desc,id.desc"];
  if (businessUnitId) {
    filters.push(eq("business_unit_id", businessUnitId));
  } else if (businessUnitId === null) {
    filters.push("business_unit_id=is.null");
  }
  if (periodType) filters.push(eq("period_type", periodType));
  if (periodStart) filters.push(`period_start=eq.${encodeURIComponent(toIso(periodStart))}`);
  if (periodEnd) filters.push(`period_end=eq.${encodeURIComponent(toIso(periodEnd))}`);
  if (timezone) filters.push(eq("timezone", timezone));
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

export async function loadChangeControlRecords(
  session,
  { organizationId, businessUnitId, changeStatus } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=created_at.desc"];
  if (businessUnitId) {
    filters.push(eq("business_unit_id", businessUnitId));
  } else if (businessUnitId === null) {
    filters.push("business_unit_id=is.null");
  }
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
  return patchRowById("change_control_record", id, persistable);
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
  const edges = await loadDependencyEdges(session, {});
  return {
    fromNode,
    maxDepth,
    edges,
    impacted: traverseDependencyImpact(edges, fromNode, maxDepth),
  };
}

// ── Continuity ───────────────────────────────────────────────────────────────

export async function loadContinuitySessions(
  session,
  { organizationId, businessUnitId, sessionStatus } = {}
) {
  assertEnabled();
  requireValue(organizationId, "organizationId");
  const filters = ["select=*", eq("organization_id", organizationId), "order=declared_at.desc"];
  if (businessUnitId) {
    filters.push(eq("business_unit_id", businessUnitId));
  } else if (businessUnitId === null) {
    filters.push("business_unit_id=is.null");
  }
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
  const txData = payload?.transaction_data;
  if (!txData || typeof txData !== "object" || Array.isArray(txData) || Object.keys(txData).length === 0) {
    throw new Error("Wave 6: transaction_data must be a non-empty structured payload");
  }
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
  };
  if (resolved.transaction.discrepancy_notes !== undefined) {
    patch.discrepancy_notes = resolved.transaction.discrepancy_notes;
  }
  if (resolved.transaction.waiver_evidence !== undefined) {
    patch.waiver_evidence = resolved.transaction.waiver_evidence;
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
