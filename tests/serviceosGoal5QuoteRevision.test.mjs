import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRevisionSourceScope,
  deriveLegacySqftBand,
} from '../src/lib/serviceosQuoteRevisionClient.js';

const migration = fs.readFileSync('supabase/migrations/20260826033000_goal5_governed_quote_revision.sql','utf8');
const approverMigration = fs.readFileSync('supabase/migrations/20260826033500_goal5_quote_revision_approvers.sql','utf8');
const acceptanceLineageHotfix = fs.readFileSync('supabase/migrations/20260826064500_goal5_revised_quote_acceptance_lineage.sql','utf8');
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

test('legacy Mississauga comparison quote recovers 3,000 sqft scope and governed sqft band', () => {
  const scope = buildRevisionSourceScope({
    pricing: {
      calculation_inputs: {
        matrix_key: '4bed_3bath',
        actual_sqft: 3000,
        matrix_sqft_max: 2500,
        selection_pending: true,
        sqft_adjustment_used: 25,
      },
      raw_calculation_snapshot: {
        selectionPending: true,
        bindingTotal: null,
      },
    },
    serviceRequest: {
      requirements: {
        sqft: 3000,
        bedrooms: 4,
        bathrooms: 3,
        dwelling_type: 'detached_house',
      },
    },
  });
  assert.equal(scope.sqft, 3000);
  assert.equal(scope.beds, 4);
  assert.equal(scope.baths, 3);
  assert.equal(scope.dwellingType, 'detached_house');
  assert.equal(scope.sqftBand, 'additional_250_500_sqft');
  assert.equal(deriveLegacySqftBand({ sqft: 3000, matrixSqftMax: 2500 }), 'additional_250_500_sqft');
});

test('legacy comparison revisions resolve active market configuration instead of frozen incomplete config', () => {
  assert.match(client,/getGovernedResidentialRequiredVersion/);
  assert.match(client,/fetchPublishedGovernedResidentialConfig/);
  assert.match(client,/canonicalBusinessUnitId/);
  assert.match(client,/businessUnitCode/);
  assert.match(client,/jurisdictionId/);
  assert.match(client,/canonicalCurrencyCode/);
  assert.match(panel,/selected\.activeConfigurationVersion \|\| configurationVersionFromSnapshot/);
  assert.match(panel,/buildGovernedResidentialConfigurationSnapshot/);
  assert.match(panel,/configuration_version_id: configurationVersion\?\.id/);
});

test('fresh governed revision carries canonical crew size and job hours into pricing snapshot', () => {
  assert.match(panel,/teamSize: quote\.teamSize \?\? null/);
  assert.match(panel,/jobHours: quote\.jobHours \?\? null/);
  assert.match(panel,/Crew Size: \{preview\.quote\.teamSize\}/);
  assert.match(panel,/Planned Hours: \{preview\.quote\.jobHours\}/);
  assert.match(panel,/getDefaultApprovedSelections\(configVersion,[\s\S]*sqft: sourceScope\.sqft/);
});

test('zero binding total legacy comparison cannot be treated as concession base', () => {
  assert.match(panel,/Legacy comparison quote has no binding subtotal/);
  assert.match(panel,/ServiceOS will re-price it from the active governed/);
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

test('revised quote acceptance validates parent quote to opportunity, not stale parent estimate', () => {
  assert.match(acceptanceLineageHotfix,/Parent quote lineage is quote -> opportunity/);
  assert.match(acceptanceLineageHotfix,/SELECT opportunity_id[\s\S]*FROM public\.quote/i);
  assert.doesNotMatch(acceptanceLineageHotfix,/quote_estimate/);
  assert.match(acceptanceLineageHotfix,/version_estimate IS DISTINCT FROM NEW\.estimate_id/);
  assert.match(acceptanceLineageHotfix,/version_quote IS DISTINCT FROM NEW\.quote_id/);
  assert.match(acceptanceLineageHotfix,/response_version IS DISTINCT FROM NEW\.quote_version_id/);
  assert.match(acceptanceLineageHotfix,/response_type_value <> 'accepted'/);
});