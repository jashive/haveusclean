-- Goal 5.6A: governed Arizona residential pricing configuration.
-- Source authority: HAVE US CLEAN ARIZONA RESIDENTIAL PRICING MATRIX (August 2026)
-- Recurring discounts/minimum: Have Us Clean Internal Pricing Playbook (Jan 2026).

insert into public.configuration_version (
  organization_id, business_unit_id, jurisdiction_id, configuration_type,
  version, status, effective_from, configuration
)
select
  bu.organization_id,
  bu.id,
  bu.jurisdiction_id,
  'residential_pricing',
  'AZ-2026-08-v1.0',
  'published',
  timestamptz '2026-08-01 00:00:00-07',
  jsonb_build_object(
    'schema_version','1.0',
    'service_family','residential_cleaning',
    'business_unit_code','HUC-AZ',
    'jurisdiction_code','US-AZ',
    'currency_code','USD',
    'authority',jsonb_build_object(
      'document','HAVE US CLEAN ARIZONA RESIDENTIAL PRICING MATRIX',
      'effective_period','August 2026',
      'recurring_policy_source','Have Us Clean Internal Pricing Playbook'
    ),
    'tax',jsonb_build_object('label','SERVICE TAX','rate',0,'service_taxable',false,'applies_to_final_subtotal',true),
    'minimum_charge',jsonb_build_object('general_residential',60,'partial_cleaning',60,'move_in_move_out',60,'management_approval_required_below_minimum',true),
    'dwelling_matrix',jsonb_build_object(
      'apartments_condos',jsonb_build_object(
        '0bed_0bath',jsonb_build_object('essential_refresh',110,'signature_initial_reset',150,'complete_deep',240,'move_in_move_out',175),
        '1bed_1bath',jsonb_build_object('essential_refresh',130,'signature_initial_reset',170,'complete_deep',260,'move_in_move_out',190),
        '2bed_1bath',jsonb_build_object('essential_refresh',150,'signature_initial_reset',200,'complete_deep',290,'move_in_move_out',220),
        '2bed_2bath',jsonb_build_object('essential_refresh',170,'signature_initial_reset',225,'complete_deep',315,'move_in_move_out',240),
        '3bed_2bath',jsonb_build_object('essential_refresh',220,'signature_initial_reset',280,'complete_deep',370,'move_in_move_out',300)
      ),
      'townhouses',jsonb_build_object(
        '2bed_2bath',jsonb_build_object('essential_refresh',190,'signature_initial_reset',250,'complete_deep',340,'move_in_move_out',260),
        '3bed_2_5bath',jsonb_build_object('essential_refresh',240,'signature_initial_reset',310,'complete_deep',400,'move_in_move_out',330),
        '4bed_2_5bath',jsonb_build_object('essential_refresh',270,'signature_initial_reset',340,'complete_deep',430,'move_in_move_out',360)
      ),
      'semi_detached_detached',jsonb_build_object(
        '2bed_2bath',jsonb_build_object('essential_refresh',220,'signature_initial_reset',290,'complete_deep',380,'move_in_move_out',300),
        '3bed_2bath',jsonb_build_object('essential_refresh',250,'signature_initial_reset',330,'complete_deep',420,'move_in_move_out',350),
        '3bed_3bath',jsonb_build_object('essential_refresh',275,'signature_initial_reset',360,'complete_deep',450,'move_in_move_out',375),
        '4bed_2_5bath',jsonb_build_object('essential_refresh',300,'signature_initial_reset',390,'complete_deep',480,'move_in_move_out',400),
        '4bed_3bath',jsonb_build_object('essential_refresh',325,'signature_initial_reset',420,'complete_deep',510,'move_in_move_out',425),
        '5bed_4bath',jsonb_build_object('essential_refresh',400,'signature_initial_reset',500,'complete_deep',600,'move_in_move_out',500)
      )
    ),
    'packages',jsonb_build_object(
      'essential_refresh_clean',jsonb_build_object('name','Essential Refresh Clean'),
      'signature_initial_reset_clean',jsonb_build_object('name','Signature Initial Reset Clean'),
      'complete_deep_clean',jsonb_build_object('name','Complete Deep Clean'),
      'move_in_move_out_clean',jsonb_build_object('name','Move-In / Move-Out Clean')
    ),
    'premium_addons',jsonb_build_object(
      'inside_refrigerator',35,'inside_oven',35,'inside_kitchen_cabinets_minimum',35,
      'interior_windows_starting',35,'pet_hair_removal_starting',35,'heavy_baseboard_detailing_starting',35,
      'balcony_cleaning_starting',35,'garage_sweep_out_starting',35,'bed_making_existing_bedding_per_bed',10,
      'appliance_pull_out_deep_clean_starting',175
    ),
    'recurring_service',jsonb_build_object(
      'weekly_discount',jsonb_build_object('min',0.15,'max',0.15),
      'biweekly_discount',jsonb_build_object('min',0.10,'max',0.10),
      'monthly_discount',jsonb_build_object('min',0.05,'max',0.05),
      'ongoing_baseline','Essential Refresh Clean'
    ),
    'condition_adjustments',jsonb_build_object(
      'light',jsonb_build_object('minimum_markup',0,'maximum_markup',0),
      'moderate',jsonb_build_object('minimum_markup',0.10,'maximum_markup',0.15),
      'heavy',jsonb_build_object('minimum_markup',0.20,'maximum_markup',0.35),
      'custom_quote_required_for',jsonb_build_array('biohazard','human or animal waste','unsafe access','scope unclear')
    ),
    'urgency',jsonb_build_object(
      'small_job_premium',jsonb_build_object('minimum',25,'maximum',25),
      'larger_job_premium',jsonb_build_object('minimum',50,'maximum',75),
      'same_day_subject_to_availability',true
    ),
    'square_footage_adjustments',jsonb_build_object('more_than_1000_sqft_above_typical','custom_quote_recommended'),
    'quote_controls',jsonb_build_object('fixed_price_requires_confirmed_scope',true,'starting_price_when_information_incomplete',true)
  )
from public.business_unit bu
join public.jurisdiction j on j.id = bu.jurisdiction_id
where bu.code = 'HUC-AZ' and j.code = 'US-AZ'
  and not exists (
    select 1 from public.configuration_version cv
    where cv.business_unit_id = bu.id
      and cv.configuration_type = 'residential_pricing'
      and cv.version = 'AZ-2026-08-v1.0'
  );
