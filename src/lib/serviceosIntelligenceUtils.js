// ── Wave 6: ServiceOS Intelligence / Governance / Continuity Utilities ───────
//
// Pure functions only. No network access, no DB access, no side effects,
// no credentials. Every rule here mirrors migration 014 so that the UI and the
// database agree on the same governed vocabulary.
//
// Fail-closed principles enforced in this module:
//   - a rate with a zero/absent denominator is null, never Infinity or NaN
//   - a state transition that is not explicitly legal is illegal
//   - closure of a governed record requires evidence or a recorded waiver

// ── Governed vocabulary ──────────────────────────────────────────────────────

export const PERIOD_TYPES = ["DAILY", "MONTHLY", "QUARTERLY", "YEARLY"];

export const KPI_DOMAINS = ["sales", "operations", "quality", "finance"];

export const KPI_CODES = [
  "sales.leads_created",
  "sales.opportunities_created",
  "sales.quotes_created",
  "sales.quotes_accepted",
  "sales.conversions",
  "sales.lead_to_conversion_rate",
  "operations.jobs_created",
  "operations.work_completed",
  "quality.qa_inspections",
  "quality.qa_pass_rate",
  "quality.exceptions_opened",
  "quality.reclean_requests",
  "finance.invoice_subtotal_requested",
  "finance.payments_observed",
  "finance.contractor_payable_approved",
  "finance.recognized_revenue",
  "finance.gross_contribution",
  "finance.gross_margin",
];

// Change-control FSM (HEMS): measure → analyze → improve → approve →
// update → retrain → validate → closed
export const CCR_TRANSITIONS = {
  measure: ["analyze"],
  analyze: ["improve"],
  improve: ["approve"],
  approve: ["update"],
  update: ["retrain"],
  retrain: ["validate"],
  validate: ["closed"],
  closed: [],
};

// Continuity / DR FSM
export const CONTINUITY_TRANSITIONS = {
  declared: ["fallback_active"],
  fallback_active: ["service_restored"],
  service_restored: ["reconciling"],
  reconciling: ["reconciled"],
  reconciled: ["closed"],
  closed: [],
};

// Management review FSM
export const MANAGEMENT_REVIEW_TRANSITIONS = {
  draft: ["in_review"],
  in_review: ["actions_open", "closed"],
  actions_open: ["closed"],
  closed: [],
};

// Release gate sequencing (each gate requires its predecessor to have passed)
export const RELEASE_GATE_SEQUENCE = [
  "PILOT",
  "ACCEPTANCE",
  "CUTOVER",
  "LEGACY_RETIREMENT",
  "SCALE",
];

// ── Numeric helpers ──────────────────────────────────────────────────────────

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rate computation that never fabricates a value.
 * Returns null when the denominator is null, not numeric, or zero.
 */
export function computeRate(numerator, denominator) {
  const n = toFiniteNumber(numerator);
  const d = toFiniteNumber(denominator);
  if (n === null || d === null) return null;
  if (d === 0) return null;
  const result = n / d;
  return Number.isFinite(result) ? result : null;
}

/**
 * Weighted gross margin across profitability rows:
 *   sum(gross_contribution) / sum(recognized_revenue_amount)
 * Returns null when there is no revenue basis.
 */
export function computeWeightedGrossMargin(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  let contribution = 0;
  let revenue = 0;
  for (const job of jobs) {
    if (!job) continue;
    const c = toFiniteNumber(job.gross_contribution);
    const r = toFiniteNumber(job.recognized_revenue_amount);
    if (c !== null) contribution += c;
    if (r !== null) revenue += r;
  }
  return computeRate(contribution, revenue);
}

function sumField(rows, field) {
  let total = 0;
  for (const row of rows) {
    const value = toFiniteNumber(row?.[field]);
    if (value !== null) total += value;
  }
  return total;
}

// ── Timezone-aware period boundaries ─────────────────────────────────────────

function zonedParts(timezone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

function zoneOffsetMs(timezone, date) {
  const p = zonedParts(timezone, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timezone` into the corresponding UTC instant.
 * Resolves the offset twice so DST transitions land on the correct instant.
 */
function zonedWallClockToUtc(timezone, year, month, day, hour, minute, second, ms) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstOffset = zoneOffsetMs(timezone, new Date(naiveUtc));
  let instant = naiveUtc - firstOffset;
  const secondOffset = zoneOffsetMs(timezone, new Date(instant));
  if (secondOffset !== firstOffset) {
    instant = naiveUtc - secondOffset;
  }
  return new Date(instant);
}

function assertPeriodType(periodType) {
  if (!PERIOD_TYPES.includes(periodType)) {
    throw new Error(
      `Wave 6: unsupported period type "${periodType}" (expected one of ${PERIOD_TYPES.join(", ")})`
    );
  }
}

function assertTimezone(timezone) {
  if (typeof timezone !== "string" || timezone.trim() === "") {
    throw new Error("Wave 6: timezone is required for period boundary computation");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Wave 6: unknown timezone "${timezone}"`);
  }
}

function toDate(referenceDate) {
  const date =
    referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date(referenceDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Wave 6: referenceDate is not a valid date");
  }
  return date;
}

/**
 * Returns { periodStart, periodEnd } as UTC instants for the local period that
 * contains `referenceDate` in `timezone`.
 * periodEnd is inclusive of the final millisecond (23:59:59.999 local).
 */
export function getPeriodBoundaries(periodType, referenceDate, timezone) {
  assertPeriodType(periodType);
  assertTimezone(timezone);
  const reference = toDate(referenceDate);
  const local = zonedParts(timezone, reference);

  let startY = local.year;
  let startM = local.month;
  let startD = local.day;
  let nextY = local.year;
  let nextM = local.month;
  let nextD = local.day;

  if (periodType === "DAILY") {
    const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    nextY = next.getUTCFullYear();
    nextM = next.getUTCMonth() + 1;
    nextD = next.getUTCDate();
  } else if (periodType === "MONTHLY") {
    startD = 1;
    const next = new Date(Date.UTC(local.year, local.month, 1));
    nextY = next.getUTCFullYear();
    nextM = next.getUTCMonth() + 1;
    nextD = 1;
  } else if (periodType === "QUARTERLY") {
    const quarterStartMonth = Math.floor((local.month - 1) / 3) * 3 + 1;
    startM = quarterStartMonth;
    startD = 1;
    const next = new Date(Date.UTC(local.year, quarterStartMonth + 2, 1));
    nextY = next.getUTCFullYear();
    nextM = next.getUTCMonth() + 1;
    nextD = 1;
  } else {
    startM = 1;
    startD = 1;
    nextY = local.year + 1;
    nextM = 1;
    nextD = 1;
  }

  const periodStart = zonedWallClockToUtc(timezone, startY, startM, startD, 0, 0, 0, 0);
  const nextStart = zonedWallClockToUtc(timezone, nextY, nextM, nextD, 0, 0, 0, 0);
  const periodEnd = new Date(nextStart.getTime() - 1);

  return { periodStart, periodEnd };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Human-readable label for a period, rendered in the governed timezone. */
export function formatPeriodLabel(periodType, periodStart, timezone) {
  assertPeriodType(periodType);
  assertTimezone(timezone);
  const start = toDate(periodStart);
  const p = zonedParts(timezone, start);

  if (periodType === "DAILY") {
    const mm = String(p.month).padStart(2, "0");
    const dd = String(p.day).padStart(2, "0");
    return `${p.year}-${mm}-${dd}`;
  }
  if (periodType === "MONTHLY") {
    return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
  }
  if (periodType === "QUARTERLY") {
    return `Q${Math.floor((p.month - 1) / 3) + 1} ${p.year}`;
  }
  return String(p.year);
}

// ── KPI computation ──────────────────────────────────────────────────────────

function rowsFor(sourceRows, table) {
  if (Array.isArray(sourceRows)) return sourceRows;
  if (sourceRows && typeof sourceRows === "object") {
    const rows = sourceRows[table];
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

/**
 * A source is "unavailable" when the loader explicitly reported null for it
 * (e.g. a Wave 1-2 table whose DDL is not vendored in this repository and which
 * the caller could not read). Unavailable is NOT the same as empty: an
 * unavailable source must yield a NULL KPI value rather than a fabricated zero.
 */
function sourceUnavailable(sourceRows, ...tables) {
  if (!sourceRows || typeof sourceRows !== "object" || Array.isArray(sourceRows)) {
    return false;
  }
  return tables.some((table) => table in sourceRows && sourceRows[table] === null);
}

const UNAVAILABLE_KPI_RESULT = Object.freeze({
  value: null,
  numerator: null,
  denominator: null,
  unavailable: true,
});

function countWhere(rows, predicate) {
  if (!predicate) return rows.length;
  let total = 0;
  for (const row of rows) {
    if (predicate(row)) total += 1;
  }
  return total;
}

// Real canonical status vocabulary — must match the database CHECK constraints.
const KPI_SPECS = {
  "sales.leads_created": {
    kind: "count",
    table: "service_request",
  },
  "sales.opportunities_created": {
    kind: "count",
    table: "opportunity",
  },
  "sales.quotes_created": {
    kind: "count",
    table: "quote",
  },
  "sales.quotes_accepted": {
    kind: "count",
    table: "quote_response",
    predicate: (row) => row?.response_type === "accepted",
  },
  "sales.conversions": {
    kind: "count",
    table: "conversion_record",
  },
  "sales.lead_to_conversion_rate": {
    kind: "rate",
    numeratorTable: "conversion_record",
    denominatorTable: "service_request",
  },
  "operations.jobs_created": {
    kind: "count",
    table: "operational_job",
  },
  "operations.work_completed": {
    kind: "count",
    table: "work_order",
    predicate: (row) =>
      row?.work_order_status === "qa_complete" || row?.work_order_status === "closed",
  },
  "quality.qa_inspections": {
    kind: "count",
    table: "qa_inspection",
  },
  "quality.qa_pass_rate": {
    kind: "rate",
    numeratorTable: "qa_inspection",
    denominatorTable: "qa_inspection",
    numeratorPredicate: (row) => row?.inspection_status === "passed",
    denominatorPredicate: (row) =>
      row?.inspection_status === "passed" || row?.inspection_status === "failed",
  },
  "quality.exceptions_opened": {
    kind: "count",
    table: "service_exception",
  },
  "quality.reclean_requests": {
    kind: "count",
    table: "customer_outcome",
    predicate: (row) => row?.outcome_type === "reclean_request",
  },
  "finance.invoice_subtotal_requested": {
    kind: "sum",
    table: "invoice_request",
    field: "subtotal_amount",
  },
  "finance.payments_observed": {
    kind: "sum",
    table: "payment_observation",
    field: "amount_observed",
  },
  "finance.contractor_payable_approved": {
    kind: "sum",
    table: "contractor_payable",
    field: "computed_amount",
    predicate: (row) => row?.payable_status === "approved",
  },
  "finance.recognized_revenue": {
    kind: "sum",
    table: "job_profitability_snapshot",
    field: "recognized_revenue_amount",
  },
  "finance.gross_contribution": {
    kind: "sum",
    table: "job_profitability_snapshot",
    field: "gross_contribution",
  },
  "finance.gross_margin": {
    kind: "weighted_margin",
    table: "job_profitability_snapshot",
  },
};

/** Returns the governed computation spec for a KPI code, or null when unknown. */
export function getKpiSpec(kpiCode) {
  return KPI_SPECS[kpiCode] ?? null;
}

/**
 * Computes a governed KPI from raw source rows.
 * `sourceRows` may be an array (single source table) or an object keyed by
 * source table name for multi-source KPIs.
 * Returns { value, numerator, denominator } — value is null when a rate or
 * weighted average has no usable denominator.
 */
export function computeKpiValue({ kpiCode, sourceRows, periodType }) {
  const spec = KPI_SPECS[kpiCode];
  if (!spec) {
    throw new Error(`Wave 6: unknown KPI code "${kpiCode}"`);
  }
  if (periodType !== undefined && periodType !== null) {
    assertPeriodType(periodType);
  }

  if (spec.kind === "count") {
    if (sourceUnavailable(sourceRows, spec.table)) return { ...UNAVAILABLE_KPI_RESULT };
    const rows = rowsFor(sourceRows, spec.table);
    const value = countWhere(rows, spec.predicate);
    return { value, numerator: null, denominator: null };
  }

  if (spec.kind === "sum") {
    if (sourceUnavailable(sourceRows, spec.table)) return { ...UNAVAILABLE_KPI_RESULT };
    const rows = rowsFor(sourceRows, spec.table).filter((row) =>
      spec.predicate ? spec.predicate(row) : true
    );
    return { value: sumField(rows, spec.field), numerator: null, denominator: null };
  }

  if (spec.kind === "rate") {
    if (sourceUnavailable(sourceRows, spec.numeratorTable, spec.denominatorTable)) {
      return { ...UNAVAILABLE_KPI_RESULT };
    }
    const numeratorRows = rowsFor(sourceRows, spec.numeratorTable);
    const denominatorRows = rowsFor(sourceRows, spec.denominatorTable);
    const numerator = countWhere(numeratorRows, spec.numeratorPredicate);
    const denominator = countWhere(denominatorRows, spec.denominatorPredicate);
    return { value: computeRate(numerator, denominator), numerator, denominator };
  }

  // weighted_margin
  if (sourceUnavailable(sourceRows, spec.table)) return { ...UNAVAILABLE_KPI_RESULT };
  const rows = rowsFor(sourceRows, spec.table);
  const numerator = sumField(rows, "gross_contribution");
  const denominator = sumField(rows, "recognized_revenue_amount");
  return {
    value: computeWeightedGrossMargin(rows),
    numerator,
    denominator,
  };
}

// ── Change control FSM ───────────────────────────────────────────────────────

/** True only for explicitly legal change-control transitions. */
export function canTransitionCcr(fromStatus, toStatus) {
  const allowed = CCR_TRANSITIONS[fromStatus];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(toStatus);
}

/** Legal next statuses for a change-control record (never undefined). */
export function nextCcrStatuses(fromStatus) {
  const allowed = CCR_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) ? [...allowed] : [];
}

/**
 * Closure evidence rule (mirrors ck_ccr_material_close_evidence):
 * a material change may only close with a non-empty impact_assessment and a
 * validation_result that explicitly passed.
 */
export function canCloseChangeControlRecord(record) {
  if (!record) return false;
  if (!canTransitionCcr(record.change_status, "closed")) return false;
  const validation = record.validation_result;
  const hasValidationEvidence =
    validation && typeof validation === "object" && Object.keys(validation).length > 0;
  if (!hasValidationEvidence) return false;

  if (!record.material_change) return true;

  const impact = record.impact_assessment;
  const hasImpact = impact && typeof impact === "object" && Object.keys(impact).length > 0;
  const passed =
    validation &&
    typeof validation === "object" &&
    (validation.passed === true || validation.passed === "true");

  return Boolean(hasImpact && passed);
}

// ── Management review lifecycle ──────────────────────────────────────────────

export function canTransitionManagementReview(fromStatus, toStatus) {
  const allowed = MANAGEMENT_REVIEW_TRANSITIONS[fromStatus];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(toStatus);
}

/** Unresolved actions on a management review. */
export function unresolvedReviewActions(review) {
  const actions = Array.isArray(review?.actions) ? review.actions : [];
  return actions.filter((action) => action?.is_resolved !== true);
}

/**
 * A review may only close when every action is resolved, or a waiver has been
 * explicitly recorded.
 */
export function canCloseManagementReview(review) {
  if (!review) return false;
  if (!canTransitionManagementReview(review.review_status, "closed")) return false;
  if (review.waiver_recorded === true) return true;
  return unresolvedReviewActions(review).length === 0;
}

// ── Release gate sequencing ──────────────────────────────────────────────────

/**
 * A gate may only pass when every earlier gate in RELEASE_GATE_SEQUENCE has
 * already passed. `gates` is the full list of release_gate rows.
 */
export function canPassReleaseGate(gateCode, gates) {
  const index = RELEASE_GATE_SEQUENCE.indexOf(gateCode);
  if (index < 0) return false;
  const rows = Array.isArray(gates) ? gates : [];
  for (let i = 0; i < index; i += 1) {
    const prerequisite = RELEASE_GATE_SEQUENCE[i];
    const row = rows.find((g) => g?.gate_code === prerequisite);
    if (!row || row.gate_status !== "passed") return false;
  }
  return true;
}

/** Unmet prerequisites for a gate, in sequence order. */
export function releaseGateBlockers(gateCode, gates) {
  const index = RELEASE_GATE_SEQUENCE.indexOf(gateCode);
  if (index < 0) return [`unknown gate ${gateCode}`];
  const rows = Array.isArray(gates) ? gates : [];
  const blockers = [];
  for (let i = 0; i < index; i += 1) {
    const prerequisite = RELEASE_GATE_SEQUENCE[i];
    const row = rows.find((g) => g?.gate_code === prerequisite);
    if (!row || row.gate_status !== "passed") blockers.push(prerequisite);
  }
  return blockers;
}

// ── Dependency graph traversal ───────────────────────────────────────────────

/**
 * Breadth-first downstream traversal of dependency edges with cycle safety.
 * Returns [{ node, depth, kg_id, edge_type, from_node }] excluding the origin.
 */
export function traverseDependencyImpact(edges, fromNode, maxDepth = 5) {
  const list = Array.isArray(edges) ? edges : [];
  if (!fromNode) return [];
  const depthLimit = Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 1;

  const adjacency = new Map();
  for (const edge of list) {
    if (!edge?.from_node || !edge?.to_node) continue;
    if (!adjacency.has(edge.from_node)) adjacency.set(edge.from_node, []);
    adjacency.get(edge.from_node).push(edge);
  }

  const visited = new Set([fromNode]);
  const impacted = [];
  let frontier = [fromNode];

  for (let depth = 1; depth <= depthLimit && frontier.length > 0; depth += 1) {
    const nextFrontier = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        if (visited.has(edge.to_node)) continue;
        visited.add(edge.to_node);
        impacted.push({
          node: edge.to_node,
          depth,
          kg_id: edge.kg_id ?? null,
          edge_type: edge.edge_type ?? "depends_on",
          from_node: edge.from_node,
        });
        nextFrontier.push(edge.to_node);
      }
    }
    frontier = nextFrontier;
  }

  return impacted;
}

/** Detects whether the edge set contains at least one directed cycle. */
export function hasDependencyCycle(edges) {
  const list = Array.isArray(edges) ? edges : [];
  const adjacency = new Map();
  for (const edge of list) {
    if (!edge?.from_node || !edge?.to_node) continue;
    if (!adjacency.has(edge.from_node)) adjacency.set(edge.from_node, []);
    adjacency.get(edge.from_node).push(edge.to_node);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colors = new Map();
  for (const node of adjacency.keys()) colors.set(node, WHITE);

  const stack = [];
  for (const start of adjacency.keys()) {
    if (colors.get(start) !== WHITE) continue;
    stack.push({ node: start, phase: "enter" });
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame.phase === "exit") {
        colors.set(frame.node, BLACK);
        continue;
      }
      if (colors.get(frame.node) === GREY) return true;
      if (colors.get(frame.node) === BLACK) continue;
      colors.set(frame.node, GREY);
      stack.push({ node: frame.node, phase: "exit" });
      for (const next of adjacency.get(frame.node) ?? []) {
        if (colors.get(next) === GREY) return true;
        if ((colors.get(next) ?? WHITE) === WHITE) {
          stack.push({ node: next, phase: "enter" });
        }
      }
    }
  }
  return false;
}

// ── Continuity lifecycle ─────────────────────────────────────────────────────

export function canTransitionContinuity(fromStatus, toStatus) {
  const allowed = CONTINUITY_TRANSITIONS[fromStatus];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(toStatus);
}

export function nextContinuityStatuses(fromStatus) {
  const allowed = CONTINUITY_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) ? [...allowed] : [];
}

const OFFLINE_CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;

/** Offline correlation ids must be stable, printable, and non-trivial. */
export function isValidOfflineCorrelationId(value) {
  if (typeof value !== "string") return false;
  return OFFLINE_CORRELATION_PATTERN.test(value);
}

/** Transactions that still need reconciliation. */
export function pendingContinuityTransactions(transactions) {
  const rows = Array.isArray(transactions) ? transactions : [];
  return rows.filter((row) => row?.reconciliation_status === "pending");
}

/**
 * A continuity session may only close when reconciliation is complete and no
 * transaction is still pending, unless a waiver is explicitly recorded.
 */
export function canCloseContinuitySession(session, transactions = []) {
  if (!session) return false;
  if (!canTransitionContinuity(session.session_status, "closed")) return false;
  if (session.waiver_recorded === true) return true;
  if (!session.reconciliation_completed_at) return false;
  return pendingContinuityTransactions(transactions).length === 0;
}

/**
 * Idempotent reconciliation resolution.
 * Re-reconciling an already reconciled transaction returns the existing record
 * unchanged (applied = false) — reconciliation never silently overwrites.
 */
export function resolveContinuityReconciliation(existing, reconciliation) {
  if (!existing) {
    throw new Error("Wave 6: cannot reconcile a transaction that does not exist");
  }
  const status = reconciliation?.reconciliation_status;
  if (!["matched", "discrepancy", "waived"].includes(status)) {
    throw new Error(
      `Wave 6: invalid reconciliation status "${status}" (expected matched, discrepancy or waived)`
    );
  }
  if (status === "discrepancy" && !reconciliation?.discrepancy_notes) {
    throw new Error("Wave 6: a discrepancy reconciliation requires discrepancy_notes");
  }
  if (status === "waived" && !reconciliation?.waiver_evidence) {
    throw new Error("Wave 6: a waived reconciliation requires waiver_evidence");
  }

  if (existing.reconciliation_status !== "pending") {
    return { applied: false, transaction: existing };
  }

  return {
    applied: true,
    transaction: {
      ...existing,
      ...reconciliation,
    },
  };
}

/** Session-scoped uniqueness check for offline correlation ids. */
export function isDuplicateOfflineCorrelation(transactions, sessionId, correlationId) {
  const rows = Array.isArray(transactions) ? transactions : [];
  return rows.some(
    (row) =>
      row?.continuity_session_id === sessionId &&
      row?.offline_correlation_id === correlationId
  );
}
