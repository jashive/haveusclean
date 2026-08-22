import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync(new URL('../src/features/wave5/ServiceOSFinanceWorkspace.jsx', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../src/features/wave1/ServiceOSWave1Workspace.jsx', import.meta.url), 'utf8');
const caMigration = fs.readFileSync(new URL('../supabase/migrations/015_wave5_finance_corrective_action_read.sql', import.meta.url), 'utf8');

test('Wave 5 Finance workspace is independently feature-gated and finance-role only', () => {
  assert.match(workspace, /VITE_SERVICEOS_FINANCE_ENABLED/);
  assert.match(workspace, /role === "finance"/);
  assert.match(shell, /FINANCE_ENABLED && role === "finance"/);
  assert.match(shell, /data-finance-authorized/);
});

test('Wave 5 Finance workspace is deliberately limited to readiness and frozen invoice request', () => {
  assert.match(workspace, /Assess Billing Readiness/);
  assert.match(workspace, /Create Frozen Invoice Request/);
  assert.match(workspace, /assessBillingReadiness/);
  assert.match(workspace, /createAndFreezeInvoiceRequest/);
  assert.match(workspace, /QuickBooks send, payment creation, and contractor payout execution are not available here/);
  assert.doesNotMatch(workspace, /createPaymentObservation/);
  assert.doesNotMatch(workspace, /enqueueAccountingSync/);
  assert.doesNotMatch(workspace, /createContractorPayable/);
});

test('Wave 5 Finance conversion lineage is read from the canonical operational job', () => {
  assert.match(workspace, /job\.conversion_record_id/);
  assert.doesNotMatch(workspace, /handoff\?\.conversion_record_id/);
});

test('Finance can read corrective actions but receives no corrective-action write policy', () => {
  assert.match(caMigration, /pol_ca_finance_select/);
  assert.match(caMigration, /FOR SELECT TO authenticated/);
  assert.match(caMigration, /ARRAY\['finance'\]::text\[\]/);
  assert.doesNotMatch(caMigration, /FOR (INSERT|UPDATE|DELETE|ALL)/i);
});
