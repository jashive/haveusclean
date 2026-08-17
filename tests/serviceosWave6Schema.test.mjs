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

test("canonical event view only references tables with verified DDL", () => {
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

  // service_request and quote_response are independently verified (2026-08-17)
  // against the live Supabase project; their DDL is not in this repo but their
  // columns have been confirmed. All other tables must be from vendored migrations.
  const liveVerifiedTables = new Set(["service_request", "quote_response"]);

  for (const table of new Set(referenced)) {
    if (liveVerifiedTables.has(table)) continue;
    assert.ok(
      vendoredDdl.includes(`CREATE TABLE public.${table} (`),
      `wave6_canonical_event references public.${table}, whose CREATE TABLE is not in migrations 007/009/012`
    );
  }
});

test("sales.lead.created and sales.quote.accepted are in the canonical event view", () => {
  // service_request and quote_response columns are independently verified (2026-08-17).
  // The canonical events for lead creation and quote acceptance are now included.
  const viewBody = sql.slice(
    sql.indexOf("CREATE VIEW public.wave6_canonical_event"),
    sql.indexOf("ALTER VIEW public.wave6_canonical_event")
  );
  assert.ok(
    viewBody.includes("FROM public.service_request"),
    "view must include service_request for sales.lead.created"
  );
  assert.ok(
    viewBody.includes("FROM public.quote_response"),
    "view must include quote_response for sales.quote.accepted"
  );
  assert.ok(viewBody.includes("'sales.lead.created'"), "missing sales.lead.created event");
  assert.ok(viewBody.includes("'sales.quote.accepted'"), "missing sales.quote.accepted event");
  // Wave 1-2 tables without verified columns remain excluded.
  // Regex literals used (not new RegExp) to avoid template-literal escape ambiguity.
  // The negative lookahead (?![a-z_]) guards against substring matches like "quote_response".
  assert.doesNotMatch(viewBody, /FROM public\.opportunity(?![a-z_])/, "opportunity must remain excluded");
  assert.doesNotMatch(viewBody, /FROM public\.quote(?![a-z_])/, "quote table must remain excluded");
  assert.doesNotMatch(viewBody, /FROM public\.conversion_record(?![a-z_])/, "conversion_record must remain excluded");
});

test("Wave 1-2 table exclusion is documented with reason in migration comments", () => {
  // The old blanket exclusion comment is replaced with a verified-columns note.
  assert.doesNotMatch(
    sql,
    /Wave 1.2 sales tables are excluded because their columns cannot be verified from source/,
    "stale unverifiable comment must be removed"
  );
  // Updated comment confirms verification
  assert.match(sql, /independently verified/i, "migration must document independent verification");
});

test("sales KPI seeds declare verified live lineage and canonical-event truthfulness", () => {
  const salesSeeds = sql.match(/\('sales\.[a-z_]+',[\s\S]*?'1', true\)/g) ?? [];
  assert.equal(salesSeeds.length, 6, "expected 6 seeded sales KPIs");
  for (const seed of salesSeeds) {
    assert.ok(seed.includes('"wave":"1-2"'), `sales seed missing wave tag: ${seed.slice(0, 60)}`);
    assert.ok(seed.includes('"schema_verification":"independently_verified_live"'));
  }
  assert.match(sql, /sales\.leads_created[\s\S]*"in_canonical_event_view":true/);
  assert.match(sql, /sales\.quotes_accepted[\s\S]*"in_canonical_event_view":true/);
  assert.match(sql, /sales\.quotes_accepted[\s\S]*"responded_at"/);
  assert.match(sql, /sales\.conversions[\s\S]*"converted_at"/);
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
  assert.ok(markerIndex > 0 && commitIndex > 0 && markerIndex < commitIndex);
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
  "trg_wave6_mr_governance",
  "trg_enforce_ccr_fsm",
  "trg_enforce_continuity_fsm",
  "trg_enforce_release_gate_sequence",
  "trg_set_continuity_payload_hash",
  "trg_immute_continuity_transaction_fields",
];

const GOVERNANCE_TRIGGERS = [
  "trig_wave6_mr_governance",
  "trig_ccr_fsm",
  "trig_continuity_fsm",
  "trig_release_gate_sequence",
  "trig_continuity_payload_hash",
  "trig_immute_continuity_transaction_fields",
];

test("all 6 governance trigger functions are declared in the migration", () => {
  for (const fn of GOVERNANCE_TRIGGER_FUNCTIONS) {
    assert.match(
      sql,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`),
      `missing trigger function: ${fn}`
    );
  }
});

test("all 6 governance triggers are created in the migration", () => {
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
  assert.match(sql, /BEFORE UPDATE ON public\.management_review\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_wave6_mr_governance/);
});

test("migration header truthfully documents expanded trigger coverage", () => {
  assert.match(sql, /Trigger functions created \(18\):/);
  assert.match(sql, /Triggers created \(19\):/);
  assert.match(sql, /trig_wave6_mr_insert_guard/);
  assert.match(sql, /trig_wave6_ccr_insert_guard/);
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

test("continuity_transaction has a payload_hash column — NOT NULL", () => {
  // Criterion B: payload_hash must be NOT NULL (fail closed — hash is mandatory)
  assert.match(sql, /payload_hash\s+text\s+NOT NULL/);
  assert.doesNotMatch(sql, /payload_hash\s+text\s+NULL(?!\s+DEFAULT)(?!\s+NOT)/, "must not be nullable");
});

test("continuity_transaction has payload_hash format constraint", () => {
  assert.match(sql, /ck_ct_payload_hash_format/);
  assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
});

test("payload_hash trigger uses extensions.digest (schema-qualified pgcrypto)", () => {
  // Criterion A: extensions.digest is correctly schema-qualified
  const trigBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_set_continuity_payload_hash"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_set_continuity_payload_hash")
  );
  assert.match(trigBody, /extensions\.digest\(/, "must use schema-qualified extensions.digest");
  assert.match(trigBody, /sha256/);
  assert.match(trigBody, /encode\(/);
  assert.match(trigBody, /payload_hash/);
  // Fail closed: no EXCEPTION/NULL fallback
  assert.doesNotMatch(trigBody, /undefined_function/, "must not catch undefined_function — fail closed");
  assert.doesNotMatch(trigBody, /leave payload_hash NULL/, "must not permit NULL fallback");
});

test("payload_hash is NOT NULL on continuity_transaction — fail closed contract", () => {
  // Criterion B: payload_hash cannot be NULL from a successful insert contract
  assert.match(sql, /payload_hash\s+text\s+NOT NULL/, "payload_hash must be NOT NULL");
  assert.doesNotMatch(
    sql,
    /payload_hash\s+text\s+NULL(?!\s+DEFAULT)(?!\s+NOT)/,
    "payload_hash must not be declared nullable"
  );
  assert.doesNotMatch(
    sql,
    /payload_hash IS NULL OR/,
    "CHECK constraint must not permit NULL hash"
  );
});

test("immutability trigger prevents post-insertion mutation of payload evidence", () => {
  // Criterion C: payload hash/payload cannot be silently changed later
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.trg_immute_continuity_transaction_fields\(\)/,
    "immutability trigger function must exist"
  );
  assert.match(sql, /CREATE TRIGGER trig_immute_continuity_transaction_fields/);
  const immBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_immute_continuity_transaction_fields"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_immute_continuity_transaction_fields")
  );
  assert.match(immBody, /payload_hash IS DISTINCT FROM OLD\.payload_hash/);
  assert.match(immBody, /transaction_data IS DISTINCT FROM OLD\.transaction_data/);
  assert.match(immBody, /offline_correlation_id IS DISTINCT FROM OLD\.offline_correlation_id/);
  assert.match(immBody, /BEFORE UPDATE ON public\.continuity_transaction|BEFORE UPDATE/);
});

test("payload_hash is documented as immutable (INSERT-only trigger)", () => {
  assert.match(sql, /INSERT-only trigger.*hash is immutable|hash is immutable.*INSERT-only/i);
  // Also confirm a BEFORE UPDATE trigger enforces this at the DB level
  assert.match(
    sql,
    /BEFORE UPDATE ON public\.continuity_transaction\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.trg_immute_continuity_transaction_fields/
  );
});

test("payload hash function comment describes identity envelope plus transaction payload", () => {
  assert.match(
    sql,
    /Hash covers continuity_session_id, offline_correlation_id, organization_id, business_unit_id, transaction_type, serviceos_entity_type, serviceos_entity_id, and transaction_data\./
  );
  assert.doesNotMatch(sql, /Hash = encode\(extensions\.digest\(transaction_data::text/);
});

test("kpi_snapshot rejects non-null numeric evidence with empty lineage", () => {
  assert.match(sql, /ck_ks_numeric_lineage_nonempty/);
  assert.match(sql, /numeric_value IS NULL OR source_lineage <> '\{\}'::jsonb/);
});

test("kpi_snapshot enforces kpi_definition id/code/version consistency", () => {
  assert.match(sql, /uq_kd_id_code_version UNIQUE \(id, code, definition_version\)/);
  assert.match(sql, /FOREIGN KEY \(kpi_definition_id, kpi_code, definition_version\)/);
  assert.match(sql, /REFERENCES public\.kpi_definition\(id, code, definition_version\)/);
});

test("canonical event view uses semantic business-event timestamps without created_at fallbacks", () => {
  assert.match(sql, /ops\.work\.completed[\s\S]*wo\.service_completed_at/);
  assert.match(sql, /quality\.qa\.passed[\s\S]*qi\.inspected_at/);
  assert.match(sql, /finance\.payable\.approved[\s\S]*cp\.approved_at/);
  assert.doesNotMatch(sql, /COALESCE\(wo\.service_completed_at, wo\.updated_at\)/);
  assert.doesNotMatch(sql, /COALESCE\(qi\.inspected_at, qi\.updated_at\)/);
  assert.doesNotMatch(sql, /COALESCE\(cp\.approved_at, cp\.created_at\)/);
});

test("canonical event view comment no longer claims unverified opportunity/quote/conversion schemas", () => {
  assert.doesNotMatch(sql, /excluded pending column verification/i);
  assert.match(sql, /no locked canonical event name currently requires them/i);
});

test("migration includes DB-level material dependency-impact validator trigger", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.trg_validate_ccr_dependency_impact\(\)/);
  assert.match(
    sql,
    /CREATE TRIGGER trig_ccr_dependency_impact_validate\s+BEFORE UPDATE ON public\.change_control_record/
  );
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

test("Wave 1/2 exclusion is documented selectively — verified tables are included", () => {
  // After independent verification (2026-08-17), service_request and quote_response
  // are INCLUDED in the canonical view. The stale blanket-exclusion comment is gone.
  // Remaining unverified Wave 1-2 tables (opportunity, quote, conversion_record) stay out.
  const viewBody = sql.slice(
    sql.indexOf("CREATE VIEW public.wave6_canonical_event"),
    sql.indexOf("ALTER VIEW public.wave6_canonical_event SET")
  );
  // Confirmed included
  assert.ok(viewBody.includes("'sales.lead.created'"), "sales.lead.created must be in view");
  assert.ok(viewBody.includes("'sales.quote.accepted'"), "sales.quote.accepted must be in view");
  // Unverified Wave 1-2 tables still excluded
  assert.doesNotMatch(viewBody, /'sales\.lead\.created'.*opportunity|FROM public\.opportunity/);
  assert.doesNotMatch(viewBody, /FROM public\.quote(?![a-z_])/, "quote table not verified — must remain excluded");
  assert.ok(!viewBody.includes("FROM public.conversion_record"), "conversion_record must remain excluded");
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

// ── Correction area 5: Continuity closure with unresolved transactions (M) ───

test("continuity_session FSM trigger rejects closure with unresolved transactions", () => {
  // Criterion M: continuity session cannot close with unresolved transactions
  const fsmBody = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_continuity_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_continuity_fsm")
  );
  assert.match(
    fsmBody,
    /unresolved transaction|pending reconciliation/i,
    "continuity FSM must check for unresolved transactions on closure"
  );
  assert.match(
    fsmBody,
    /continuity_transaction/,
    "FSM must query continuity_transaction to verify all transactions are resolved"
  );
  assert.match(
    fsmBody,
    /reconciliation_status NOT IN/,
    "FSM must check terminal reconciliation_status values"
  );
  assert.match(
    fsmBody,
    /waiver_recorded/,
    "FSM must allow waiver to bypass the unresolved-transaction check"
  );
});

test("self-validation confirms pgcrypto extensions.digest is available", () => {
  // Criterion A self-validation at DB level
  assert.match(
    sql,
    /extensions\.digest\('probe'/,
    "SV must probe extensions.digest for availability"
  );
  assert.match(
    sql,
    /pgcrypto must be installed/i,
    "SV must name the missing extension in the error"
  );
});

// ── Correction area 6: Terminal governance evidence protection (N) ────────────

test("management_review FSM blocks any update to a closed row", () => {
  // Criterion N: terminal governance evidence cannot be silently rewritten
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_mr_governance"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_wave6_mr_governance")
  );
  assert.match(
    body,
    /OLD\.review_status = 'closed'/,
    "management_review FSM must block updates when already closed"
  );
  assert.match(body, /terminal row is immutable/i);
});

test("change_control_record FSM blocks any update to a closed row", () => {
  // Criterion N
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_ccr_fsm")
  );
  assert.match(
    body,
    /OLD\.change_status = 'closed'/,
    "CCR FSM must block updates when already closed"
  );
  assert.match(body, /terminal row is immutable/i);
});

test("release_gate FSM blocks any update to a passed gate", () => {
  // Criterion N
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_release_gate_sequence"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_release_gate_sequence")
  );
  // The terminal immutability block must appear before the more specific reversal check
  const terminalIdx = body.indexOf("terminal evidence is immutable");
  const reversalIdx = body.indexOf("cannot be reverted");
  assert.ok(terminalIdx >= 0, "release_gate FSM must protect terminal evidence");
  assert.ok(terminalIdx < reversalIdx, "immutability block must appear before reversal check");
});

test("continuity_session FSM blocks any update to a closed session", () => {
  // Criterion N
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_continuity_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_continuity_fsm")
  );
  assert.match(
    body,
    /OLD\.session_status = 'closed'/,
    "continuity FSM must block updates when already closed"
  );
  assert.match(body, /terminal row is immutable/i);
});
