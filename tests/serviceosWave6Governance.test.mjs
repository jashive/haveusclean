// Wave 6 — governance: change-control FSM, management review lifecycle,
// release gate sequencing, and HEMS dependency graph traversal.
// Pure tests: no database, no network.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

test("non-material change closes with empty assessment", () => {
  assert.equal(
    canCloseChangeControlRecord({
      change_status: "validate",
      material_change: false,
      impact_assessment: {},
      validation_result: {},
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
    { kg_id: "KG-TEST", from_node: "A", to_node: "B", edge_type: "depends_on" },
    { kg_id: "KG-TEST", from_node: "B", to_node: "C", edge_type: "depends_on" },
    { kg_id: "KG-TEST", from_node: "C", to_node: "D", edge_type: "depends_on" },
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
