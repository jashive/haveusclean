import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../src/features/wave1/ServiceOSWave1Workspace.jsx', import.meta.url), 'utf8');
const prodEnv = fs.readFileSync(new URL('../.env.production', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/014_wave5_finance_role_rls.sql', import.meta.url), 'utf8');

test('Wave 5 Finance is enabled for controlled Production activation while Intelligence remains dark', () => {
  assert.match(prodEnv, /^VITE_SERVICEOS_FINANCE_ENABLED=true$/m);
  assert.doesNotMatch(prodEnv, /^VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED=true$/m);
  assert.match(shell, /VITE_SERVICEOS_FINANCE_ENABLED/);
});

test('Finance role RLS is BU-scoped and provider-bound browser writes remain blocked', () => {
  for (const table of ['billing_readiness_gate','invoice_request','accounting_sync_outbox','payment_observation','contractor_compensation_version','contractor_payable','job_profitability_snapshot']) {
    assert.match(migration, new RegExp(table));
  }
  assert.match(migration, /ARRAY\['finance'\]::text\[\]/);
  assert.doesNotMatch(migration, /CREATE POLICY pol_aso_finance_(insert|update|all)/i);
  assert.doesNotMatch(migration, /CREATE POLICY pol_po_finance_(insert|update|all)/i);
  assert.doesNotMatch(migration, /CREATE POLICY pol_ccv_finance_(insert|update|all)/i);
});
