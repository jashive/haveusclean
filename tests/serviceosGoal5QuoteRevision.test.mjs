import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260826033000_goal5_governed_quote_revision.sql','utf8');
const approverMigration = fs.readFileSync('supabase/migrations/20260826033500_goal5_quote_revision_approvers.sql','utf8');
const panel = fs.readFileSync('src/features/wave1/ServiceOSQuoteRevisionPanel.jsx','utf8');
const client = fs.readFileSync('src/lib/serviceosQuoteRevisionClient.js','utf8');
const shell = fs.readFileSync('src/features/wave1/ServiceOSWave1Workspace.jsx','utf8');

test('5.6H is mounted between delivery and customer response', () => {
  assert.match(shell,/ServiceOSQuoteRevisionPanel/);
  assert.match(shell,/<ServiceOSQuoteDeliveryPanel[\s\S]*<ServiceOSQuoteRevisionPanel[\s\S]*<ServiceOSCustomerResponsePanel/);
});

test('revision clones commercial state into a new version and supersedes the source', () => {
  assert.match(migration,/supersedes_quote_version_id/);
  assert.match(migration,/select coalesce\(max\(version_no\),0\)\+1 into v_next_version/);
  assert.match(migration,/insert into public\.pricing_snapshot/i);
  assert.match(migration,/insert into public\.quote_version/i);
  assert.match(migration,/update public\.quote_version set lifecycle_status='superseded'/i);
  assert.match(migration,/pricing_snapshot is immutable|create_revised_quote_version/i);
});

test('approved concession requires reason and an active owner admin approver', () => {
  assert.match(migration,/Approved concession requires Reason/);
  assert.match(migration,/Approved concession requires Approved By/);
  assert.match(migration,/ar\.code='owner_admin'/);
  assert.match(migration,/Approved By must be an active owner_admin authorized for this business unit/);
  assert.match(approverMigration,/ar\.code='owner_admin'/);
  assert.match(panel,/Reason \(required\)/);
  assert.match(panel,/Approved By \(required owner\/admin\)/);
});

test('scope adjustment recalculates governed package/add-ons and enforces partial minimum', () => {
  assert.match(panel,/computeGovernedResidentialQuote/);
  assert.match(panel,/applyGovernedResidentialAddons/);
  assert.match(panel,/Package \/ Add-on Revision/);
  assert.match(panel,/Partial Home \/ Selected Areas/);
  assert.match(panel,/minimum_charge\?\.partial_cleaning/);
  assert.match(panel,/cannot be quoted below[\s\S]*without an Approved Concession/);
});

test('revision starts draft and does not fabricate acceptance conversion or job', () => {
  assert.match(migration,/v_next_version,'draft'/);
  const fn = migration.slice(migration.indexOf('create or replace function public.create_revised_quote_version'));
  assert.doesNotMatch(fn,/insert into public\.quote_response/i);
  assert.doesNotMatch(fn,/insert into public\.conversion_record/i);
  assert.doesNotMatch(fn,/insert into public\.job_handoff/i);
  assert.doesNotMatch(fn,/insert into public\.operational_job/i);
  assert.match(panel,/Use Quote Delivery above to email the new canonical version/);
});

test('client uses authenticated RPCs and adds no Vercel serverless function', () => {
  assert.match(client,/rpc\/create_revised_quote_version/);
  assert.match(client,/rpc\/list_quote_revision_approvers/);
  assert.doesNotMatch(client,/service_role|SUPABASE_SERVICE_ROLE/i);
  assert.equal(fs.existsSync('api/quote-revision.js'), false);
});
