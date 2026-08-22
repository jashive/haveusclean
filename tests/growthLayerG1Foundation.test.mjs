import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260822053000_growth_layer_g1_foundation.sql';
const envPath = '.env.example';
const sql = fs.readFileSync(migrationPath, 'utf8');
const env = fs.readFileSync(envPath, 'utf8');

test('Growth G1 uses a private growth schema and does not create public Growth tables', () => {
  assert.match(sql, /create schema if not exists growth;/i);
  assert.doesNotMatch(sql, /create table public\.(prospect|prospect_contact|enrichment|suppression|handoff)/i);
  assert.match(sql, /revoke all on schema growth from public, anon, authenticated;/i);
  assert.match(sql, /grant usage on schema growth to service_role;/i);
});

test('Growth lifecycle remains pre-handoff and excludes ServiceOS Revenue terminal states', () => {
  assert.match(sql, /'handoff_ready'/);
  assert.match(sql, /'suppressed'/);
  assert.match(sql, /'disqualified'/);
  assert.doesNotMatch(sql, /lifecycle_status[^;]*'quoted'/is);
  assert.doesNotMatch(sql, /lifecycle_status[^;]*'won'/is);
  assert.doesNotMatch(sql, /lifecycle_status[^;]*'lost'/is);
});

test('Growth handoff links to ServiceOS instead of duplicating Revenue entities', () => {
  assert.match(sql, /serviceos_service_request_id uuid references public\.service_request\(id\)/i);
  assert.match(sql, /serviceos_opportunity_id uuid references public\.opportunity\(id\)/i);
  assert.doesNotMatch(sql, /create table growth\.(estimate|pricing_snapshot|quote|quote_version|quote_response|conversion_record|job_handoff)/i);
});

test('G1 includes dedupe, enrichment, scoring, suppression and audit controls', () => {
  for (const table of [
    'growth.prospect',
    'growth.prospect_contact_candidate',
    'growth.enrichment_evidence',
    'growth.prospect_score',
    'growth.suppression',
    'growth.handoff_candidate',
    'growth.audit_event',
  ]) assert.match(sql, new RegExp(`create table ${table.replace('.', '\\.')}`, 'i'));
  assert.match(sql, /growth_prospect_domain_idx/i);
  assert.match(sql, /growth_suppression_identity_uk/i);
  assert.match(sql, /growth_handoff_idempotency_uk/i);
});

test('Growth gates are independently OFF by default', () => {
  assert.match(env, /^VITE_GROWTH_LAYER_ENABLED=false$/m);
  assert.match(env, /^GROWTH_LAYER_ENABLED=false$/m);
  assert.match(env, /^GROWTH_OUTREACH_ENABLED=false$/m);
  assert.match(env, /^GROWTH_AUTO_FOLLOWUP_ENABLED=false$/m);
  assert.match(env, /^GROWTH_SERVICEOS_HANDOFF_ENABLED=false$/m);
});
