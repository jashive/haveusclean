-- OS 1.0 Step 1: restore the Ontario activation catalog primitives.
--
-- This migration deliberately does not insert or verify an
-- ON_WSIB_EMPLOYER_COVERAGE evidence row. Employer coverage is satisfied only
-- by a current, human-verified hems_hr.organization_coverage record.

begin;

insert into hems_hr.requirement_definition (
  jurisdiction_code,
  legal_classification,
  role_scope,
  requirement_code,
  requirement_version,
  requirement_kind,
  source_authority,
  source_url,
  blocking_stage,
  effective_from,
  effective_to,
  status
)
values
  (
    'ON', 'employee', 'all', 'HUC_SAFETY_ORIENTATION', '2026.1',
    'training', 'Have Us Clean HEMS', 'https://haveusclean.ca',
    'activation', date '2026-01-01', null, 'active'
  ),
  (
    'ON', 'independent_contractor', 'all', 'HUC_SAFETY_ORIENTATION', '2026.1',
    'training', 'Have Us Clean HEMS', 'https://haveusclean.ca',
    'activation', date '2026-01-01', null, 'active'
  ),
  (
    'ON', 'employee', 'all', 'ON_WSIB_EMPLOYER_COVERAGE', '2026.1',
    'organization_coverage', 'WSIB Ontario',
    'https://www.wsib.ca/en/businesses/registration-and-coverage',
    'activation', date '2026-01-01', null, 'active'
  )
on conflict (
  jurisdiction_code,
  legal_classification,
  role_scope,
  requirement_code,
  requirement_version
)
do nothing;

insert into hems_hr.training_module (
  module_code,
  module_version,
  title,
  category,
  jurisdiction_scope,
  role_scope,
  minimum_score,
  assignment_due_days,
  renewal_policy,
  renewal_period_days,
  source_authority,
  source_url,
  delivery_mode,
  practical_observation_required,
  standard_definition,
  status,
  effective_from,
  effective_to
)
values (
  'HUC_SAFETY_ORIENTATION',
  '2026.1',
  'Have Us Clean Safety Orientation',
  'safety',
  'ON',
  'all',
  100,
  7,
  'calendar_or_change',
  365,
  'Have Us Clean HEMS',
  'https://haveusclean.ca',
  'blended',
  true,
  jsonb_build_object(
    'standard_version', '2026.1',
    'scope', 'Ontario field safety orientation',
    'completion_requires', jsonb_build_array(
      'instruction',
      'comprehension confirmation',
      'practical observation',
      'authorized verifier certification'
    ),
    'applicant_video_credit', false
  ),
  'active',
  date '2026-01-01',
  null
)
on conflict (module_code, module_version) do nothing;

insert into hems_hr.training_catalog_scope (
  training_module_id,
  scope_kind,
  organization_id,
  business_unit_id,
  trade_code,
  service_module_code,
  assignment_config,
  status
)
select
  module.id,
  'business_unit',
  unit.organization_id,
  unit.id,
  'cleaning',
  'huc_cleaning',
  jsonb_build_object('required_for_activation', true),
  'active'
from hems_hr.training_module module
join public.business_unit unit on unit.code = 'HUC-ON'
where module.module_code = 'HUC_SAFETY_ORIENTATION'
  and module.module_version = '2026.1'
on conflict do nothing;

insert into hems_hr.training_module_binding (
  training_module_id,
  requirement_definition_id,
  jurisdiction_code,
  legal_classification,
  role_scope,
  status
)
select
  module.id,
  definition.id,
  definition.jurisdiction_code,
  definition.legal_classification,
  definition.role_scope,
  'active'
from hems_hr.requirement_definition definition
join hems_hr.training_module module
  on module.module_code = definition.requirement_code
 and module.module_version = definition.requirement_version
where definition.jurisdiction_code = 'ON'
  and definition.requirement_code = 'HUC_SAFETY_ORIENTATION'
  and definition.requirement_version = '2026.1'
  and definition.status = 'active'
  and module.status = 'active'
on conflict (requirement_definition_id) do nothing;

-- Materialize only the two restored primitives for existing non-terminal
-- Ontario engagements. The existing BEFORE/AFTER triggers enforce catalog
-- scope and create the missing training assignment.
insert into hems_hr.engagement_requirement (
  organization_id,
  engagement_id,
  requirement_definition_id,
  requirement_code,
  requirement_version,
  requirement_kind
)
select
  engagement.organization_id,
  engagement.id,
  definition.id,
  definition.requirement_code,
  definition.requirement_version,
  definition.requirement_kind
from hems_hr.workforce_engagement engagement
join hems_hr.requirement_definition definition
  on definition.jurisdiction_code = engagement.home_jurisdiction
 and definition.legal_classification = engagement.legal_classification
 and definition.role_scope = 'all'
where engagement.home_jurisdiction = 'ON'
  and engagement.engagement_status not in ('inactive', 'terminated', 'offboarded')
  and definition.requirement_code in (
    'HUC_SAFETY_ORIENTATION',
    'ON_WSIB_EMPLOYER_COVERAGE'
  )
  and definition.requirement_version = '2026.1'
  and definition.status = 'active'
  and definition.effective_from <= current_date
  and (definition.effective_to is null or definition.effective_to >= current_date)
on conflict (engagement_id, requirement_definition_id) do nothing;

do $validation$
declare
  v_module_id uuid;
begin
  select id into v_module_id
  from hems_hr.training_module
  where module_code = 'HUC_SAFETY_ORIENTATION'
    and module_version = '2026.1'
    and jurisdiction_scope = 'ON'
    and status = 'active';

  if v_module_id is null then
    raise exception 'Ontario activation primitive validation failed: safety module missing';
  end if;

  if (
    select count(*)
    from hems_hr.requirement_definition
    where jurisdiction_code = 'ON'
      and requirement_code = 'HUC_SAFETY_ORIENTATION'
      and requirement_version = '2026.1'
      and requirement_kind = 'training'
      and legal_classification in ('employee', 'independent_contractor')
      and status = 'active'
  ) <> 2 then
    raise exception 'Ontario activation primitive validation failed: safety requirements incomplete';
  end if;

  if not exists (
    select 1
    from hems_hr.requirement_definition
    where jurisdiction_code = 'ON'
      and legal_classification = 'employee'
      and requirement_code = 'ON_WSIB_EMPLOYER_COVERAGE'
      and requirement_version = '2026.1'
      and requirement_kind = 'organization_coverage'
      and blocking_stage = 'activation'
      and status = 'active'
  ) then
    raise exception 'Ontario activation primitive validation failed: WSIB requirement missing';
  end if;

  if (
    select count(*)
    from hems_hr.training_module_binding binding
    join hems_hr.requirement_definition definition
      on definition.id = binding.requirement_definition_id
    where binding.training_module_id = v_module_id
      and binding.jurisdiction_code = 'ON'
      and binding.status = 'active'
      and definition.requirement_code = 'HUC_SAFETY_ORIENTATION'
      and definition.requirement_version = '2026.1'
      and definition.legal_classification in ('employee', 'independent_contractor')
  ) <> 2 then
    raise exception 'Ontario activation primitive validation failed: safety bindings incomplete';
  end if;

  if not exists (
    select 1
    from hems_hr.training_catalog_scope scope
    join public.business_unit unit on unit.id = scope.business_unit_id
    where scope.training_module_id = v_module_id
      and scope.scope_kind = 'business_unit'
      and scope.organization_id = unit.organization_id
      and unit.code = 'HUC-ON'
      and scope.trade_code = 'cleaning'
      and scope.service_module_code = 'huc_cleaning'
      and scope.status = 'active'
  ) then
    raise exception 'Ontario activation primitive validation failed: HUC-ON scope missing';
  end if;
end
$validation$;

commit;
