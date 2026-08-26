create or replace function public.growth_g4_create_serviceos_handoff_plan(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_reservation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_res growth.serviceos_handoff_reservation%rowtype;
  v_candidate growth.handoff_candidate%rowtype;
  v_prospect growth.prospect%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_review growth.qualification_review%rowtype;
  v_preflight jsonb;
  v_blockers text[]:=array[]::text[];
  v_source_count int:=0;
  v_source_id uuid;
  v_campaign_code text;
  v_campaign_count int:=0;
  v_campaign_id uuid;
  v_same_bu_customer_count int:=0;
  v_other_bu_customer_count int:=0;
  v_customer_id uuid;
  v_contact_count int:=0;
  v_contact_id uuid;
  v_location_count int:=0;
  v_location_id uuid;
  v_customer_action text;
  v_contact_action text;
  v_location_action text;
  v_identity_resolution text;
  v_customer_external text;
  v_contact_external text;
  v_location_external text;
  v_plan jsonb;
  v_hash text;
  v_existing growth.serviceos_handoff_plan%rowtype;
  v_plan_id uuid;
  v_gate_enabled boolean:=false;
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null or p_reservation_id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('required_scope_missing'),'policy_version','g4-serviceos-plan-2026-08-25','serviceos_mutation_authorized',false);
  end if;
  select * into v_res from growth.serviceos_handoff_reservation r where r.id=p_reservation_id;
  if v_res.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_reservation_not_found'),'policy_version','g4-serviceos-plan-2026-08-25','serviceos_mutation_authorized',false);
  end if;
  if v_res.organization_id<>p_organization_id or v_res.business_unit_id<>p_business_unit_id or v_res.jurisdiction_id<>p_jurisdiction_id then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_reservation_scope_mismatch'),'policy_version','g4-serviceos-plan-2026-08-25','serviceos_mutation_authorized',false);
  end if;
  v_preflight:=public.growth_g4_reserve_serviceos_handoff_preflight(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_res.handoff_candidate_id);
  if coalesce(v_preflight->>'status','BLOCKED')='BLOCKED' then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_preflight->'blocking_reasons','["authoritative_preflight_blocked"]'::jsonb),'policy_version','g4-serviceos-plan-2026-08-25','reservation_id',v_res.id,'serviceos_mutation_authorized',false);
  end if;
  if (v_preflight->>'reservation_id')::uuid<>v_res.id then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_reservation_identity_drift'),'policy_version','g4-serviceos-plan-2026-08-25','reservation_id',v_res.id,'serviceos_mutation_authorized',false);
  end if;
  select * into v_candidate from growth.handoff_candidate h where h.id=v_res.handoff_candidate_id;
  select * into v_prospect from growth.prospect p where p.id=v_res.prospect_id;
  select * into v_contact from growth.prospect_contact_candidate c where c.id=v_res.contact_candidate_id;
  select * into v_review from growth.qualification_review q where q.id=v_res.qualification_review_id;
  if v_candidate.id is null or v_prospect.id is null or v_contact.id is null or v_review.id is null then
    v_blockers:=array_append(v_blockers,'reservation_dependency_missing');
  end if;
  select count(*)::int,min(ms.id::text)::uuid into v_source_count,v_source_id
  from public.marketing_source ms
  where ms.organization_id=p_organization_id and ms.status='active'
    and lower(coalesce(ms.metadata->>'growth_source_lane',''))=lower(v_prospect.source_lane);
  if v_source_count=0 then v_blockers:=array_append(v_blockers,'canonical_marketing_source_missing');
  elsif v_source_count>1 then v_blockers:=array_append(v_blockers,'canonical_marketing_source_ambiguous'); end if;
  v_campaign_code:=nullif(btrim(coalesce(v_candidate.handoff_payload->>'campaign_code','')),'');
  if v_campaign_code is not null and v_source_count=1 then
    select count(*)::int,min(c.id::text)::uuid into v_campaign_count,v_campaign_id
    from public.campaign c
    where c.organization_id=p_organization_id and c.marketing_source_id=v_source_id and c.status='active' and lower(c.code)=lower(v_campaign_code);
    if v_campaign_count=0 then v_blockers:=array_append(v_blockers,'canonical_campaign_missing');
    elsif v_campaign_count>1 then v_blockers:=array_append(v_blockers,'canonical_campaign_ambiguous'); end if;
  end if;
  select count(distinct cu.id)::int,min(cu.id::text)::uuid into v_same_bu_customer_count,v_customer_id
  from public.contact c join public.customer cu on cu.id=c.customer_id
  where cu.organization_id=p_organization_id and cu.business_unit_id=p_business_unit_id
    and lower(btrim(coalesce(c.email,'')))=lower(btrim(v_contact.email));
  select count(distinct cu.id)::int into v_other_bu_customer_count
  from public.contact c join public.customer cu on cu.id=c.customer_id
  where cu.organization_id=p_organization_id and cu.business_unit_id is distinct from p_business_unit_id
    and lower(btrim(coalesce(c.email,'')))=lower(btrim(v_contact.email));
  if v_other_bu_customer_count>0 then v_blockers:=array_append(v_blockers,'canonical_customer_cross_business_unit_identity'); end if;
  if v_same_bu_customer_count>1 then v_blockers:=array_append(v_blockers,'canonical_customer_identity_ambiguous'); end if;
  if v_same_bu_customer_count=1 and v_other_bu_customer_count=0 then
    v_customer_action:='reuse';
    select count(*)::int,min(c.id::text)::uuid into v_contact_count,v_contact_id
    from public.contact c
    where c.customer_id=v_customer_id and lower(btrim(coalesce(c.email,'')))=lower(btrim(v_contact.email));
    if v_contact_count<>1 then v_blockers:=array_append(v_blockers,'canonical_contact_identity_ambiguous'); else v_contact_action:='reuse'; end if;
  elsif v_same_bu_customer_count=0 and v_other_bu_customer_count=0 then
    v_customer_action:='create'; v_contact_action:='create'; v_customer_id:=null; v_contact_id:=null;
  end if;
  if nullif(btrim(coalesce(v_prospect.address_line1,'')),'') is null then
    v_location_action:='omit'; v_location_id:=null;
  elsif v_customer_action='reuse' then
    select count(*)::int,min(sl.id::text)::uuid into v_location_count,v_location_id
    from public.service_location sl
    where sl.customer_id=v_customer_id and sl.jurisdiction_id=p_jurisdiction_id
      and lower(btrim(coalesce(sl.address_line1,'')))=lower(btrim(v_prospect.address_line1))
      and lower(btrim(coalesce(sl.city,'')))=lower(btrim(v_prospect.city))
      and lower(btrim(coalesce(sl.postal_code,'')))=lower(btrim(coalesce(v_prospect.postal_code,'')))
      and upper(btrim(coalesce(sl.country_code,'')))=upper(btrim(v_prospect.country_code));
    if v_location_count>1 then v_blockers:=array_append(v_blockers,'canonical_service_location_ambiguous');
    elsif v_location_count=1 then v_location_action:='reuse';
    else v_location_action:='create'; v_location_id:=null; end if;
  else
    v_location_action:='create'; v_location_id:=null;
  end if;
  if v_customer_action='create' then v_identity_resolution:='create_new_identity';
  elsif v_contact_action='reuse' and v_location_action='create' then v_identity_resolution:='reuse_customer_create_location';
  else v_identity_resolution:='reuse_existing_customer_identity'; end if;
  v_customer_external:='handoff_candidate:'||v_candidate.id::text||':customer';
  v_contact_external:='handoff_candidate:'||v_candidate.id::text||':contact';
  v_location_external:='handoff_candidate:'||v_candidate.id::text||':service_location';
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_customer_external and e.entity_type='customer') then v_blockers:=array_append(v_blockers,'customer_external_reference_conflict'); end if;
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_contact_external and e.entity_type='contact') then v_blockers:=array_append(v_blockers,'contact_external_reference_conflict'); end if;
  if v_location_action<>'omit' and exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_location_external and e.entity_type='service_location') then v_blockers:=array_append(v_blockers,'service_location_external_reference_conflict'); end if;
  select coalesce(g.enabled,false) into v_gate_enabled from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled';
  if cardinality(v_blockers)>0 then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',to_jsonb(v_blockers),'policy_version','g4-serviceos-plan-2026-08-25','reservation_id',v_res.id,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled);
  end if;
  v_plan:=jsonb_build_object(
    'plan_version','g4-serviceos-object-plan-2026-08-25',
    'scope',jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id),
    'reservation_id',v_res.id,'handoff_candidate_id',v_candidate.id,'prospect_id',v_prospect.id,'contact_candidate_id',v_contact.id,'qualification_review_id',v_review.id,
    'attribution',jsonb_build_object('source_lane',v_prospect.source_lane,'marketing_source_id',v_source_id,'campaign_id',v_campaign_id,'campaign_code',v_campaign_code),
    'identity_resolution',v_identity_resolution,
    'customer',jsonb_build_object('action',v_customer_action,'existing_id',v_customer_id,'external_id',v_customer_external,'create',case when v_customer_action='create' then jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'customer_type','business','display_name',v_prospect.company_name,'status','lead','metadata',jsonb_build_object('growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id)) else null end),
    'contact',jsonb_build_object('action',v_contact_action,'existing_id',v_contact_id,'external_id',v_contact_external,'create',case when v_contact_action='create' then jsonb_build_object('contact_type','primary','first_name',v_contact.first_name,'last_name',v_contact.last_name,'email',lower(btrim(v_contact.email)),'phone',v_contact.phone,'is_primary',true,'metadata',jsonb_build_object('growth_contact_candidate_id',v_contact.id,'buyer_title',v_contact.buyer_title)) else null end),
    'service_location',jsonb_build_object('action',v_location_action,'existing_id',v_location_id,'external_id',case when v_location_action='omit' then null else v_location_external end,'create',case when v_location_action='create' then jsonb_build_object('jurisdiction_id',p_jurisdiction_id,'label',v_prospect.company_name,'address_line1',v_prospect.address_line1,'address_line2',v_prospect.address_line2,'city',v_prospect.city,'subdivision',v_prospect.subdivision_code,'postal_code',v_prospect.postal_code,'country_code',v_prospect.country_code,'metadata',jsonb_build_object('growth_prospect_id',v_prospect.id)) else null end),
    'service_request',jsonb_build_object('action','create','external_id',v_res.planned_service_request_external_id,'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'marketing_source_id',v_source_id,'campaign_id',v_campaign_id,'service_category','cleaning','lifecycle_status','qualified','intake_channel','growth_g4','title',v_prospect.company_name||' cleaning request','description',v_prospect.service_need_summary,'requirements',jsonb_build_object('segment',v_prospect.segment,'facility_type',v_prospect.facility_type,'verified_service_need',v_review.verified_service_need,'supported_geography',v_review.supported_geography,'verified_reachable_contact',v_review.verified_reachable_contact),'metadata',jsonb_build_object('growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id,'growth_reservation_id',v_res.id)),
    'opportunity',jsonb_build_object('action','create','external_id',v_res.planned_opportunity_external_id,'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'marketing_source_id',v_source_id,'campaign_id',v_campaign_id,'stage','qualified','title',v_prospect.company_name||' cleaning opportunity','summary',v_prospect.service_need_summary,'metadata',jsonb_build_object('growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id,'growth_reservation_id',v_res.id)),
    'canonical_idempotency',jsonb_build_object('scope',v_res.planned_idempotency_scope,'key',v_res.planned_idempotency_key),
    'serviceos_mutation_authorized',false
  );
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_plan::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.serviceos_handoff_plan p where p.reservation_id=v_res.id;
  if v_existing.id is not null then
    if v_existing.object_plan_hash<>v_hash or v_existing.object_plan<>v_plan then
      return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('serviceos_object_plan_drift'),'policy_version','g4-serviceos-plan-2026-08-25','plan_id',v_existing.id,'reservation_id',v_res.id,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled);
    end if;
    return jsonb_build_object('status','READY_EXCEPT_HANDOFF_AUTHORIZATION','blocking_reasons','[]'::jsonb,'policy_version','g4-serviceos-plan-2026-08-25','plan_id',v_existing.id,'reservation_id',v_res.id,'object_plan_hash',v_existing.object_plan_hash,'object_plan',v_existing.object_plan,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled,'idempotent_replay',true);
  end if;
  insert into growth.serviceos_handoff_plan(organization_id,business_unit_id,jurisdiction_id,reservation_id,handoff_candidate_id,prospect_id,contact_candidate_id,qualification_review_id,identity_resolution,plan_status,object_plan_hash,object_plan,warnings,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_res.id,v_candidate.id,v_prospect.id,v_contact.id,v_review.id,v_identity_resolution,'planned',v_hash,v_plan,'[]'::jsonb,jsonb_build_object('dry_run_only',true,'serviceos_mutation_authorized',false,'handoff_gate_state_at_plan',v_gate_enabled)) returning id into v_plan_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,v_prospect.id,'g4_serviceos_handoff_plan_created','growth_g4',jsonb_build_object('plan_id',v_plan_id,'reservation_id',v_res.id,'object_plan_hash',v_hash,'serviceos_mutation_authorized',false));
  return jsonb_build_object('status','READY_EXCEPT_HANDOFF_AUTHORIZATION','blocking_reasons','[]'::jsonb,'policy_version','g4-serviceos-plan-2026-08-25','plan_id',v_plan_id,'reservation_id',v_res.id,'object_plan_hash',v_hash,'object_plan',v_plan,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled,'idempotent_replay',false);
end;
$$;
revoke execute on function public.growth_g4_create_serviceos_handoff_plan(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g4_create_serviceos_handoff_plan(uuid,uuid,uuid,uuid) to service_role;
