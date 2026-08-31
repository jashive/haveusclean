-- Goal 5 Ontario residential pricing coverage patch v1.1
-- Governance: preserve ON-2026-08-v1.0 immutable; publish a successor version.
-- Owner-approved bridge row for townhouse 3 bed / 2 bath is derived from the adjacent
-- 3 bed / 1.5 bath and 3 bed / 2.5 bath rows using midpoint interpolation rounded to
-- the existing CAD $5 pricing convention.
-- Derived row: Essential 260, Initial Reset 340, Complete Deep 460, Move-Out 315.
-- Normal square-foot band: midpoint bridge 1,200-1,650 sq ft.

insert into public.configuration_version (
  organization_id,
  business_unit_id,
  jurisdiction_id,
  configuration_type,
  version,
  status,
  effective_from,
  effective_to,
  configuration,
  approved_by,
  approved_at
)
select
  prior.organization_id,
  prior.business_unit_id,
  prior.jurisdiction_id,
  prior.configuration_type,
  'ON-2026-08-v1.1',
  'published',
  timestamptz '2026-08-28 00:00:00-04',
  null,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        prior.configuration,
        '{dwelling_matrix,townhouses,3bed_2bath}',
        jsonb_build_object(
          'sqft_min', 1200,
          'sqft_max', 1650,
          'essential_refresh', 260,
          'signature_initial_reset', 340,
          'complete_deep', 460,
          'move_in_move_out', 315,
          'pricing_basis', 'owner_approved_midpoint_bridge_from_adjacent_3bed_townhouse_rows'
        ),
        true
      ),
      '{authority,effective_period}',
      to_jsonb('August 2026 v1.1 coverage patch'::text),
      true
    ),
    '{authority,coverage_patch}',
    jsonb_build_object(
      'supersedes_version', prior.version,
      'change_type', 'pricing_matrix_coverage_patch',
      'change_reason', 'Add standard townhouse 3 bed / 2 bath coverage and prevent quote dead-end',
      'derived_row_method', 'midpoint interpolation between 3bed_1_5bath and 3bed_2_5bath rounded to $5'
    ),
    true
  ),
  prior.approved_by,
  now()
from public.configuration_version prior
join public.business_unit bu on bu.id = prior.business_unit_id
join public.jurisdiction j on j.id = prior.jurisdiction_id
where prior.version = 'ON-2026-08-v1.0'
  and prior.configuration_type = 'residential_pricing'
  and prior.status = 'published'
  and bu.code = 'HUC-ON'
  and j.code = 'CA-ON'
  and not exists (
    select 1
    from public.configuration_version existing
    where existing.organization_id = prior.organization_id
      and existing.business_unit_id = prior.business_unit_id
      and existing.jurisdiction_id = prior.jurisdiction_id
      and existing.configuration_type = prior.configuration_type
      and existing.version = 'ON-2026-08-v1.1'
  );
