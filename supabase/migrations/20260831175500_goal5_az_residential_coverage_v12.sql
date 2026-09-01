-- Goal 5.5 Arizona residential pricing coverage completion v1.2
-- Governance: preserve AZ-2026-08-v1.1 immutable; publish a successor version.
-- Source authority: Google Drive document "HAVE US CLEAN ARIZONA RESIDENTIAL PRICING MATRIX"
-- (Drive file 1txtaX9EMg12jAGovbkv4SUyGlZLSVvReq1u6wfxDsYw), August 2026.
-- Existing published anchor rows remain exact. Missing standard bed/bath combinations are
-- materialized from the nearest canonical anchor using a controlled residential coverage rule:
--   Apartment/Condo: +/- $25 per bedroom and +/- $15 per half-bath step
--   Townhouse:       +/- $30 per bedroom and +/- $15 per half-bath step
--   Detached:        +/- $35 per bedroom and +/- $15 per half-bath step
-- Derived prices round to the nearest $5. All four whole-home packages receive the same
-- dimensional increment so the published package spread from the nearest canonical anchor is preserved.

with prior as (
  select cv.*
  from public.configuration_version cv
  join public.business_unit bu on bu.id = cv.business_unit_id
  join public.jurisdiction j on j.id = cv.jurisdiction_id
  where cv.version = 'AZ-2026-08-v1.1'
    and cv.configuration_type = 'residential_pricing'
    and cv.status = 'published'
    and bu.code = 'HUC-AZ'
    and j.code = 'US-AZ'
  limit 1
),
anchors(dwelling_key,beds,baths,essential_refresh,signature_initial_reset,complete_deep,move_in_move_out) as (
  values
    ('apartments_condos',0,0.0,110,150,240,175),
    ('apartments_condos',1,1.0,130,170,260,190),
    ('apartments_condos',2,1.0,150,200,290,220),
    ('apartments_condos',2,2.0,170,225,315,240),
    ('apartments_condos',3,2.0,220,280,370,300),
    ('townhouses',2,2.0,190,250,340,260),
    ('townhouses',3,2.5,240,310,400,330),
    ('townhouses',4,2.5,270,340,430,360),
    ('semi_detached_detached',2,2.0,220,290,380,300),
    ('semi_detached_detached',3,2.0,250,330,420,350),
    ('semi_detached_detached',3,3.0,275,360,450,375),
    ('semi_detached_detached',4,2.5,300,390,480,400),
    ('semi_detached_detached',4,3.0,325,420,510,425),
    ('semi_detached_detached',5,4.0,400,500,600,500)
),
standard_combos as (
  -- Apartment / condo: studio plus 1-4 bedroom layouts with half-bath coverage.
  select 'apartments_condos'::text as dwelling_key, 0::int as beds, b::numeric as baths
  from generate_series(1.0::numeric,1.5::numeric,0.5::numeric) b
  union all
  select 'apartments_condos', bed, bath
  from generate_series(1,4) bed
  cross join generate_series(1.0::numeric,4.0::numeric,0.5::numeric) bath
  where bath <= least(4.0::numeric, bed::numeric + 1.5::numeric)
  union all
  -- Townhouse: 1-5 bedroom standard layouts.
  select 'townhouses', bed, bath
  from generate_series(1,5) bed
  cross join generate_series(1.0::numeric,4.5::numeric,0.5::numeric) bath
  where bath <= least(4.5::numeric, bed::numeric + 1.5::numeric)
  union all
  -- Detached / single-family: 1-6 bedroom standard layouts.
  select 'semi_detached_detached', bed, bath
  from generate_series(1,6) bed
  cross join generate_series(1.0::numeric,5.0::numeric,0.5::numeric) bath
  where bath <= least(5.0::numeric, bed::numeric + 1.5::numeric)
),
all_combos as (
  select * from standard_combos
  union
  select dwelling_key,beds,baths from anchors
),
resolved as (
  select
    c.dwelling_key,
    c.beds,
    c.baths,
    a.beds as anchor_beds,
    a.baths as anchor_baths,
    a.essential_refresh,
    a.signature_initial_reset,
    a.complete_deep,
    a.move_in_move_out,
    case c.dwelling_key
      when 'apartments_condos' then 25
      when 'townhouses' then 30
      else 35
    end as bedroom_increment,
    15 as half_bath_increment,
    exists (
      select 1 from anchors x
      where x.dwelling_key=c.dwelling_key and x.beds=c.beds and x.baths=c.baths
    ) as is_anchor
  from all_combos c
  cross join lateral (
    select a.*
    from anchors a
    where a.dwelling_key=c.dwelling_key
    order by
      (abs(c.beds-a.beds)*2 + abs(c.baths-a.baths)) asc,
      abs(c.baths-a.baths) asc,
      abs(c.beds-a.beds) asc,
      a.beds desc,
      a.baths desc
    limit 1
  ) a
),
priced as (
  select
    r.dwelling_key,
    r.beds,
    r.baths,
    case
      when r.dwelling_key='apartments_condos' and r.beds=0 and r.baths=1.0 then r.essential_refresh
      when r.is_anchor then r.essential_refresh
      else round((r.essential_refresh + ((r.beds-r.anchor_beds)*r.bedroom_increment) + (((r.baths-r.anchor_baths)/0.5)*r.half_bath_increment))/5.0)*5
    end::int as essential_refresh,
    case
      when r.dwelling_key='apartments_condos' and r.beds=0 and r.baths=1.0 then r.signature_initial_reset
      when r.is_anchor then r.signature_initial_reset
      else round((r.signature_initial_reset + ((r.beds-r.anchor_beds)*r.bedroom_increment) + (((r.baths-r.anchor_baths)/0.5)*r.half_bath_increment))/5.0)*5
    end::int as signature_initial_reset,
    case
      when r.dwelling_key='apartments_condos' and r.beds=0 and r.baths=1.0 then r.complete_deep
      when r.is_anchor then r.complete_deep
      else round((r.complete_deep + ((r.beds-r.anchor_beds)*r.bedroom_increment) + (((r.baths-r.anchor_baths)/0.5)*r.half_bath_increment))/5.0)*5
    end::int as complete_deep,
    case
      when r.dwelling_key='apartments_condos' and r.beds=0 and r.baths=1.0 then r.move_in_move_out
      when r.is_anchor then r.move_in_move_out
      else round((r.move_in_move_out + ((r.beds-r.anchor_beds)*r.bedroom_increment) + (((r.baths-r.anchor_baths)/0.5)*r.half_bath_increment))/5.0)*5
    end::int as move_in_move_out
  from resolved r
),
rows_by_dwelling as (
  select
    dwelling_key,
    jsonb_object_agg(
      case
        when baths = trunc(baths) then beds::text || 'bed_' || trunc(baths)::int::text || 'bath'
        else beds::text || 'bed_' || replace(baths::text,'.','_') || 'bath'
      end,
      jsonb_build_object(
        'essential_refresh', essential_refresh,
        'signature_initial_reset', signature_initial_reset,
        'complete_deep', complete_deep,
        'move_in_move_out', move_in_move_out
      )
      order by beds,baths
    ) as rows
  from priced
  group by dwelling_key
),
full_matrix as (
  select jsonb_object_agg(dwelling_key, rows) as matrix
  from rows_by_dwelling
),
next_config as (
  select
    p.*,
    jsonb_set(
      jsonb_set(
        p.configuration,
        '{dwelling_matrix}',
        fm.matrix,
        true
      ),
      '{authority,coverage_patch}',
      jsonb_build_object(
        'supersedes_version','AZ-2026-08-v1.1',
        'change_type','whole_home_standard_combination_coverage',
        'change_reason','Complete standard Arizona residential bed/bath coverage including partial-bath layouts',
        'source_document','HAVE US CLEAN ARIZONA RESIDENTIAL PRICING MATRIX',
        'source_drive_file_id','1txtaX9EMg12jAGovbkv4SUyGlZLSVvReq1u6wfxDsYw',
        'source_effective_period','August 2026',
        'pricing_basis','Existing Drive-published anchor prices preserved exactly; missing standard combinations derived from nearest anchor under owner-approved coverage increments',
        'coverage','Apartment/Condo studio through 4 bed; Townhouse 1-5 bed; Detached 1-6 bed; bathrooms in 0.5 increments within standard layout bounds',
        'apartment_bedroom_increment',25,
        'townhouse_bedroom_increment',30,
        'detached_bedroom_increment',35,
        'half_bath_increment',15,
        'rounding','nearest_5_usd'
      ),
      true
    ) as configuration_v12
  from prior p
  cross join full_matrix fm
)
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
  n.organization_id,
  n.business_unit_id,
  n.jurisdiction_id,
  n.configuration_type,
  'AZ-2026-08-v1.2',
  'published',
  timestamptz '2026-08-31 16:55:00-07',
  null,
  n.configuration_v12,
  n.approved_by,
  now()
from next_config n
where not exists (
  select 1
  from public.configuration_version existing
  where existing.organization_id=n.organization_id
    and existing.business_unit_id=n.business_unit_id
    and existing.jurisdiction_id=n.jurisdiction_id
    and existing.configuration_type=n.configuration_type
    and existing.version='AZ-2026-08-v1.2'
);
