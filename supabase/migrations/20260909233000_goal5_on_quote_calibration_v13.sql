-- Goal 5 Ontario residential quote calibration v1.3.
-- Authority: owner-approved closed-quote calibration from the HUC Quoting Desk, 2026-09-09.
-- Governance: preserve ON-2026-08-v1.2 immutable and publish a successor.
--
-- Calibration covered by direct closed-quote evidence:
--   * Compact 4 bed / 3.5 bath detached Refresh at ~2,000 sq ft: CA$350 pre-tax.
--   * Biweekly recurring default: 10% off Essential Refresh when the recurring cadence is selected.
--
-- Other observed differences (specialty carpet work, partial-home scope, and package selection)
-- are workflow/scope-selection issues and are intentionally NOT hidden inside matrix prices.

insert into public.configuration_version (
  organization_id, business_unit_id, jurisdiction_id, configuration_type,
  version, status, effective_from, effective_to, configuration, approved_by, approved_at
)
select
  prior.organization_id,
  prior.business_unit_id,
  prior.jurisdiction_id,
  prior.configuration_type,
  'ON-2026-08-v1.3',
  'published',
  timestamptz '2026-09-09 00:00:00-04',
  null,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        prior.configuration,
        '{dwelling_matrix,semi_detached_detached,4bed_3_5bath,essential_refresh}',
        to_jsonb(350),
        false
      ),
      '{recurring_service,biweekly_discount}',
      jsonb_build_object('min', 0.05, 'max', 0.10, 'preferred', 0.10),
      true
    ),
    '{authority,quote_calibration}',
    jsonb_build_object(
      'supersedes_version', prior.version,
      'change_type', 'owner_approved_closed_quote_calibration',
      'approved_date', '2026-09-09',
      'compact_4bed_3_5bath_refresh_cad', 350,
      'biweekly_preferred_discount', 0.10,
      'scope_rules', jsonb_build_array(
        'scope_drives_package_not_customer_label',
        'new_recurring_customer_initial_reset_then_essential_refresh',
        'partial_home_requires_explicit_scope_and_price',
        'specialty_carpet_shampooing_is_separate_from_normal_vacuuming',
        'move_in_status_does_not_automatically_force_move_in_move_out_package'
      ),
      'do_not_reduce_price_without_reducing_scope', true
    ),
    true
  ),
  prior.approved_by,
  now()
from public.configuration_version prior
join public.business_unit bu on bu.id = prior.business_unit_id
join public.jurisdiction j on j.id = prior.jurisdiction_id
where prior.version = 'ON-2026-08-v1.2'
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
      and existing.version = 'ON-2026-08-v1.3'
  );
