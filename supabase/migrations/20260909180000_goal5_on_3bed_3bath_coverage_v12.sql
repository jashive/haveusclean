-- Goal 5 Ontario 3 bed / 3 bath residential pricing coverage v1.2.
-- Governance: preserve ON-2026-08-v1.1 immutable and publish a successor.
-- The townhouse row extends the adjacent published 3 bed / 2 and 2.5 bath
-- progression by one half-bath step. Prices use the established CAD $25
-- half-bath increment; the normal square-foot range advances by the same
-- 100 sq ft minimum / 150 sq ft maximum step as the adjacent row.

insert into public.configuration_version (
  organization_id, business_unit_id, jurisdiction_id, configuration_type,
  version, status, effective_from, effective_to, configuration, approved_by, approved_at
)
select
  prior.organization_id, prior.business_unit_id, prior.jurisdiction_id,
  prior.configuration_type, 'ON-2026-08-v1.2', 'published',
  timestamptz '2026-09-09 00:00:00-04', null,
  jsonb_set(
    jsonb_set(
      prior.configuration,
      '{dwelling_matrix,townhouses,3bed_3bath}',
      jsonb_build_object(
        'sqft_min', 1400, 'sqft_max', 1950,
        'essential_refresh', 300, 'signature_initial_reset', 375,
        'complete_deep', 495, 'move_in_move_out', 350,
        'pricing_basis', 'owner_authorized_adjacent_half_bath_progression'
      ), true
    ),
    '{authority,coverage_patch}',
    jsonb_build_object(
      'supersedes_version', prior.version,
      'change_type', 'pricing_matrix_coverage_patch',
      'change_reason', 'Add townhouse 3 bed / 3 bath to the public governed booking catalog',
      'pricing_basis', 'Adjacent published Ontario townhouse half-bath progression',
      'half_bath_increment_cad', 25,
      'square_footage_step', jsonb_build_object('minimum',100,'maximum',150),
      'market_parity', 'Arizona v1.2 already contains 3 bed / 3 bath rows for every residential dwelling type'
    ), true
  ),
  prior.approved_by, now()
from public.configuration_version prior
join public.business_unit bu on bu.id = prior.business_unit_id
join public.jurisdiction j on j.id = prior.jurisdiction_id
where prior.version = 'ON-2026-08-v1.1'
  and prior.configuration_type = 'residential_pricing'
  and prior.status = 'published'
  and bu.code = 'HUC-ON'
  and j.code = 'CA-ON'
  and not exists (
    select 1 from public.configuration_version existing
    where existing.organization_id = prior.organization_id
      and existing.business_unit_id = prior.business_unit_id
      and existing.jurisdiction_id = prior.jurisdiction_id
      and existing.configuration_type = prior.configuration_type
      and existing.version = 'ON-2026-08-v1.2'
  );
