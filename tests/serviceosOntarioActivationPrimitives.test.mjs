import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "./serviceosFinancialPerformance.test.mjs";
import "./serviceosCleanerExecutionPlaybook.test.mjs";

const migration = fs.readFileSync(
  "supabase/migrations/20260906224603_ontario_activation_primitives.sql",
  "utf8",
);

test("Ontario safety orientation 2026.1 is an active HUC-ON scoped module", () => {
  assert.match(migration, /'HUC_SAFETY_ORIENTATION'[\s\S]*?'2026\.1'/);
  assert.match(migration, /'safety'[\s\S]*?'ON'[\s\S]*?'all'/);
  assert.match(migration, /unit\.code = 'HUC-ON'/);
  assert.match(migration, /'required_for_activation', true/);
});

test("safety orientation binds employee and independent-contractor requirements", () => {
  assert.match(migration, /'ON', 'employee', 'all', 'HUC_SAFETY_ORIENTATION'/);
  assert.match(migration, /'ON', 'independent_contractor', 'all', 'HUC_SAFETY_ORIENTATION'/);
  assert.match(migration, /insert into hems_hr\.training_module_binding/i);
  assert.match(migration, /on conflict \(requirement_definition_id\) do nothing/i);
});

test("Ontario employee WSIB coverage remains a fail-closed activation requirement", () => {
  assert.match(migration, /'ON', 'employee', 'all', 'ON_WSIB_EMPLOYER_COVERAGE', '2026\.1'/);
  assert.match(migration, /'organization_coverage'[\s\S]*?'WSIB Ontario'/);
  assert.match(migration, /'activation', date '2026-01-01'/);
  assert.doesNotMatch(migration, /insert into hems_hr\.organization_coverage/i);
  assert.doesNotMatch(migration, /verification_status[\s\S]*?'verified'/i);
});

test("existing non-terminal Ontario engagements receive missing primitives idempotently", () => {
  assert.match(migration, /insert into hems_hr\.engagement_requirement/i);
  assert.match(migration, /engagement\.home_jurisdiction = 'ON'/);
  assert.match(migration, /engagement_status not in \('inactive', 'terminated', 'offboarded'\)/);
  assert.match(migration, /on conflict \(engagement_id, requirement_definition_id\) do nothing/i);
});

test("migration is transactional, self-validating, and does not alter public API grants", () => {
  assert.match(migration, /^begin;/im);
  assert.match(migration, /do \$validation\$/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /grant\s+execute|grant\s+(select|insert|update|delete)/i);
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function/i);
});
