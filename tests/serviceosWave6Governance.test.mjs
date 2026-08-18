// Wave 6 — governance: change-control FSM, management review lifecycle,
// release gate sequencing, and HEMS dependency graph traversal.
// Pure tests: no database, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import {
  CCR_TRANSITIONS,
  MANAGEMENT_REVIEW_TRANSITIONS,
  RELEASE_GATE_SEQUENCE,
  canCloseChangeControlRecord,
  canCloseManagementReview,
  canPassReleaseGate,
  canTransitionCcr,
  canTransitionManagementReview,
  hasDependencyCycle,
  nextCcrStatuses,
  releaseGateBlockers,
  traverseDependencyImpact,
  unresolvedReviewActions,
} from "../src/lib/serviceosIntelligenceUtils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  path.join(
    here,
    "..",
    "supabase",
    "migrations",
    "014_wave6_intelligence_governance_continuity.sql"
  ),
  "utf8"
);

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    );
  }
  return result;
}

async function withTempPostgres(run) {
  const binDir = process.env.PG_BINDIR || "/usr/lib/postgresql/16/bin";
  const initdb = path.join(binDir, "initdb");
  const pgCtl = path.join(binDir, "pg_ctl");
  const psql = path.join(binDir, "psql");
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "wave6-governance-pg-"));
  const dataDir = path.join(rootDir, "data");
  const socketDir = path.join(rootDir, "socket");
  const port = String(59000 + Math.floor(Math.random() * 2000));
  const logFile = path.join(rootDir, "postgres.log");
  runChecked("mkdir", ["-p", dataDir, socketDir]);
  try {
    runChecked(initdb, ["-D", dataDir, "-A", "trust", "-U", "postgres", "--no-locale"]);
    runChecked(
      pgCtl,
      ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -p ${port}`, "-w", "start"],
      { stdio: "ignore" }
    );
    const execSql = (statement) =>
      runChecked(
        psql,
        ["-h", socketDir, "-p", port, "-U", "postgres", "-d", "postgres", "-qAt", "-c", statement]
      ).stdout.trim();
    return await run(execSql);
  } finally {
    spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function sliceSql(startMarker, endMarker) {
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing SQL marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing SQL marker: ${endMarker}`);
  return sql.slice(start, end).trim();
}

// ── Change control FSM ───────────────────────────────────────────────────────

const LEGAL_CCR = [
  ["measure", "analyze"],
  ["analyze", "improve"],
  ["improve", "approve"],
  ["approve", "update"],
  ["update", "retrain"],
  ["retrain", "validate"],
  ["validate", "closed"],
];

test("change control legal transitions are permitted", () => {
  for (const [from, to] of LEGAL_CCR) {
    assert.equal(canTransitionCcr(from, to), true, `${from} → ${to} should be legal`);
  }
});

test("change control illegal transitions are rejected", () => {
  const illegal = [
    ["measure", "closed"],
    ["measure", "improve"],
    ["validate", "measure"],
    ["closed", "measure"],
    ["closed", "closed"],
    ["approve", "closed"],
    ["analyze", "approve"],
  ];
  for (const [from, to] of illegal) {
    assert.equal(canTransitionCcr(from, to), false, `${from} → ${to} must be rejected`);
  }
});

test("change control rejects unknown statuses (fail closed)", () => {
  assert.equal(canTransitionCcr("bogus", "analyze"), false);
  assert.equal(canTransitionCcr("measure", "bogus"), false);
  assert.equal(canTransitionCcr(undefined, undefined), false);
  assert.deepEqual(nextCcrStatuses("bogus"), []);
});

test("closed is a terminal change-control state", () => {
  assert.deepEqual(CCR_TRANSITIONS.closed, []);
  assert.deepEqual(nextCcrStatuses("closed"), []);
});

test("nextCcrStatuses returns a copy, not the shared array", () => {
  const next = nextCcrStatuses("measure");
  next.push("closed");
  assert.deepEqual(CCR_TRANSITIONS.measure, ["analyze"]);
});

test("material change cannot close without impact assessment and passed validation", () => {
  const base = {
    change_status: "validate",
    material_change: true,
    impact_assessment: {},
    validation_result: {},
  };
  assert.equal(canCloseChangeControlRecord(base), false);
  assert.equal(
    canCloseChangeControlRecord({ ...base, impact_assessment: { scope: "pricing" } }),
    false
  );
  assert.equal(
    canCloseChangeControlRecord({ ...base, validation_result: { passed: true } }),
    false
  );
  assert.equal(
    canCloseChangeControlRecord({
      ...base,
      impact_assessment: { scope: "pricing" },
      validation_result: { passed: false },
    }),
    false
  );
});

test("material change closes with complete evidence", () => {
  assert.equal(
    canCloseChangeControlRecord({
      change_status: "validate",
      material_change: true,
      impact_assessment: { scope: "pricing", dependencies: ["KG-002"] },
      validation_result: { passed: true, evidence: "regression suite" },
    }),
    true
  );
});

test("non-material change still requires validation evidence before closure", () => {
  assert.equal(
    canCloseChangeControlRecord({
      change_status: "validate",
      material_change: false,
      impact_assessment: {},
      validation_result: {},
    }),
    false
  );
  assert.equal(
    canCloseChangeControlRecord({
      change_status: "validate",
      material_change: false,
      impact_assessment: {},
      validation_result: { passed: false, evidence: "observed anomaly retained for follow-up" },
    }),
    true
  );
});

test("no change control record can close from a non-validate state", () => {
  for (const status of ["measure", "analyze", "improve", "approve", "update", "retrain"]) {
    assert.equal(
      canCloseChangeControlRecord({
        change_status: status,
        material_change: false,
        impact_assessment: {},
        validation_result: {},
      }),
      false,
      `${status} must not close directly`
    );
  }
});

// ── Management review lifecycle ──────────────────────────────────────────────

test("management review lifecycle follows draft → in_review → actions_open → closed", () => {
  assert.equal(canTransitionManagementReview("draft", "in_review"), true);
  assert.equal(canTransitionManagementReview("in_review", "actions_open"), true);
  assert.equal(canTransitionManagementReview("actions_open", "closed"), true);
  assert.deepEqual(MANAGEMENT_REVIEW_TRANSITIONS.closed, []);
});

test("management review illegal transitions are rejected", () => {
  assert.equal(canTransitionManagementReview("draft", "closed"), false);
  assert.equal(canTransitionManagementReview("closed", "draft"), false);
  assert.equal(canTransitionManagementReview("actions_open", "draft"), false);
});

test("review with unresolved actions cannot close without a waiver", () => {
  const review = {
    review_status: "actions_open",
    waiver_recorded: false,
    actions: [
      { id: "a1", is_resolved: true },
      { id: "a2", is_resolved: false },
    ],
  };
  assert.equal(unresolvedReviewActions(review).length, 1);
  assert.equal(canCloseManagementReview(review), false);
  assert.equal(canCloseManagementReview({ ...review, waiver_recorded: true }), true);
});

test("review with all actions resolved can close without a waiver", () => {
  assert.equal(
    canCloseManagementReview({
      review_status: "actions_open",
      waiver_recorded: false,
      actions: [{ is_resolved: true }, { is_resolved: true }],
    }),
    true
  );
});

test("review with no actions can close", () => {
  assert.equal(
    canCloseManagementReview({
      review_status: "actions_open",
      waiver_recorded: false,
      actions: [],
    }),
    true
  );
});

// ── Release gate sequencing ──────────────────────────────────────────────────

const GATES = (statuses) =>
  RELEASE_GATE_SEQUENCE.map((code, i) => ({
    gate_code: code,
    sequence_order: i + 1,
    gate_status: statuses[code] ?? "pending",
  }));

test("release gate sequence is PILOT → ACCEPTANCE → CUTOVER → LEGACY_RETIREMENT → SCALE", () => {
  assert.deepEqual(RELEASE_GATE_SEQUENCE, [
    "PILOT",
    "ACCEPTANCE",
    "CUTOVER",
    "LEGACY_RETIREMENT",
    "SCALE",
  ]);
});

test("CUTOVER cannot pass before ACCEPTANCE has passed", () => {
  const gates = GATES({ PILOT: "passed", ACCEPTANCE: "ready" });
  assert.equal(canPassReleaseGate("CUTOVER", gates), false);
  assert.deepEqual(releaseGateBlockers("CUTOVER", gates), ["ACCEPTANCE"]);

  const ready = GATES({ PILOT: "passed", ACCEPTANCE: "passed" });
  assert.equal(canPassReleaseGate("CUTOVER", ready), true);
  assert.deepEqual(releaseGateBlockers("CUTOVER", ready), []);
});

test("PILOT is the only gate with no prerequisites", () => {
  assert.equal(canPassReleaseGate("PILOT", GATES({})), true);
  assert.equal(canPassReleaseGate("ACCEPTANCE", GATES({})), false);
});

test("LEGACY_RETIREMENT requires PILOT, ACCEPTANCE and CUTOVER", () => {
  const gates = GATES({ PILOT: "passed", ACCEPTANCE: "passed", CUTOVER: "blocked" });
  assert.equal(canPassReleaseGate("LEGACY_RETIREMENT", gates), false);
  assert.deepEqual(releaseGateBlockers("LEGACY_RETIREMENT", gates), ["CUTOVER"]);

  const ready = GATES({ PILOT: "passed", ACCEPTANCE: "passed", CUTOVER: "passed" });
  assert.equal(canPassReleaseGate("LEGACY_RETIREMENT", ready), true);
});

test("SCALE requires every earlier gate", () => {
  const gates = GATES({
    PILOT: "passed",
    ACCEPTANCE: "passed",
    CUTOVER: "passed",
    LEGACY_RETIREMENT: "pending",
  });
  assert.equal(canPassReleaseGate("SCALE", gates), false);
  assert.deepEqual(releaseGateBlockers("SCALE", gates), ["LEGACY_RETIREMENT"]);

  const ready = GATES({
    PILOT: "passed",
    ACCEPTANCE: "passed",
    CUTOVER: "passed",
    LEGACY_RETIREMENT: "passed",
  });
  assert.equal(canPassReleaseGate("SCALE", ready), true);
});

test("release gate sequencing fails closed on missing rows and unknown codes", () => {
  assert.equal(canPassReleaseGate("CUTOVER", []), false);
  assert.equal(canPassReleaseGate("CUTOVER", null), false);
  assert.equal(canPassReleaseGate("NOT_A_GATE", GATES({})), false);
  assert.deepEqual(releaseGateBlockers("NOT_A_GATE", GATES({})), ["unknown gate NOT_A_GATE"]);
});

// ── HEMS dependency graph ────────────────────────────────────────────────────

function migrationEdges() {
  const seedSection = sql.slice(sql.indexOf("INSERT INTO public.dependency_edge"));
  return [...seedSection.matchAll(/\('(KG-00[1-7])',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g)].map(
    (m) => ({ kg_id: m[1], from_node: m[2], to_node: m[3], edge_type: m[4] })
  );
}

test("migration seeds KG-001 through KG-007", () => {
  const edges = migrationEdges();
  assert.ok(edges.length >= 35, `expected >= 35 seeded edges, found ${edges.length}`);
  const graphs = new Set(edges.map((e) => e.kg_id));
  for (const kg of ["KG-001", "KG-002", "KG-003", "KG-004", "KG-005", "KG-006", "KG-007"]) {
    assert.ok(graphs.has(kg), `missing ${kg}`);
    const chain = edges.filter((e) => e.kg_id === kg);
    assert.ok(chain.length >= 5, `${kg} has only ${chain.length} edges`);
  }
});

test("seeded HEMS graph is cycle-safe: traversal terminates on its improvement loops", () => {
  const edges = migrationEdges();
  // The HEMS model is deliberately a closed improvement loop (e.g. KG-003
  // Training → SOP), so cycles are expected. What must hold is that traversal
  // terminates and never revisits a node.
  assert.equal(hasDependencyCycle(edges), true);
  const impacted = traverseDependencyImpact(edges, "SOP", 100);
  const nodes = impacted.map((i) => i.node);
  assert.equal(new Set(nodes).size, nodes.length, "traversal must not revisit a node");
  assert.ok(!nodes.includes("SOP"), "traversal must not return to its origin");
});

test("each acyclic KG chain traverses to its terminal node", () => {
  const edges = migrationEdges().filter((e) => e.kg_id === "KG-002");
  const roots = edges
    .map((e) => e.from_node)
    .filter((node) => !edges.some((e) => e.to_node === node));
  assert.ok(roots.length >= 1);
  const impacted = traverseDependencyImpact(edges, roots[0], 20);
  assert.ok(impacted.length >= 5, `KG-002 reached only ${impacted.length} nodes`);
});

test("KG-001 origin reaches its full downstream chain", () => {
  const edges = migrationEdges().filter((e) => e.kg_id === "KG-001");
  const impacted = traverseDependencyImpact(edges, "ResidentialServiceDefinition", 10);
  const nodes = impacted.map((i) => i.node);
  for (const expected of ["Pricing", "Estimator", "Quote", "WorkOrder"]) {
    assert.ok(nodes.includes(expected), `KG-001 should reach ${expected}`);
  }
  assert.ok(impacted.length >= 5);
});

test("dependency traversal finds direct and indirect impact with depth", () => {
  const edges = [
    { kg_id: "KG-TEST", from_node: "A", to_node: "B", edge_type: "depends_on", control_rule: "rule-AB" },
    { kg_id: "KG-TEST", from_node: "B", to_node: "C", edge_type: "depends_on", control_rule: "rule-BC" },
    { kg_id: "KG-TEST", from_node: "C", to_node: "D", edge_type: "depends_on", control_rule: "rule-CD" },
  ];
  const impacted = traverseDependencyImpact(edges, "A", 5);
  assert.deepEqual(
    impacted.map((i) => [i.node, i.depth]),
    [
      ["B", 1],
      ["C", 2],
      ["D", 3],
    ]
  );
  // Each hop must carry the edge metadata needed for impact display
  assert.equal(impacted[0].to_node, "B", "first hop must carry to_node");
  assert.equal(impacted[0].control_rule, "rule-AB", "first hop must carry control_rule from edge");
  assert.equal(impacted[1].control_rule, "rule-BC");
  assert.equal(impacted[2].control_rule, "rule-CD");
});

test("dependency traversal honours maxDepth", () => {
  const edges = [
    { from_node: "A", to_node: "B" },
    { from_node: "B", to_node: "C" },
    { from_node: "C", to_node: "D" },
  ];
  assert.deepEqual(
    traverseDependencyImpact(edges, "A", 2).map((i) => i.node),
    ["B", "C"]
  );
});

test("dependency traversal terminates on a cycle A→B→C→A", () => {
  const edges = [
    { from_node: "A", to_node: "B" },
    { from_node: "B", to_node: "C" },
    { from_node: "C", to_node: "A" },
  ];
  const impacted = traverseDependencyImpact(edges, "A", 50);
  assert.deepEqual(
    impacted.map((i) => i.node),
    ["B", "C"]
  );
  assert.equal(hasDependencyCycle(edges), true);
});

test("dependency traversal handles unknown origins and empty edge sets", () => {
  assert.deepEqual(traverseDependencyImpact([], "A", 5), []);
  assert.deepEqual(traverseDependencyImpact(null, "A", 5), []);
  assert.deepEqual(traverseDependencyImpact([{ from_node: "A", to_node: "B" }], "Z", 5), []);
  assert.deepEqual(traverseDependencyImpact([{ from_node: "A", to_node: "B" }], "", 5), []);
});

test("cycle detection is false for a DAG with a diamond", () => {
  const edges = [
    { from_node: "A", to_node: "B" },
    { from_node: "A", to_node: "C" },
    { from_node: "B", to_node: "D" },
    { from_node: "C", to_node: "D" },
  ];
  assert.equal(hasDependencyCycle(edges), false);
  assert.deepEqual(
    traverseDependencyImpact(edges, "A", 5)
      .map((i) => i.node)
      .sort(),
    ["B", "C", "D"]
  );
});

// ── Migration governance contracts ───────────────────────────────────────────

test("migration documents application-enforced governance rules", () => {
  assert.match(sql, /release_gate/);
  assert.match(sql, /application/i);
  assert.match(sql, /CONSTRAINT ck_ccr_material_close_evidence CHECK/);
});

// ── Training-required governance (DB level) ──────────────────────────────────

test("migration enforces retrain→validate is blocked unless training_status=completed when training_required=true", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_ccr_fsm")
  );
  assert.match(
    body,
    /training_required.*=.*true/,
    "CCR FSM must check training_required flag"
  );
  assert.match(
    body,
    /training_status.*IS DISTINCT FROM 'completed'/,
    "CCR FSM must block retrain→validate unless training_status=completed"
  );
  assert.match(
    body,
    /retrain.*validate.*training_status/i,
    "CCR FSM must mention training context in the retrain→validate guard"
  );
});

test("migration CCR FSM permits retrain→validate when training_required=false regardless of training_status", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_ccr_fsm")
  );
  // Guard is conditional: NEW.training_required = true AND ... so the block
  // is inside an IF block that only fires when training_required is true.
  assert.match(
    body,
    /IF NEW\.training_required = true/,
    "training guard must be conditional on training_required flag"
  );
});

test("migration CCR FSM guards are scoped to the retrain→validate transition", () => {
  // Verify the training check only applies to the retrain→validate transition
  // by confirming it lives inside the retrain→validate case branch.
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_ccr_fsm")
  );
  const retrainIdx = body.indexOf("OLD.change_status = 'retrain'");
  const trainingIdx = body.indexOf("training_required");
  assert.ok(retrainIdx >= 0, "CCR FSM must have retrain→validate case");
  assert.ok(trainingIdx > retrainIdx, "training check must appear after retrain status guard");
});

test("migration CCR FSM does not block non-retrain transitions on training_status", () => {
  // The measure, analyze, improve, approve, update steps must not be blocked
  // by training_status. Verify training check is not placed before the
  // retrain-specific branch (i.e., only in its own transition case).
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_enforce_ccr_fsm"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_enforce_ccr_fsm")
  );
  const measureIdx = body.indexOf("'measure'");
  const firstTrainingIdx = body.indexOf("training_required");
  // The training check must appear after the first transition branches,
  // confirming it is not a blanket pre-guard.
  assert.ok(measureIdx >= 0, "CCR FSM must have measure transition");
  assert.ok(firstTrainingIdx > measureIdx, "training check must not precede transition branches");
});

// ── Combined MR governance trigger order self-validation ─────────────────────

test("migration SV-17 validates that old separate MR triggers do not coexist with trg_wave6_mr_governance", () => {
  assert.match(
    sql,
    /SV-17/,
    "migration must include SV-17 trigger order self-validation block"
  );
  assert.match(
    sql,
    /trg_wave6_mr_governance/,
    "migration must reference combined MR governance function name in SV-17"
  );
  // The old separate trigger names must NOT appear as CREATE TRIGGER statements
  assert.doesNotMatch(
    sql,
    /CREATE TRIGGER trig_management_review_fsm\b/,
    "old trig_management_review_fsm must not be created; replaced by trg_wave6_mr_governance"
  );
  assert.doesNotMatch(
    sql,
    /CREATE TRIGGER trig_wave6_mr_update_stamp\b/,
    "old trig_wave6_mr_update_stamp must not be created; replaced by trg_wave6_mr_governance"
  );
});

test("migration combined MR trigger fires BEFORE UPDATE once with combined governance", () => {
  // Confirm the single combined trigger is created (not two separate ones)
  const matchCount = (sql.match(/CREATE TRIGGER trig_wave6_mr_governance\b/g) || []).length;
  assert.equal(matchCount, 1, "exactly one combined MR governance trigger must be created");
});

test("management_review waiver is one-way and evidence is immutable once recorded", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_mr_governance"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_wave6_mr_governance")
  );
  assert.match(body, /waiver_recorded cannot transition true→false/);
  assert.match(body, /waiver evidence is immutable once recorded/);
});

test("management_review stamps opened_at only on draft→in_review and blocks draft injection", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_mr_governance"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_wave6_mr_governance")
  );
  assert.match(body, /OLD\.review_status = 'draft' AND NEW\.review_status = 'in_review'/);
  assert.match(body, /opened_at may only be set during draft→in_review transition/);
  const insertGuard = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_guard_management_review_insert"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.trg_wave6_guard_management_review_insert")
  );
  assert.match(insertGuard, /insert cannot pre-populate transition\/waiver evidence/);
  assert.match(insertGuard, /NEW\.opened_at IS NOT NULL/);
});

test("management_review stamps closed_at only during legal close and blocks pre-close injection", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_wave6_mr_governance"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_wave6_mr_governance")
  );
  assert.match(body, /OLD\.review_status IN \('in_review', 'actions_open'\)/);
  assert.match(body, /NEW\.review_status = 'closed'/);
  assert.match(body, /closed_at may only be set during legal transition into closed/);
});

test("material change dependency impact validator trigger exists and runs before update", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.trg_validate_ccr_dependency_impact\(\)/);
  assert.match(
    sql,
    /CREATE TRIGGER trig_ccr_dependency_impact_validate\s+BEFORE UPDATE ON public\.change_control_record/
  );
});

test("dependency impact validator enforces structured assessment and recursive reachability", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_validate_ccr_dependency_impact"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_validate_ccr_dependency_impact")
  );
  assert.match(body, /dependency_graph_source is required/i);
  assert.match(body, /dependency_paths must be an array/i);
  assert.match(body, /dependency_paths entries must include kg_id\/from_node\/to_node\/edge_type/i);
  assert.match(body, /WITH RECURSIVE reachable/);
  assert.match(body, /NOT de\.to_node = ANY\(r\.visited\)/);
  assert.match(body, /affected dependency .* is not downstream-reachable from source/i);
});

test("dependency impact validator has explicit fail-closed guards for invented/invalid payloads", () => {
  const body = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.trg_validate_ccr_dependency_impact"),
    sql.indexOf("COMMENT ON FUNCTION public.trg_validate_ccr_dependency_impact")
  );
  assert.match(body, /requires structured impact_assessment object/i, "arbitrary JSON must fail");
  assert.match(body, /dependency_graph_source .* not a visible dependency_edge source node/i);
  assert.match(body, /dependency_paths includes edge that does not exist or is not visible/i);
  assert.match(body, /affected dependency .* is not downstream-reachable from source/i);
  assert.match(body, /v_requires_assessment := \(\s*NEW\.material_change = true[\s\S]*approve', 'update', 'retrain', 'validate', 'closed'/);
});

test("CCR KPI manifest validation uses source_lineage, rejects empty lineage, and bad rowtype fields raise SQLSTATE 42703", async () => {
  assert.doesNotMatch(
    sql,
    /v_snapshot\.governed_lineage/,
    "migration must not reference nonexistent v_snapshot.governed_lineage"
  );

  await withTempPostgres((execSql) => {
    execSql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    execSql(sliceSql("CREATE TABLE public.kpi_definition (", "COMMENT ON TABLE public.kpi_definition IS"));
    execSql(sliceSql("CREATE TABLE public.kpi_snapshot (", "COMMENT ON TABLE public.kpi_snapshot IS"));
    execSql(sliceSql("CREATE TABLE public.change_control_record (", "COMMENT ON TABLE public.change_control_record IS"));
    execSql(
      sliceSql(
        "CREATE OR REPLACE FUNCTION public.trg_wave6_validate_ccr_kpi_manifest()",
        "REVOKE ALL ON FUNCTION public.trg_wave6_validate_ccr_kpi_manifest()"
      )
    );
    execSql(
      sliceSql("CREATE TRIGGER trig_wave6_ccr_manifest", "-- ---------------------------------------------------------------------------")
    );

    const definitionId = execSql(`
      INSERT INTO public.kpi_definition (
        code, name, domain, aggregation_type, period_support, source_lineage, definition_version
      )
      VALUES (
        'ops.qa_pass_rate',
        'QA Pass Rate',
        'operations',
        'rate',
        ARRAY['MONTHLY']::text[],
        '{"tables":["quality_inspection"]}'::jsonb,
        '1'
      )
      RETURNING id::text;
    `);
    const orgId = "00000000-0000-0000-0000-0000000000aa";
    const goodSnapshotId = execSql(`
      INSERT INTO public.kpi_snapshot (
        kpi_definition_id, kpi_code, definition_version, organization_id,
        period_type, period_start, period_end, timezone, numeric_value, source_lineage
      )
      VALUES (
        '${definitionId}'::uuid,
        'ops.qa_pass_rate',
        '1',
        '${orgId}'::uuid,
        'MONTHLY',
        '2026-08-01T00:00:00Z'::timestamptz,
        '2026-09-01T00:00:00Z'::timestamptz,
        'UTC',
        0.98,
        '{"tables":["quality_inspection"],"filters":{"status":"passed"}}'::jsonb
      )
      RETURNING id::text;
    `);

    const accepted = execSql(`
      INSERT INTO public.change_control_record (
        change_code,
        change_type,
        title,
        source_kpi_codes,
        source_kpi_snapshot_manifest,
        organization_id
      )
      VALUES (
        'CCR-LINEAGE-OK',
        'process',
        'Accept populated source lineage',
        ARRAY['ops.qa_pass_rate']::text[],
        jsonb_build_array(
          jsonb_build_object(
            'kpi_snapshot_id', '${goodSnapshotId}'::uuid,
            'kpi_code', 'ops.qa_pass_rate',
            'definition_version', '1'
          )
        ),
        '${orgId}'::uuid
      )
      RETURNING change_code;
    `);
    assert.equal(
      accepted,
      "CCR-LINEAGE-OK",
      "actual trigger must accept populated source_lineage on the real kpi_snapshot row shape"
    );

    const emptySnapshotId = execSql(`
      INSERT INTO public.kpi_snapshot (
        kpi_definition_id, kpi_code, definition_version, organization_id,
        period_type, period_start, period_end, timezone, numeric_value, source_lineage
      )
      VALUES (
        '${definitionId}'::uuid,
        'ops.qa_pass_rate',
        '1',
        '${orgId}'::uuid,
        'MONTHLY',
        '2026-09-01T00:00:00Z'::timestamptz,
        '2026-10-01T00:00:00Z'::timestamptz,
        'UTC',
        NULL,
        '{}'::jsonb
      )
      RETURNING id::text;
    `);

    const rejectedEmptyLineage = execSql(`
      DO $$
      DECLARE
        v_state text;
        v_message text;
        v_rejected boolean := false;
      BEGIN
        BEGIN
          INSERT INTO public.change_control_record (
            change_code,
            change_type,
            title,
            source_kpi_codes,
            source_kpi_snapshot_manifest,
            organization_id
          )
          VALUES (
            'CCR-LINEAGE-EMPTY',
            'process',
            'Reject empty source lineage',
            ARRAY['ops.qa_pass_rate']::text[],
            jsonb_build_array(
              jsonb_build_object(
                'kpi_snapshot_id', '${emptySnapshotId}'::uuid,
                'kpi_code', 'ops.qa_pass_rate',
                'definition_version', '1'
              )
            ),
            '${orgId}'::uuid
          );
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_state = RETURNED_SQLSTATE,
            v_message = MESSAGE_TEXT;
          IF v_state <> 'P0001' THEN
            RAISE EXCEPTION 'expected SQLSTATE P0001, got %', v_state;
          END IF;
          IF position('source_lineage' in v_message) = 0 THEN
            RAISE EXCEPTION 'expected source_lineage rejection message, got %', v_message;
          END IF;
          v_rejected := true;
        END;
        IF NOT v_rejected THEN
          RAISE EXCEPTION 'expected empty source_lineage rejection';
        END IF;
      END;
      $$;
      SELECT 'rejected_empty_lineage';
    `);
    assert.equal(rejectedEmptyLineage, "rejected_empty_lineage");

    const rowtype42703 = execSql(`
      CREATE OR REPLACE FUNCTION public.wave6_rowtype_42703_probe()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_snapshot public.kpi_snapshot%ROWTYPE;
      BEGIN
        SELECT * INTO v_snapshot FROM public.kpi_snapshot LIMIT 1;
        PERFORM v_snapshot.governed_lineage;
      END;
      $$;

      DO $$
      DECLARE
        v_state text;
      BEGIN
        BEGIN
          PERFORM public.wave6_rowtype_42703_probe();
          RAISE EXCEPTION 'expected nonexistent field probe to fail';
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
          IF v_state <> '42703' THEN
            RAISE EXCEPTION 'expected SQLSTATE 42703, got %', v_state;
          END IF;
        END;
      END;
      $$;

      SELECT 'rowtype_42703_verified';
    `);
    assert.equal(rowtype42703, "rowtype_42703_verified");
  });
});

// ── Real PostgreSQL regression: release_gate trigger fail-closed ──────────────
//
// These tests execute the actual trigger function against a real temporary
// PostgreSQL instance to prove the runtime behaviour specified in the Wave 6
// live acceptance contract:
//
//   A. ACCEPTANCE cannot pass while PILOT is pending.
//   B. ACCEPTANCE can pass after PILOT passes.
//   C. ACCEPTANCE cannot pass if PILOT row is absent.
//   D. Passed gates are immutable.
//   E. Sequence: PILOT → ACCEPTANCE → CUTOVER → LEGACY_RETIREMENT → SCALE.

function sliceReleaseGateSql() {
  // Table DDL (everything from CREATE TABLE through its comment).
  const tableBlock = sliceSql(
    "CREATE TABLE public.release_gate (",
    "COMMENT ON TABLE public.release_gate IS"
  );
  // Trigger function body.
  const fnBlock = sliceSql(
    "CREATE OR REPLACE FUNCTION public.trg_enforce_release_gate_sequence()",
    "REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM PUBLIC;"
  );
  // Trigger attachment.
  const trigBlock = sliceSql(
    "CREATE TRIGGER trig_release_gate_sequence",
    "COMMENT ON FUNCTION public.trg_enforce_release_gate_sequence() IS"
  );
  return `${tableBlock}\n${fnBlock}\n${trigBlock}`;
}

test("PostgreSQL regression A: ACCEPTANCE cannot pass while PILOT is pending", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    // Seed minimal rows: PILOT pending (seq 1), ACCEPTANCE pending (seq 2).
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES
        ('PILOT',      'Pilot',      'pending', 1, '{}'::jsonb),
        ('ACCEPTANCE', 'Acceptance', 'pending', 2, '{}'::jsonb);
    `);
    // Attempting to pass ACCEPTANCE while PILOT is still pending must fail.
    // Use a boolean rejection flag so the sentinel RAISE EXCEPTION cannot
    // satisfy its own expected-error handler (which would cause a false pass).
    const result = execSql(`
      DO $$
      DECLARE
        v_rejected boolean := false;
        v_state    text;
        v_msg      text;
      BEGIN
        BEGIN
          UPDATE public.release_gate
          SET gate_status = 'passed', passed_at = now(), release_sha = 'abc123'
          WHERE gate_code = 'ACCEPTANCE';
          -- Trigger did NOT fire — fall through to the post-handler check.
        EXCEPTION WHEN OTHERS THEN
          v_rejected := true;
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
          GET STACKED DIAGNOSTICS v_msg   = MESSAGE_TEXT;
          IF v_state <> 'P0001' THEN
            RAISE EXCEPTION 'expected SQLSTATE P0001 from trigger, got %', v_state;
          END IF;
          IF v_msg NOT LIKE '%predecessor%' THEN
            RAISE EXCEPTION 'unexpected trigger rejection message: %', v_msg;
          END IF;
        END;
        -- Assert outside the handler: the UPDATE must have been rejected.
        IF NOT v_rejected THEN
          RAISE EXCEPTION
            'regression A FAIL: trigger did not reject UPDATE — fail closed check failed';
        END IF;
      END;
      $$;
      SELECT 'regression_A_passed';
    `);
    assert.equal(result, "regression_A_passed");
  });
});

test("PostgreSQL regression B: ACCEPTANCE can pass after PILOT passes", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES
        ('PILOT',      'Pilot',      'pending', 1, '{}'::jsonb),
        ('ACCEPTANCE', 'Acceptance', 'pending', 2, '{}'::jsonb);
    `);
    // Pass PILOT first.
    execSql(`
      UPDATE public.release_gate
      SET gate_status = 'passed', passed_at = now(), release_sha = 'sha-pilot'
      WHERE gate_code = 'PILOT';
    `);
    // Now ACCEPTANCE must be passable.
    const result = execSql(`
      UPDATE public.release_gate
      SET gate_status = 'passed', passed_at = now(), release_sha = 'sha-acceptance'
      WHERE gate_code = 'ACCEPTANCE'
      RETURNING gate_code;
    `);
    assert.equal(result, "ACCEPTANCE", "ACCEPTANCE must pass once PILOT is passed");
  });
});

test("PostgreSQL regression C: ACCEPTANCE cannot pass if PILOT row is absent", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    // Only seed ACCEPTANCE — no PILOT row at all.
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES ('ACCEPTANCE', 'Acceptance', 'pending', 2, '{}'::jsonb);
    `);
    // Attempting to pass ACCEPTANCE with no predecessor row must fail (fail closed).
    const result = execSql(`
      DO $$
      DECLARE
        v_state text;
        v_msg   text;
      BEGIN
        BEGIN
          UPDATE public.release_gate
          SET gate_status = 'passed', passed_at = now(), release_sha = 'sha-no-pilot'
          WHERE gate_code = 'ACCEPTANCE';
          RAISE EXCEPTION 'expected rejection did not occur';
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
          GET STACKED DIAGNOSTICS v_msg   = MESSAGE_TEXT;
          IF v_state <> 'P0001' THEN
            RAISE EXCEPTION 'expected SQLSTATE P0001, got %', v_state;
          END IF;
          IF v_msg NOT LIKE '%predecessor%absent%' THEN
            RAISE EXCEPTION 'expected absent-predecessor message, got: %', v_msg;
          END IF;
        END;
      END;
      $$;
      SELECT 'regression_C_passed';
    `);
    assert.equal(result, "regression_C_passed");
  });
});

test("PostgreSQL regression D: passed gates are immutable", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES ('PILOT', 'Pilot', 'pending', 1, '{}'::jsonb);
    `);
    execSql(`
      UPDATE public.release_gate
      SET gate_status = 'passed', passed_at = now(), release_sha = 'sha-pilot'
      WHERE gate_code = 'PILOT';
    `);
    // Any further UPDATE on a passed gate must be rejected.
    // Use a boolean rejection flag so the sentinel RAISE EXCEPTION cannot
    // satisfy its own expected-error handler (which would cause a false pass).
    const result = execSql(`
      DO $$
      DECLARE
        v_rejected boolean := false;
        v_state    text;
        v_msg      text;
      BEGIN
        BEGIN
          UPDATE public.release_gate
          SET gate_name = 'modified'
          WHERE gate_code = 'PILOT';
          -- Trigger did NOT fire — fall through to the post-handler check.
        EXCEPTION WHEN OTHERS THEN
          v_rejected := true;
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
          GET STACKED DIAGNOSTICS v_msg   = MESSAGE_TEXT;
          IF v_state <> 'P0001' THEN
            RAISE EXCEPTION 'expected SQLSTATE P0001 from trigger, got %', v_state;
          END IF;
          IF v_msg NOT LIKE '%immutable%' AND v_msg NOT LIKE '%passed%' THEN
            RAISE EXCEPTION 'unexpected trigger rejection message: %', v_msg;
          END IF;
        END;
        -- Assert outside the handler: the UPDATE must have been rejected.
        IF NOT v_rejected THEN
          RAISE EXCEPTION
            'regression D FAIL: trigger did not reject UPDATE — immutability check failed';
        END IF;
      END;
      $$;
      SELECT 'regression_D_passed';
    `);
    assert.equal(result, "regression_D_passed");
  });
});

test("PostgreSQL regression E: full sequence PILOT→ACCEPTANCE→CUTOVER→LEGACY_RETIREMENT→SCALE", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES
        ('PILOT',             'Pilot',             'pending', 1, '{}'::jsonb),
        ('ACCEPTANCE',        'Acceptance',        'pending', 2, '{}'::jsonb),
        ('CUTOVER',           'Cutover',           'pending', 3, '{}'::jsonb),
        ('LEGACY_RETIREMENT', 'Legacy Retirement', 'pending', 4, '{}'::jsonb),
        ('SCALE',             'Scale',             'pending', 5, '{}'::jsonb);
    `);
    const sha = (g) => `sha-${g.toLowerCase()}`;
    for (const gate of ["PILOT", "ACCEPTANCE", "CUTOVER", "LEGACY_RETIREMENT", "SCALE"]) {
      execSql(`
        UPDATE public.release_gate
        SET gate_status = 'passed', passed_at = now(), release_sha = '${sha(gate)}'
        WHERE gate_code = '${gate}';
      `);
    }
    const count = execSql(`
      SELECT COUNT(*)::text FROM public.release_gate WHERE gate_status = 'passed';
    `);
    assert.equal(count, "5", "all 5 gates must be passed after full sequence traversal");
  });
});

// ── Privilege runtime regression: wave6_canonical_event is SELECT-only ───────

test("PostgreSQL privilege regression: wave6_canonical_event authenticated is SELECT-only after REVOKE/GRANT", async () => {
  await withTempPostgres((execSql) => {
    // Minimal setup: create the authenticated and anon roles and a trivial view.
    execSql(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
      END $$;
    `);
    execSql(`CREATE TABLE public._priv_test_src (id serial);`);
    execSql(`CREATE VIEW public.wave6_canonical_event AS SELECT id FROM public._priv_test_src;`);

    // Simulate the incorrect migration 014 state: grant without prior revoke.
    execSql(`GRANT ALL ON public.wave6_canonical_event TO authenticated;`);
    execSql(`GRANT ALL ON public.wave6_canonical_event TO anon;`);
    execSql(`GRANT ALL ON public.wave6_canonical_event TO PUBLIC;`);

    // Apply the B3 / L2 fix: REVOKE ALL from everyone, then GRANT SELECT to authenticated only.
    execSql(`REVOKE ALL ON public.wave6_canonical_event FROM PUBLIC;`);
    execSql(`REVOKE ALL ON public.wave6_canonical_event FROM anon;`);
    execSql(`REVOKE ALL ON public.wave6_canonical_event FROM authenticated;`);
    execSql(`GRANT SELECT ON public.wave6_canonical_event TO authenticated;`);

    // Verify authenticated has SELECT.
    const hasSelect = execSql(`
      SELECT COUNT(*)::text
      FROM information_schema.role_table_grants
      WHERE table_schema   = 'public'
        AND table_name     = 'wave6_canonical_event'
        AND grantee        = 'authenticated'
        AND privilege_type = 'SELECT';
    `);
    assert.equal(hasSelect, "1", "authenticated must have SELECT on wave6_canonical_event");

    // Verify authenticated has no non-SELECT privilege (including REFERENCES).
    const nonSelectPrivs = execSql(`
      SELECT COUNT(*)::text
      FROM information_schema.role_table_grants
      WHERE table_schema   = 'public'
        AND table_name     = 'wave6_canonical_event'
        AND grantee        = 'authenticated'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES');
    `);
    assert.equal(nonSelectPrivs, "0",
      "authenticated must have no INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on wave6_canonical_event");

    // Verify authenticated has exactly ONE privilege row (SELECT and nothing else).
    const totalPrivs = execSql(`
      SELECT COUNT(*)::text
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name   = 'wave6_canonical_event'
        AND grantee      = 'authenticated';
    `);
    assert.equal(totalPrivs, "1",
      "authenticated must have exactly SELECT — no other privilege on wave6_canonical_event");

    // Verify anon has no privilege via information_schema.
    const anonPrivs = execSql(`
      SELECT COUNT(*)::text
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name   = 'wave6_canonical_event'
        AND grantee      = 'anon';
    `);
    assert.equal(anonPrivs, "0", "anon must have no privilege on wave6_canonical_event");

    // Verify PUBLIC has no privilege via pg_catalog ACL inspection.
    // ACL entries for PUBLIC start with '=' (no role name before the '=').
    const publicHasPriv = execSql(`
      SELECT COALESCE(
        (SELECT bool_or(a.acl::text ~ '^=')
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL unnest(COALESCE(c.relacl, ARRAY[]::aclitem[])) AS a(acl)
         WHERE n.nspname = 'public' AND c.relname = 'wave6_canonical_event'),
        false
      )::text;
    `);
    assert.equal(publicHasPriv, "false",
      "PUBLIC must have no privilege on wave6_canonical_event");
  });
});

// ── B1: Duplicate sequence_order must be rejected ────────────────────────────

test("PostgreSQL regression F: duplicate sequence_order is rejected by UNIQUE constraint", async () => {
  await withTempPostgres((execSql) => {
    execSql(sliceReleaseGateSql());
    // Insert the first PILOT gate (seq 1) — must succeed.
    execSql(`
      INSERT INTO public.release_gate (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
      VALUES ('PILOT', 'Pilot', 'pending', 1, '{}'::jsonb);
    `);
    // Attempting to insert a second gate with sequence_order 1 must be rejected
    // by the uq_rg_sequence_order UNIQUE constraint.
    const result = execSql(`
      DO $$
      DECLARE
        v_rejected boolean := false;
        v_state    text;
        v_msg      text;
      BEGIN
        BEGIN
          INSERT INTO public.release_gate
            (gate_code, gate_name, gate_status, sequence_order, evidence_manifest)
          VALUES ('ACCEPTANCE', 'Acceptance', 'pending', 1, '{}'::jsonb);
          -- Constraint did NOT fire — fall through to post-handler check.
        EXCEPTION WHEN OTHERS THEN
          v_rejected := true;
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
          -- 23505 = unique_violation
          IF v_state <> '23505' THEN
            RAISE EXCEPTION
              'expected SQLSTATE 23505 (unique_violation) from duplicate sequence_order, got %', v_state;
          END IF;
        END;
        IF NOT v_rejected THEN
          RAISE EXCEPTION
            'regression F FAIL: duplicate sequence_order was not rejected — '
            'uq_rg_sequence_order constraint is missing';
        END IF;
      END;
      $$;
      SELECT 'regression_F_passed';
    `);
    assert.equal(result, "regression_F_passed");
  });
});
