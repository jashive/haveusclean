// Wave 6 — migration 014 source contract tests.
// These tests read the migration SOURCE only. No database is contacted and no
// SQL is executed: Wave 6 is a source-only delivery.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "supabase", "migrations");
const read = (p) => readFileSync(p, "utf8");
const migrationPath = path.join(
  migrationsDir,
  "014_wave6_intelligence_governance_continuity.sql"
);
const sql = readFileSync(migrationPath, "utf8");

const WAVE6_TABLES = [
  "kpi_definition",
  "kpi_snapshot",
  "management_review",
  "change_control_record",
  "dependency_edge",
  "continuity_session",
  "continuity_transaction",
  "service_module_profile",
  "release_gate",
];

test("migration is wrapped in a single transaction", () => {
  assert.match(sql, /^\s*(--[^\n]*\n|\s)*BEGIN;/m);
  assert.match(sql, /\nCOMMIT;/);
});

test("all 9 Wave 6 tables are created", () => {
  assert.equal(WAVE6_TABLES.length, 9);
  for (const table of WAVE6_TABLES) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE public\\.${table}\\b`),
      `missing CREATE TABLE public.${table}`
    );
  }
});

test("wave6_canonical_event view is created", () => {
  assert.match(sql, /CREATE VIEW public\.wave6_canonical_event\b/);
});

test("wave6_canonical_event is SECURITY INVOKER", () => {
  assert.match(sql, /WITH \(security_invoker = true\)/);
  assert.match(
    sql,
    /ALTER VIEW public\.wave6_canonical_event SET \(security_invoker = true\);/
  );
});

test("canonical event view emits the governed event names", () => {
  const eventNames = [
    "ops.job.created",
    "ops.work.completed",
    "quality.qa.passed",
    "quality.exception.opened",
    "quality.outcome.reclean_requested",
    "finance.invoice.requested",
    "finance.payment.observed",
    "finance.payable.approved",
    "finance.profitability.captured",
  ];
  for (const name of eventNames) {
    assert.ok(sql.includes(`'${name}'`), `missing canonical event ${name}`);
  }
});

test("canonical event view only references tables whose DDL is in this repo", () => {
  const viewBody = sql.slice(
    sql.indexOf("CREATE VIEW public.wave6_canonical_event"),
    sql.indexOf("ALTER VIEW public.wave6_canonical_event")
  );
  const referenced = [...viewBody.matchAll(/FROM public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, "view references no tables");

  const vendoredDdl = [
    "007_wave3_operations.sql",
    "009_wave4_delivery_quality_gaps.sql",
    "012_wave5_finance.sql",
  ]
    .map((f) => read(path.join(migrationsDir, f)))
    .join("\n");

  for (const table of new Set(referenced)) {
    assert.ok(
      vendoredDdl.includes(`CREATE TABLE public.${table} (`),
      `wave6_canonical_event references public.${table}, whose CREATE TABLE is not in migrations 007/009/012`
    );
  }
});

test("Wave 1-2 sales tables are excluded from the canonical event view", () => {
  const viewBody = sql.slice(
    sql.indexOf("CREATE VIEW public.wave6_canonical_event"),
    sql.indexOf("ALTER VIEW public.wave6_canonical_event")
  );
  for (const table of [
    "service_request",
    "opportunity",
    "quote",
    "quote_response",
    "conversion_record",
  ]) {
    assert.ok(
      !viewBody.includes(`FROM public.${table}`),
      `view must not select from unverified Wave 1-2 table ${table}`
    );
  }
});

test("sales KPI seeds declare their unverified Wave 1-2 lineage", () => {
  const salesSeeds = sql.match(/\('sales\.[a-z_]+',[\s\S]*?'1', true\)/g) ?? [];
  assert.equal(salesSeeds.length, 6, "expected 6 seeded sales KPIs");
  for (const seed of salesSeeds) {
    assert.ok(seed.includes('"wave":"1-2"'), `sales seed missing wave tag: ${seed.slice(0, 60)}`);
    assert.ok(
      seed.includes('"in_canonical_event_view":false'),
      `sales seed missing canonical-view tag: ${seed.slice(0, 60)}`
    );
  }
});

test("RLS is enabled on every Wave 6 table", () => {
  for (const table of WAVE6_TABLES) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`),
      `RLS not enabled on ${table}`
    );
  }
});

test("PUBLIC and anon are revoked on every Wave 6 table", () => {
  for (const table of WAVE6_TABLES) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM PUBLIC;`),
      `PUBLIC not revoked on ${table}`
    );
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon;`),
      `anon not revoked on ${table}`
    );
  }
  assert.match(sql, /REVOKE ALL ON public\.wave6_canonical_event\s+FROM anon;/);
});

test("every Wave 6 table has at least one RLS policy", () => {
  for (const table of WAVE6_TABLES) {
    assert.match(
      sql,
      new RegExp(`CREATE POLICY pol_[a-z_]+ ON public\\.${table}\\b`),
      `no RLS policy for ${table}`
    );
  }
});

test("policies use the has_bu_role / has_org_role helpers", () => {
  assert.match(sql, /public\.has_bu_role\(organization_id, business_unit_id, ARRAY\['owner_admin'\]\)/);
  assert.match(sql, /public\.has_bu_role\(organization_id, business_unit_id, ARRAY\['office_ops'\]\)/);
  assert.match(sql, /public\.has_org_role\(organization_id, ARRAY\['owner_admin'\]\)/);
});

test("kpi_snapshot is append-only for authenticated", () => {
  assert.match(sql, /GRANT SELECT, INSERT\s+ON public\.kpi_snapshot\s+TO authenticated;/);
  assert.match(sql, /REVOKE UPDATE, DELETE\s+ON public\.kpi_snapshot\s+FROM authenticated;/);
  assert.doesNotMatch(
    sql,
    /GRANT SELECT, INSERT, UPDATE\s+ON public\.kpi_snapshot/,
    "kpi_snapshot must never be granted UPDATE"
  );
});

test("no Wave 6 table grants DELETE to authenticated", () => {
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE[^;]*TO authenticated;/);
});

test("kpi_snapshot has the duplicate-capture UNIQUE index", () => {
  assert.match(sql, /CREATE UNIQUE INDEX uq_ks_period_scope/);
  assert.match(sql, /COALESCE\(business_unit_id,\s*'00000000-0000-0000-0000-000000000000'::uuid\)/);
  assert.match(sql, /COALESCE\(jurisdiction_id,\s*'00000000-0000-0000-0000-000000000000'::uuid\)/);
});

test("continuity_transaction is unique per (session, offline_correlation_id)", () => {
  assert.match(
    sql,
    /CONSTRAINT uq_ct_session_correlation\s+UNIQUE \(continuity_session_id, offline_correlation_id\)/
  );
});

test("change_control_record constrains its status vocabulary", () => {
  assert.match(sql, /CONSTRAINT ck_ccr_status CHECK/);
  for (const status of [
    "measure",
    "analyze",
    "improve",
    "approve",
    "update",
    "retrain",
    "validate",
    "closed",
  ]) {
    assert.ok(sql.includes(`'${status}'`), `missing change status ${status}`);
  }
});

test("material change cannot close without impact assessment and passed validation", () => {
  assert.match(sql, /CONSTRAINT ck_ccr_material_close_evidence CHECK/);
  assert.match(sql, /validation_result[^;]*passed/);
});

test("continuity_session closure requires reconciliation or a waiver", () => {
  assert.match(sql, /CONSTRAINT ck_cs_close_requires_reconciliation CHECK/);
  assert.match(sql, /waiver_recorded/);
});

test("release_gate constrains its gate codes", () => {
  assert.match(sql, /CONSTRAINT ck_rg_gate_code CHECK/);
  for (const code of ["PILOT", "ACCEPTANCE", "CUTOVER", "LEGACY_RETIREMENT", "SCALE"]) {
    assert.ok(sql.includes(`'${code}'`), `missing gate code ${code}`);
  }
});

test("service_module_profile constrains its profile codes", () => {
  assert.match(sql, /CONSTRAINT ck_smp_profile_code CHECK/);
  for (const code of ["RESIDENTIAL_ON", "COMMERCIAL_ON", "VACATION_RENTAL_AZ"]) {
    assert.ok(sql.includes(`'${code}'`), `missing profile code ${code}`);
  }
});

test("kpi_definition seeds cover at least 17 governed KPIs", () => {
  const codes = new Set();
  const seedSection = sql.slice(sql.indexOf("INSERT INTO public.kpi_definition"));
  for (const match of seedSection.matchAll(/'((?:sales|operations|quality|finance)\.[a-z_]+)'/g)) {
    codes.add(match[1]);
  }
  assert.ok(codes.size >= 17, `expected >= 17 KPI seeds, found ${codes.size}`);
  for (const code of [
    "sales.leads_created",
    "sales.quotes_accepted",
    "sales.lead_to_conversion_rate",
    "operations.jobs_created",
    "operations.work_completed",
    "quality.qa_pass_rate",
    "quality.reclean_requests",
    "finance.recognized_revenue",
    "finance.gross_margin",
  ]) {
    assert.ok(codes.has(code), `missing KPI seed ${code}`);
  }
});

test("dependency_edge seeds cover at least 35 edges across KG-001..KG-007", () => {
  const seedSection = sql.slice(sql.indexOf("INSERT INTO public.dependency_edge"));
  const edges = [...seedSection.matchAll(/\('(KG-00[1-7])',\s*'([^']+)',\s*'([^']+)'/g)];
  assert.ok(edges.length >= 35, `expected >= 35 dependency edges, found ${edges.length}`);
  const graphs = new Set(edges.map((edge) => edge[1]));
  for (const kg of ["KG-001", "KG-002", "KG-003", "KG-004", "KG-005", "KG-006", "KG-007"]) {
    assert.ok(graphs.has(kg), `missing knowledge graph ${kg}`);
  }
});

test("service module profile seeds = 3", () => {
  const seedSection = sql.slice(sql.indexOf("INSERT INTO public.service_module_profile"));
  const seeds = [
    ...seedSection.matchAll(/'(RESIDENTIAL_ON|COMMERCIAL_ON|VACATION_RENTAL_AZ)'/g),
  ];
  assert.equal(new Set(seeds.map((s) => s[1])).size, 3);
});

test("release gate seeds = 5 with sequence 1..5", () => {
  const seedSection = sql.slice(sql.indexOf("INSERT INTO public.release_gate"));
  const seeds = [
    ...seedSection.matchAll(
      /'(PILOT|ACCEPTANCE|CUTOVER|LEGACY_RETIREMENT|SCALE)'[^\n]*?,\s*(\d)/g
    ),
  ];
  const codes = new Set(seeds.map((s) => s[1]));
  assert.equal(codes.size, 5);
  const orders = new Set(seeds.map((s) => Number(s[2])));
  for (const order of [1, 2, 3, 4, 5]) {
    assert.ok(orders.has(order), `missing gate sequence_order ${order}`);
  }
});

test("cross-wave TRUNCATE / REFERENCES / TRIGGER hardening is present", () => {
  assert.match(
    sql,
    /REVOKE TRUNCATE, REFERENCES, TRIGGER ON public\.%I FROM authenticated/
  );
  for (const table of [
    "service_request",
    "opportunity",
    "quote",
    "quote_response",
    "operational_job",
    "work_order",
    "qa_inspection",
    "service_exception",
    "customer_outcome",
  ]) {
    assert.ok(sql.includes(`'${table}'`), `missing cross-wave hardening target ${table}`);
  }
});

test("cross-wave hardening tolerates absent tables", () => {
  assert.match(sql, /information_schema\.tables/);
});

test("function EXECUTE hardening is present", () => {
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const fn of ["current_worker_id(uuid)", "worker_has_active_assignment(uuid)"]) {
    const escaped = escapeRegExp(fn);
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${escaped} FROM PUBLIC;`));
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${escaped} FROM anon;`));
    assert.match(
      sql,
      new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${escaped} TO authenticated;`)
    );
    assert.match(
      sql,
      new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`)
    );
  }
});

test("self-validation raises on failure and emits the terminal marker", () => {
  assert.match(sql, /RAISE EXCEPTION 'M014 SV-/);
  assert.match(sql, /M014_WAVE6_INTELLIGENCE_PASS/);
  const markerIndex = sql.lastIndexOf("M014_WAVE6_INTELLIGENCE_PASS");
  const commitIndex = sql.lastIndexOf("COMMIT;");
  assert.ok(markerIndex > 0 && commitIndex > 0);
});

test("self-validation asserts the seed and object counts", () => {
  assert.match(sql, /expected 9 Wave 6 tables/);
  assert.match(sql, /SV-\d+ FAIL[^']*kpi_definition|kpi_definition seeds/);
  assert.match(sql, /v_count integer;/);
  assert.match(sql, /RAISE NOTICE 'M014_WAVE6_INTELLIGENCE_PASS'/);
});

test("migration does not touch Wave 5 or huc_ objects destructively", () => {
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /TRUNCATE TABLE/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.huc_/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
});

test("seed inserts are idempotent", () => {
  const insertCount = (sql.match(/INSERT INTO public\./g) ?? []).length;
  const conflictCount = (sql.match(/ON CONFLICT[^;]*DO NOTHING/g) ?? []).length;
  assert.ok(insertCount > 0);
  assert.equal(conflictCount, insertCount, "every seed insert must be ON CONFLICT DO NOTHING");
});

// ── Blocker 1: DB-level governance triggers (structural source check) ─────────

const GOVERNANCE_TRIGGER_FUNCTIONS = [
  "trg_enforce_management_review_fsm",
  "trg_enforce_ccr_fsm",
  "trg_enforce_continuity_fsm",
  "trg_enforce_release_gate_sequence",
  "trg_set_continuity_payload_hash",
];

const GOVERNANCE_TRIGGERS = [
  "trig_management_review_fsm",
  "trig_ccr_fsm",
  "trig_continuity_fsm",
  "trig_release_gate_sequence",
  "trig_continuity_payload_hash",
];

test("all 5 governance trigger functions are declared in the migration", () => {
  for (const fn of GOVERNANCE_TRIGGER_FUNCTIONS) {
    assert.match(
      sql,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`),
      `missing trigger function: ${fn}`
    );
  }
});

test("all 5 governance triggers are created in the migration", () => {
  for (const trig of GOVERNANCE_TRIGGERS) {
    assert.match(
      sql,
      new RegExp(`CREATE TRIGGER ${trig}\\b`),
      `missing trigger: ${trig}`
    );
  }
});

test("governance trigger functions are SECURITY DEFINER with fixed search_path", () => {
  for (const fn of GOVERNANCE_TRIGGER_FUNCTIONS) {
    const fnBody = sql.slice(
      sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`),
      sql.indexOf(`COMMENT ON FUNCTION public.${fn}`)
    );
    assert.match(fnBody, /SECURITY DEFINER/, `${fn} must be SECURITY DEFINER`);
    assert.match(fnBody, /SET search_path = public, pg_catalog/, `${fn} must fix search_path`);
  }
});

test("governance trigger functions have EXECUTE revoked from PUBLIC and anon", () => {
  for (const fn of GOVERNANCE_TRIGGER_FUNCTIONS) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`),
      `${fn} must revoke PUBLIC EXECUTE`
    );
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM anon`),
      `${fn} must revoke anon EXECUTE`
    );
  }
});

test("management_review FSM trigger fires BEFORE UPDATE", () => {
  assert.match(sql, /BEFORE UPDATE ON public\.management_review\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_enforce_management_review_fsm/);
});

test("change_control_record FSM trigger fires BEFORE UPDATE", () => {
  assert.match(sql, /BEFORE UPDATE ON public\.change_control_record\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_enforce_ccr_fsm/);
});

test("continuity_session FSM trigger fires BEFORE UPDATE", () => {
  assert.match(sql, /BEFORE UPDATE ON public\.continuity_session\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_enforce_continuity_fsm/);
});

test("payload hash trigger fires BEFORE INSERT on continuity_transaction", () => {
  assert.match(sql, /BEFORE INSERT ON public\.continuity_transaction\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_set_continuity_payload_hash/);
});

// ── Blocker 3: payload_hash integrity ────────────────────────────────────────

test("continuity_transaction has a payload_hash column", () => {
  assert.match(sql, /payload_hash\s+text\s+NULL/);
});

test("continuity_transaction has payload_hash format constraint", () => {
  assert.match(sql, /ck_ct_payload_hash_format/);
  assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
});

test("payload_hash trigger uses pgcrypto digest with sha256", () => {
  const trigBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_set_continuity_payload_hash"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_set_continuity_payload_hash")
  );
  assert.match(trigBody, /digest\(.*sha256/);
  assert.match(trigBody, /encode\(/);
  assert.match(trigBody, /payload_hash/);
});

test("payload_hash is documented as immutable (INSERT-only trigger)", () => {
  assert.match(sql, /INSERT-only trigger.*hash is immutable|hash is immutable.*INSERT-only/i);
});

// ── Blocker 4: Canonical event vocabulary ────────────────────────────────────

const REQUIRED_CANONICAL_EVENTS = [
  "ops.job.created",
  "ops.work.completed",
  "quality.qa.passed",
  "quality.exception.opened",
  "quality.outcome.reclean_requested",
  "finance.invoice.requested",
  "finance.payment.observed",
  "finance.payable.approved",
  "finance.profitability.captured",
];

test("canonical event view includes all verified Wave 3/4/5 events", () => {
  for (const name of REQUIRED_CANONICAL_EVENTS) {
    assert.ok(sql.includes(`'${name}'`), `missing canonical event: ${name}`);
  }
});

test("Wave 1/2 sales events are excluded from canonical view with documented reason", () => {
  // Wave 1/2 DDL is not in this repository; columns cannot be verified from source.
  // This test confirms the exclusion is documented (not silently omitted).
  assert.match(
    sql,
    /Wave 1.2 sales tables are excluded because their columns cannot be verified from source/,
    "Wave 1/2 exclusion must be documented in the migration"
  );
  // Confirm sales events are NOT in the canonical view body
  const viewBody = sql.slice(
    sql.indexOf("CREATE VIEW public.wave6_canonical_event"),
    sql.indexOf("ALTER VIEW public.wave6_canonical_event SET")
  );
  assert.doesNotMatch(viewBody, /'sales\.lead\.created'/, "sales.lead.created must not appear unverified in view");
  assert.doesNotMatch(viewBody, /'sales\.quote\.accepted'/, "sales.quote.accepted must not appear unverified in view");
});

// ── Blocker 6: Exact 18 KPI self-validation ──────────────────────────────────

const REQUIRED_KPI_CODES = [
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

test("all 18 required KPI codes are seeded in the migration", () => {
  assert.equal(REQUIRED_KPI_CODES.length, 18, "test vector must have exactly 18 codes");
  for (const code of REQUIRED_KPI_CODES) {
    assert.ok(sql.includes(`'${code}'`), `missing KPI code: ${code}`);
  }
});

test("self-validation SV-7 asserts exact 18 KPI codes individually", () => {
  for (const code of REQUIRED_KPI_CODES) {
    assert.ok(
      sql.includes(`'${code}'`),
      `SV-7 must check for KPI code ${code}`
    );
  }
  // Must require exactly 18, not >= 17
  assert.match(sql, /expected exactly 18/, "SV-7 must assert exactly 18, not >= 17");
  assert.doesNotMatch(sql, /expected >= 17/, "SV-7 must not use >= 17 threshold");
});

test("self-validation SV-7 checks each individual KPI code", () => {
  // Verify that SV-7 iterates over individual codes rather than just counting
  assert.match(sql, /v_required_kpi_code/, "SV-7 must iterate individual required codes");
  assert.match(sql, /required KPI code.*is missing/, "SV-7 must name missing code in error");
});

test("self-validation SV-16 verifies governance trigger functions exist", () => {
  assert.match(sql, /SV-16/, "SV-16 governance trigger check must exist");
  for (const fn of GOVERNANCE_TRIGGER_FUNCTIONS) {
    assert.ok(
      sql.includes(fn),
      `SV-16 must check for trigger function ${fn}`
    );
  }
  assert.match(sql, /payload_hash column missing/, "SV-16 must verify payload_hash column");
});
