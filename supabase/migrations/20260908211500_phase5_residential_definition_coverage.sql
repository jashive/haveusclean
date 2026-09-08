begin;

-- Accepted residential pricing snapshots remain authoritative even after a
-- newer configuration version is published. Materialize the compatibility
-- contract for every published residential configuration already referenced
-- by an operational handoff; never rewrite the accepted snapshot.
with referenced_configuration as (
  select distinct cv.*
  from public.job_handoff jh
  join public.pricing_snapshot ps on ps.id=jh.pricing_snapshot_id
  join public.configuration_version cv on cv.id=ps.configuration_version_id
  join public.business_unit bu on bu.id=jh.business_unit_id
  where bu.code in ('HUC-ON','HUC-AZ')
    and cv.configuration_type='residential_pricing'
    and cv.status='published'
), canonical_contract as (
  select distinct on (sdv.business_unit_id)
    sdv.business_unit_id,
    sdv.service_definition_id,
    sdv.measurement_contract,
    sdv.pricing_contract,
    sdv.duration_contract,
    sdv.dispatch_contract,
    sdv.checklist_contract,
    sdv.qa_evidence_contract
  from public.service_definition_version sdv
  join public.configuration_version cv on cv.id=sdv.configuration_version_id
  join public.service_definition sd on sd.id=sdv.service_definition_id
  where sd.service_key='residential_cleaning' and cv.status='published'
  order by sdv.business_unit_id,cv.effective_from desc,cv.created_at desc
)
insert into public.service_definition_version (
  organization_id,business_unit_id,jurisdiction_id,service_definition_id,configuration_version_id,
  measurement_contract,pricing_contract,duration_contract,dispatch_contract,checklist_contract,qa_evidence_contract,metadata
)
select rc.organization_id,rc.business_unit_id,rc.jurisdiction_id,cc.service_definition_id,rc.id,
  cc.measurement_contract,
  cc.pricing_contract || jsonb_build_object('configuration_version_id',rc.id),
  cc.duration_contract,cc.dispatch_contract,cc.checklist_contract,cc.qa_evidence_contract,
  jsonb_build_object(
    'source','phase5_residential_compatibility_coverage',
    'configuration_status',rc.status,
    'accepted_configuration_version',rc.version
  )
from referenced_configuration rc
join canonical_contract cc on cc.business_unit_id=rc.business_unit_id
on conflict (configuration_version_id) do nothing;

insert into public.required_evidence_policy (
  organization_id,business_unit_id,jurisdiction_id,configuration_version_id,service_family,
  service_task_key,requirement_key,evidence_type,required_count,is_mandatory,requires_external_reference,storage_rule_payload,metadata
)
select sdv.organization_id,sdv.business_unit_id,sdv.jurisdiction_id,sdv.configuration_version_id,'residential',
  'completion','service_after','photo_after',1,true,true,
  '{"accepted_mime_types":["image/jpeg","image/png","image/webp"],"evidence_tag":"after_clean"}'::jsonb,
  jsonb_build_object('source','phase5_residential_compatibility_coverage','service_definition_version_id',sdv.id)
from public.service_definition_version sdv
join public.service_definition sd on sd.id=sdv.service_definition_id
where sd.service_key='residential_cleaning'
on conflict (configuration_version_id,requirement_key) do nothing;

do $$
declare v_uncovered integer;
begin
  select count(*) into v_uncovered
  from (
    select jh.id
    from public.job_handoff jh
    join public.pricing_snapshot ps on ps.id=jh.pricing_snapshot_id
    join public.configuration_version cv on cv.id=ps.configuration_version_id
    join public.business_unit bu on bu.id=jh.business_unit_id
    left join public.service_definition_version sdv
      on sdv.configuration_version_id=cv.id and sdv.business_unit_id=jh.business_unit_id
    where bu.code in ('HUC-ON','HUC-AZ')
      and cv.configuration_type='residential_pricing'
      and cv.status='published'
      and sdv.id is null
  ) uncovered;
  if v_uncovered<>0 then
    raise exception 'Phase 5 residential compatibility coverage incomplete: % handoffs',v_uncovered;
  end if;
end $$;

commit;
