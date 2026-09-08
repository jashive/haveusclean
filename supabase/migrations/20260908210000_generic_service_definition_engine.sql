begin;

create table public.service_definition (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  service_key text not null,
  display_name text not null,
  service_family_key text not null,
  lifecycle_status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by_app_user_id uuid null,
  created_at timestamptz not null default now(),
  constraint uq_service_definition_key unique (organization_id,service_key),
  constraint ck_service_definition_key check (service_key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_service_definition_family check (service_family_key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_service_definition_status check (lifecycle_status in ('active','retired'))
);

create table public.service_definition_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  service_definition_id uuid not null references public.service_definition(id),
  configuration_version_id uuid not null unique references public.configuration_version(id),
  measurement_contract jsonb not null,
  pricing_contract jsonb not null,
  duration_contract jsonb not null,
  dispatch_contract jsonb not null,
  checklist_contract jsonb not null,
  qa_evidence_contract jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_app_user_id uuid null,
  created_at timestamptz not null default now(),
  constraint uq_service_definition_version unique (service_definition_id,configuration_version_id)
);

create index idx_service_definition_active
  on public.service_definition (organization_id,service_key)
  where lifecycle_status='active';
create index idx_service_definition_version_scope
  on public.service_definition_version (business_unit_id,jurisdiction_id,service_definition_id);

create or replace function public.huc_validate_service_definition_version()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  v_definition public.service_definition%rowtype;
  v_configuration public.configuration_version%rowtype;
  v_item jsonb;
  v_key text;
  v_seen text[]:=array[]::text[];
begin
  select * into v_definition from public.service_definition where id=new.service_definition_id;
  select * into v_configuration from public.configuration_version where id=new.configuration_version_id;
  if v_definition.id is null or v_configuration.id is null then raise exception 'Service definition lineage is incomplete'; end if;
  if v_definition.organization_id<>new.organization_id or v_configuration.organization_id<>new.organization_id then raise exception 'Service definition organization lineage mismatch'; end if;
  if v_configuration.business_unit_id is distinct from new.business_unit_id or v_configuration.jurisdiction_id is distinct from new.jurisdiction_id then raise exception 'Service definition territory lineage mismatch'; end if;
  if v_configuration.status not in ('draft','published','retired') then raise exception 'Unsupported configuration status %',v_configuration.status; end if;
  if coalesce(new.measurement_contract->>'primary_type','') not in ('unit_count','area_sqft_acre','linear_dimension','flat_walkthrough') then raise exception 'Unsupported primary measurement type'; end if;
  if jsonb_typeof(new.measurement_contract->'measurements')<>'array' or jsonb_array_length(new.measurement_contract->'measurements')=0 then raise exception 'Measurement contract requires at least one measurement'; end if;
  for v_item in select value from jsonb_array_elements(new.measurement_contract->'measurements') loop
    v_key:=v_item->>'key';
    if coalesce(v_key,'') !~ '^[a-z][a-z0-9_]*$' then raise exception 'Measurement key is invalid'; end if;
    if v_item->>'type' not in ('unit_count','area_sqft_acre','linear_dimension','flat_walkthrough') then raise exception 'Measurement type is invalid'; end if;
    if v_key=any(v_seen) then raise exception 'Duplicate measurement key %',v_key; end if;
    v_seen:=array_append(v_seen,v_key);
  end loop;
  if jsonb_typeof(new.checklist_contract->'sections')<>'array' or jsonb_array_length(new.checklist_contract->'sections')=0 then raise exception 'Checklist contract requires sections'; end if;
  if jsonb_typeof(new.qa_evidence_contract->'requirements')<>'array' or jsonb_array_length(new.qa_evidence_contract->'requirements')=0 then raise exception 'QA evidence contract requires requirements'; end if;
  for v_item in select value from jsonb_array_elements(new.qa_evidence_contract->'requirements') loop
    if coalesce((v_item->>'required_count')::integer,0)<1 then raise exception 'Evidence required_count must be positive'; end if;
    if v_item->>'evidence_type' not in ('photo_before','photo_after','photo_detail','note','signature','timestamp','other') then raise exception 'Evidence type is invalid'; end if;
    if coalesce(v_item->>'evidence_tag','') !~ '^[a-z][a-z0-9_]*$' then raise exception 'Evidence tag is invalid'; end if;
  end loop;
  return new;
end $$;

create trigger trg_service_definition_version_validate
before insert or update on public.service_definition_version
for each row execute function public.huc_validate_service_definition_version();

create or replace function public.huc_lock_published_service_definition_version()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_status text;
begin
  select status into v_status from public.configuration_version where id=old.configuration_version_id;
  if v_status='published' then raise exception 'Published service definition versions are immutable; publish a new configuration version'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger trg_service_definition_version_lock
before update or delete on public.service_definition_version
for each row execute function public.huc_lock_published_service_definition_version();

alter table public.service_definition enable row level security;
alter table public.service_definition_version enable row level security;

create policy pol_service_definition_member_select on public.service_definition
for select to authenticated using (public.is_org_member(organization_id));
create policy pol_service_definition_owner_all on public.service_definition
for all to authenticated
using (public.has_org_role(organization_id,array['owner_admin']::text[]))
with check (public.has_org_role(organization_id,array['owner_admin']::text[]));

create policy pol_service_definition_version_staff_select on public.service_definition_version
for select to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['owner_admin','office_ops','worker','qa']::text[]));
create policy pol_service_definition_version_owner_all on public.service_definition_version
for all to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['owner_admin']::text[]))
with check (public.has_bu_role(organization_id,business_unit_id,array['owner_admin']::text[]));

revoke all on public.service_definition,public.service_definition_version from public,anon;
grant select on public.service_definition,public.service_definition_version to authenticated;
grant insert,update,delete on public.service_definition,public.service_definition_version to authenticated;
grant all on public.service_definition,public.service_definition_version to service_role;
revoke all on function public.huc_validate_service_definition_version(),public.huc_lock_published_service_definition_version() from public,anon,authenticated;
grant execute on function public.huc_validate_service_definition_version(),public.huc_lock_published_service_definition_version() to service_role;

insert into public.service_definition (organization_id,service_key,display_name,service_family_key,metadata)
select distinct organization_id,'residential_cleaning','Residential Cleaning','field_service',jsonb_build_object('source','phase4_compatibility_seed')
from public.business_unit where code in ('HUC-ON','HUC-AZ')
on conflict (organization_id,service_key) do nothing;

with latest as (
  select distinct on (cv.business_unit_id) cv.*
  from public.configuration_version cv join public.business_unit bu on bu.id=cv.business_unit_id
  where bu.code in ('HUC-ON','HUC-AZ') and cv.configuration_type='residential_pricing' and cv.status='published'
    and cv.effective_from<=now() and (cv.effective_to is null or cv.effective_to>now())
  order by cv.business_unit_id,cv.effective_from desc,cv.created_at desc
)
insert into public.service_definition_version (
  organization_id,business_unit_id,jurisdiction_id,service_definition_id,configuration_version_id,
  measurement_contract,pricing_contract,duration_contract,dispatch_contract,checklist_contract,qa_evidence_contract,metadata
)
select l.organization_id,l.business_unit_id,l.jurisdiction_id,sd.id,l.id,
  '{"contract_version":1,"primary_type":"unit_count","measurements":[{"key":"bedrooms","type":"unit_count","label":"Bedrooms","required":true},{"key":"bathrooms","type":"unit_count","label":"Bathrooms","required":true},{"key":"service_area","type":"area_sqft_acre","label":"Service area","accepted_units":["sqft"],"required":false}]}'::jsonb,
  jsonb_build_object('mode','existing_pricing_configuration','configuration_version_id',l.id),
  '{"mode":"existing_pricing_outputs","rounding_minutes":15}'::jsonb,
  '{"minimum_crew_size":1,"maximum_crew_size":3,"required_capabilities":["residential_cleaning"],"worker_requirements":{"active_authorization":true,"approved_compensation":true}}'::jsonb,
  '{"version":1,"sections":[{"key":"arrival","label":"Arrival and scope","items":[{"key":"review_scope","label":"Review scope and access notes","required":true}]},{"key":"service","label":"Service execution","items":[{"key":"complete_service_scope","label":"Complete every configured service-area task","required":true},{"key":"final_quality_walkthrough","label":"Complete the final quality walkthrough","required":true}]},{"key":"evidence","label":"Completion evidence","items":[{"key":"upload_completion_evidence","label":"Upload all required completion evidence","required":true}]}]}'::jsonb,
  '{"version":1,"requirements":[{"requirement_key":"service_after","evidence_type":"photo_after","evidence_tag":"after_clean","label":"Completed service","required_count":1,"mandatory":true}]}'::jsonb,
  jsonb_build_object('source','phase4_residential_compatibility','configuration_status',l.status)
from latest l join public.service_definition sd on sd.organization_id=l.organization_id and sd.service_key='residential_cleaning'
on conflict (configuration_version_id) do nothing;

insert into public.required_evidence_policy (
  organization_id,business_unit_id,jurisdiction_id,configuration_version_id,service_family,
  service_task_key,requirement_key,evidence_type,required_count,is_mandatory,requires_external_reference,storage_rule_payload,metadata
)
select sdv.organization_id,sdv.business_unit_id,sdv.jurisdiction_id,sdv.configuration_version_id,'residential',
  'completion','service_after','photo_after',1,true,true,
  '{"accepted_mime_types":["image/jpeg","image/png","image/webp"],"evidence_tag":"after_clean"}'::jsonb,
  jsonb_build_object('source','phase4_service_definition','service_definition_version_id',sdv.id)
from public.service_definition_version sdv
on conflict (configuration_version_id,requirement_key) do nothing;

commit;
