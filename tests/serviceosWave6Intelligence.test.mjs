// Wave 6 — intelligence utilities (period math, rates, KPI computation) and
// the client source contract. Pure tests: no network, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  KPI_CODES,
  computeKpiValue,
  computeRate,
  computeWeightedGrossMargin,
  formatPeriodLabel,
  getKpiSpec,
  getPeriodBoundaries,
} from "../src/lib/serviceosIntelligenceUtils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(
  path.join(here, "..", "src", "lib", "serviceosIntelligenceClient.js"),
  "utf8"
);
const utilsSource = readFileSync(
  path.join(here, "..", "src", "lib", "serviceosIntelligenceUtils.js"),
  "utf8"
);

const TORONTO = "America/Toronto";
const PHOENIX = "America/Phoenix";

// ── Period boundaries ────────────────────────────────────────────────────────

test("getPeriodBoundaries DAILY Toronto standard time", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "DAILY",
    new Date("2026-01-15T18:30:00Z"),
    TORONTO
  );
  // EST = UTC-5 → local midnight is 05:00Z
  assert.equal(periodStart.toISOString(), "2026-01-15T05:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-01-16T04:59:59.999Z");
});

test("getPeriodBoundaries DAILY Toronto daylight time", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "DAILY",
    new Date("2026-07-15T18:30:00Z"),
    TORONTO
  );
  // EDT = UTC-4 → local midnight is 04:00Z
  assert.equal(periodStart.toISOString(), "2026-07-15T04:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-07-16T03:59:59.999Z");
});

test("getPeriodBoundaries DAILY Phoenix has no DST", () => {
  const winter = getPeriodBoundaries("DAILY", new Date("2026-01-15T18:30:00Z"), PHOENIX);
  const summer = getPeriodBoundaries("DAILY", new Date("2026-07-15T18:30:00Z"), PHOENIX);
  // MST = UTC-7 all year
  assert.equal(winter.periodStart.toISOString(), "2026-01-15T07:00:00.000Z");
  assert.equal(summer.periodStart.toISOString(), "2026-07-15T07:00:00.000Z");
  assert.equal(summer.periodEnd.toISOString(), "2026-07-16T06:59:59.999Z");
});

test("getPeriodBoundaries MONTHLY Toronto", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "MONTHLY",
    new Date("2026-02-14T12:00:00Z"),
    TORONTO
  );
  assert.equal(periodStart.toISOString(), "2026-02-01T05:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-03-01T04:59:59.999Z");
});

test("Toronto DST: March month boundary crosses spring forward correctly", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "MONTHLY",
    new Date("2026-03-20T12:00:00Z"),
    TORONTO
  );
  // March 1 is still EST (UTC-5); April 1 is EDT (UTC-4)
  assert.equal(periodStart.toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-04-01T03:59:59.999Z");
});

test("Toronto DST: November month boundary crosses fall back correctly", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "MONTHLY",
    new Date("2026-11-15T12:00:00Z"),
    TORONTO
  );
  assert.equal(periodStart.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-12-01T04:59:59.999Z");
});

test("getPeriodBoundaries QUARTERLY Toronto", () => {
  const q1 = getPeriodBoundaries("QUARTERLY", new Date("2026-02-14T12:00:00Z"), TORONTO);
  assert.equal(q1.periodStart.toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(q1.periodEnd.toISOString(), "2026-04-01T03:59:59.999Z");

  const q3 = getPeriodBoundaries("QUARTERLY", new Date("2026-08-14T12:00:00Z"), TORONTO);
  assert.equal(q3.periodStart.toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(q3.periodEnd.toISOString(), "2026-10-01T03:59:59.999Z");
});

test("getPeriodBoundaries YEARLY Toronto", () => {
  const { periodStart, periodEnd } = getPeriodBoundaries(
    "YEARLY",
    new Date("2026-08-14T12:00:00Z"),
    TORONTO
  );
  assert.equal(periodStart.toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2027-01-01T04:59:59.999Z");
});

test("getPeriodBoundaries rejects an unknown period type", () => {
  assert.throws(() => getPeriodBoundaries("WEEKLY", new Date(), TORONTO));
});

test("getPeriodBoundaries rejects a missing timezone", () => {
  assert.throws(() => getPeriodBoundaries("DAILY", new Date(), ""));
});

test("formatPeriodLabel renders governed labels", () => {
  const daily = getPeriodBoundaries("DAILY", new Date("2026-03-20T12:00:00Z"), TORONTO);
  assert.equal(formatPeriodLabel("DAILY", daily.periodStart, TORONTO), "2026-03-20");

  const monthly = getPeriodBoundaries("MONTHLY", new Date("2026-03-20T12:00:00Z"), TORONTO);
  assert.equal(formatPeriodLabel("MONTHLY", monthly.periodStart, TORONTO), "March 2026");

  const quarterly = getPeriodBoundaries("QUARTERLY", new Date("2026-08-20T12:00:00Z"), TORONTO);
  assert.equal(formatPeriodLabel("QUARTERLY", quarterly.periodStart, TORONTO), "Q3 2026");

  const yearly = getPeriodBoundaries("YEARLY", new Date("2026-08-20T12:00:00Z"), TORONTO);
  assert.equal(formatPeriodLabel("YEARLY", yearly.periodStart, TORONTO), "2026");
});

// ── Rates ────────────────────────────────────────────────────────────────────

test("computeRate never returns Infinity or NaN", () => {
  assert.equal(computeRate(0, 0), null);
  assert.equal(computeRate(5, 0), null);
  assert.equal(computeRate(null, 5), null);
  assert.equal(computeRate(5, null), null);
  assert.equal(computeRate(undefined, undefined), null);
  assert.equal(computeRate("x", 5), null);
});

test("computeRate computes a real ratio", () => {
  assert.equal(computeRate(5, 10), 0.5);
  assert.equal(computeRate(0, 10), 0);
  assert.equal(computeRate(3, 4), 0.75);
});

// ── Weighted gross margin ────────────────────────────────────────────────────

test("computeWeightedGrossMargin returns null on empty input", () => {
  assert.equal(computeWeightedGrossMargin([]), null);
  assert.equal(computeWeightedGrossMargin(null), null);
});

test("computeWeightedGrossMargin returns null when revenue is zero", () => {
  assert.equal(
    computeWeightedGrossMargin([
      { recognized_revenue_amount: 0, gross_contribution: 0 },
      { recognized_revenue_amount: 0, gross_contribution: 10 },
    ]),
    null
  );
});

test("computeWeightedGrossMargin weights by revenue, not by job count", () => {
  const jobs = [
    { recognized_revenue_amount: 100, gross_contribution: 40 },
    { recognized_revenue_amount: 300, gross_contribution: 60 },
  ];
  assert.equal(computeWeightedGrossMargin(jobs), 0.25);
});

// ── KPI computation ──────────────────────────────────────────────────────────

test("KPI catalogue covers at least 17 governed codes", () => {
  assert.ok(KPI_CODES.length >= 17, `expected >= 17 KPI codes, got ${KPI_CODES.length}`);
  for (const code of KPI_CODES) {
    assert.ok(getKpiSpec(code), `no computation spec for ${code}`);
  }
});

test("computeKpiValue counts sales.leads_created", () => {
  const result = computeKpiValue({
    kpiCode: "sales.leads_created",
    sourceRows: { service_request: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    periodType: "DAILY",
  });
  assert.equal(result.value, 3);
  assert.equal(result.numerator, null);
  assert.equal(result.denominator, null);
});

test("computeKpiValue accepts a bare array for single-source KPIs", () => {
  const result = computeKpiValue({
    kpiCode: "operations.jobs_created",
    sourceRows: [{ id: "a" }, { id: "b" }],
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 2);
});

test("computeKpiValue uses the real quote_response vocabulary", () => {
  const result = computeKpiValue({
    kpiCode: "sales.quotes_accepted",
    sourceRows: {
      quote_response: [
        { response_type: "accepted" },
        { response_type: "declined" },
        { response_type: "accepted" },
        { response_type: "counter" },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 2);
});

test("computeKpiValue uses the real work_order status vocabulary", () => {
  const result = computeKpiValue({
    kpiCode: "operations.work_completed",
    sourceRows: {
      work_order: [
        { work_order_status: "qa_complete" },
        { work_order_status: "closed" },
        { work_order_status: "in_progress" },
        { work_order_status: "draft" },
        { work_order_status: "cancelled" },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 2);
});

test("computeKpiValue computes quality.qa_pass_rate from inspection_status", () => {
  const result = computeKpiValue({
    kpiCode: "quality.qa_pass_rate",
    sourceRows: {
      qa_inspection: [
        { inspection_status: "passed" },
        { inspection_status: "passed" },
        { inspection_status: "failed" },
        { inspection_status: "pending" },
        { inspection_status: "waived" },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.numerator, 2);
  assert.equal(result.denominator, 3);
  assert.ok(Math.abs(result.value - 2 / 3) < 1e-12);
});

test("computeKpiValue returns null (not NaN) for a rate with no denominator", () => {
  const result = computeKpiValue({
    kpiCode: "quality.qa_pass_rate",
    sourceRows: { qa_inspection: [{ inspection_status: "pending" }] },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, null);
  assert.equal(result.denominator, 0);
});

test("computeKpiValue computes sales.lead_to_conversion_rate across two tables", () => {
  const result = computeKpiValue({
    kpiCode: "sales.lead_to_conversion_rate",
    sourceRows: {
      conversion_record: [{ id: "c1" }, { id: "c2" }],
      service_request: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.numerator, 2);
  assert.equal(result.denominator, 4);
  assert.equal(result.value, 0.5);
});

test("computeKpiValue uses the real customer_outcome vocabulary", () => {
  const result = computeKpiValue({
    kpiCode: "quality.reclean_requests",
    sourceRows: {
      customer_outcome: [
        { outcome_type: "reclean_request" },
        { outcome_type: "complaint" },
        { outcome_type: "praise" },
        { outcome_type: "reclean_request" },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 2);
});

test("computeKpiValue uses the real contractor_payable vocabulary", () => {
  const result = computeKpiValue({
    kpiCode: "finance.contractor_payable_approved",
    sourceRows: {
      contractor_payable: [
        { payable_status: "approved", computed_amount: 100 },
        { payable_status: "pending", computed_amount: 999 },
        { payable_status: "approved", computed_amount: 50.5 },
        { payable_status: "voided", computed_amount: 999 },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 150.5);
});

test("computeKpiValue sums finance.recognized_revenue", () => {
  const result = computeKpiValue({
    kpiCode: "finance.recognized_revenue",
    sourceRows: {
      job_profitability_snapshot: [
        { recognized_revenue_amount: 200 },
        { recognized_revenue_amount: 300.25 },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 500.25);
});

test("computeKpiValue computes finance.gross_margin as a weighted average", () => {
  const result = computeKpiValue({
    kpiCode: "finance.gross_margin",
    sourceRows: {
      job_profitability_snapshot: [
        { recognized_revenue_amount: 100, gross_contribution: 40 },
        { recognized_revenue_amount: 300, gross_contribution: 60 },
      ],
    },
    periodType: "MONTHLY",
  });
  assert.equal(result.value, 0.25);
  assert.equal(result.numerator, 100);
  assert.equal(result.denominator, 400);
});

test("computeKpiValue throws on an unknown KPI code (fail closed)", () => {
  assert.throws(() =>
    computeKpiValue({ kpiCode: "sales.not_a_kpi", sourceRows: {}, periodType: "DAILY" })
  );
});

test("computeKpiValue never yields NaN for empty sources", () => {
  for (const code of KPI_CODES) {
    const result = computeKpiValue({ kpiCode: code, sourceRows: {}, periodType: "DAILY" });
    assert.ok(!Number.isNaN(result.value), `${code} produced NaN`);
    if (result.value !== null) {
      assert.ok(Number.isFinite(result.value), `${code} produced a non-finite value`);
    }
  }
});

// ── Client source contract ───────────────────────────────────────────────────

test("client routes every request through authenticatedRestFetchWithRefresh", () => {
  assert.match(
    clientSource,
    /import \{ authenticatedRestFetchWithRefresh \} from "\.\/serviceosAuthClient\.js"/
  );
  const helperCalls = (clientSource.match(/authenticatedRestFetchWithRefresh\(/g) ?? []).length;
  assert.ok(helperCalls >= 3, "expected the auth helper to be used by all REST primitives");
});

test("client exposes the governed Wave 6 surface", () => {
  for (const fn of [
    "fetchKpiSourceData",
    "computePeriodKpis",
    "captureKpiSnapshot",
    "loadKpiSnapshots",
    "loadCanonicalEvents",
    "loadManagementReviews",
    "createManagementReview",
    "updateManagementReview",
    "loadChangeControlRecords",
    "createChangeControlRecord",
    "updateChangeControlRecord",
    "loadDependencyImpact",
    "loadContinuitySessions",
    "createContinuitySession",
    "updateContinuitySession",
    "recordContinuityTransaction",
    "reconcileContinuityTransaction",
    "loadServiceModuleProfiles",
    "loadReleaseGates",
  ]) {
    assert.ok(
      new RegExp(`export async function ${fn}\\b`).test(clientSource),
      `client is missing export ${fn}`
    );
  }
});

test("loadKpiSnapshots reads the append-only evidence table", () => {
  assert.match(clientSource, /selectRows\("kpi_snapshot"/);
  assert.doesNotMatch(clientSource, /patchRowById\("kpi_snapshot"/);
  assert.doesNotMatch(clientSource, /method: "DELETE"/);
});

test("client never references a service-role credential", () => {
  for (const source of [clientSource, utilsSource]) {
    assert.doesNotMatch(source, /SERVICE_ROLE/i);
    assert.doesNotMatch(source, /service_role_key/i);
    assert.doesNotMatch(source, /serviceRoleKey/i);
  }
});

test("client and utils never log or serialize credentials", () => {
  for (const source of [clientSource, utilsSource]) {
    assert.doesNotMatch(source, /console\.(log|info|debug|warn)\(/);
    assert.doesNotMatch(source, /JSON\.stringify\([^)]*access_token/);
    assert.doesNotMatch(source, /JSON\.stringify\([^)]*session\b/);
  }
});

test("utils module is pure — no network, no storage, no import.meta", () => {
  assert.doesNotMatch(utilsSource, /\bfetch\(/);
  assert.doesNotMatch(utilsSource, /localStorage/);
  assert.doesNotMatch(utilsSource, /import\.meta/);
});
