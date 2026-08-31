-- Goal 5 Arizona residential Kitchen & Bath parity patch v1.1
-- Governance: preserve AZ-2026-08-v1.0 immutable; publish a successor version.
-- Pricing basis: owner-approved local-market parity using the existing HUC-AZ residential matrix
-- and add-on economics. Kitchen & Bath pricing is bathroom-count based and remains USD / zero service tax.

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
  'AZ-2026-08-v1.1',
  'published',
  timestamptz '2026-08-31 00:00:00-07',
  null,
  jsonb_set(
    jsonb_set(
      prior.configuration,
      '{kitchen_bath_packages}',
      jsonb_build_object(
        'kitchen_1bath', jsonb_build_object('essential_refresh',160,'complete_deep',220),
        'kitchen_1_5bath', jsonb_build_object('essential_refresh',175,'complete_deep',240),
        'kitchen_2bath', jsonb_build_object('essential_refresh',195,'complete_deep',260),
        'kitchen_2_5bath', jsonb_build_object('essential_refresh',220,'complete_deep',280),
        'kitchen_3bath', jsonb_build_object('essential_refresh',240,'complete_deep',300),
        'kitchen_3_5bath', jsonb_build_object('essential_refresh',265,'complete_deep',325),
        'kitchen_4bath', jsonb_build_object('essential_refresh',285,'complete_deep',345),
        'complete_deep_includes', jsonb_build_array('Inside refrigerator','Inside oven'),
        'inside_kitchen_cabinets_additional_minimum', 35
      ),
      true
    ),
    '{authority,coverage_patch}',
    jsonb_build_object(
      'supersedes_version', prior.version,
      'change_type', 'kitchen_bath_service_parity_patch',
      'change_reason', 'Publish first-class Arizona Kitchen & Bath Refresh and Deep pricing',
      'pricing_basis', 'owner-approved local-market parity derived from existing HUC-AZ residential and add-on economics'
    ),
    true
  ),
  prior.approved_by,
  now()
from public.configuration_version prior
join public.business_unit bu on bu.id = prior.business_unit_id
join public.jurisdiction j on j.id = prior.jurisdiction_id
where prior.version = 'AZ-2026-08-v1.0'
  and prior.configuration_type = 'residential_pricing'
  and prior.status = 'published'
  and bu.code = 'HUC-AZ'
  and j.code = 'US-AZ'
  and not exists (
    select 1
    from public.configuration_version existing
    where existing.organization_id = prior.organization_id
      and existing.business_unit_id = prior.business_unit_id
      and existing.jurisdiction_id = prior.jurisdiction_id
      and existing.configuration_type = prior.configuration_type
      and existing.version = 'AZ-2026-08-v1.1'
  );
