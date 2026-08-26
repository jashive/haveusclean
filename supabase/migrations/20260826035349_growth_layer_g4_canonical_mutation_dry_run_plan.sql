create table if not exists growth.serviceos_handoff_plan (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  reservation_id uuid not null references growth.serviceos_handoff_reservation(id) on delete restrict,
  handoff_candidate_id uuid not null references growth.handoff_candidate(id) on delete restrict,
  prospect_id uuid not null references growth.prospect(id) on delete restrict,
  contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete restrict,
  qualification_review_id uuid not null references growth.qualification_review(id) on delete restrict,
  identity_resolution text not null check (identity_resolution in ('reuse_existing_customer_identity','reuse_customer_create_contact','reuse_customer_create_location','reuse_customer_create_contact_location','create_new_identity')),
  plan_status text not null default 'planned' check (plan_status='planned'),
  object_plan_hash text not null check (object_plan_hash ~ '^[0-9a-f]{64}$'),
  object_plan jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (reservation_id),
  unique (handoff_candidate_id),
  unique (object_plan_hash)
);

create index if not exists serviceos_handoff_plan_scope_idx on growth.serviceos_handoff_plan(organization_id,business_unit_id,jurisdiction_id,created_at desc);
create index if not exists serviceos_handoff_plan_prospect_idx on growth.serviceos_handoff_plan(prospect_id);
create index if not exists serviceos_handoff_plan_contact_idx on growth.serviceos_handoff_plan(contact_candidate_id);
create index if not exists serviceos_handoff_plan_review_idx on growth.serviceos_handoff_plan(qualification_review_id);

alter table growth.serviceos_handoff_plan enable row level security;
revoke all on growth.serviceos_handoff_plan from public,anon,authenticated,service_role;
grant select on growth.serviceos_handoff_plan to service_role;

create or replace function public.growth_g4_serviceos_handoff_plan_immutable_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'growth_g4: ServiceOS handoff plans are immutable';
end;
$$;

drop trigger if exists trg_growth_g4_serviceos_handoff_plan_immutable on growth.serviceos_handoff_plan;
create trigger trg_growth_g4_serviceos_handoff_plan_immutable
before update or delete on growth.serviceos_handoff_plan
for each row execute function public.growth_g4_serviceos_handoff_plan_immutable_guard();

create or replace function public.growth_g4_build_serviceos_handoff_dry_run_plan(
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
  v_latest_review growth.qualification_review%rowtype;
  v_existing_plan growth.serviceos_handoff_plan%rowtype;
  v_customer_ids uuid[]; v_contact_ids uuid[]; v_location_ids uuid[];
  v_customer_id uuid; v_contact_id uuid; v_location_id uuid;
  v_customer_action text; v_contact_action text; v_location_action text; v_identity_resolution text;
  v_service_category text;
  v_marketing_source_ids uuid[]; v_marketing_source_id uuid;
  v_campaign_ids uuid[]; v_campaign_id uuid; v_campaign_code text; v_source_code text;
  v_warnings jsonb:='[]'::jsonb; v_blockers text[]:=array[]::text[];
  v_plan jsonb; v_plan_hash text; v_plan_id uuid; v_handoff_gate boolean:=false;
  v_customer_ref jsonb; v_contact_ref jsonb; v_location_ref jsonb;
  v_now timestamptz:=now();
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null or p_reservation_id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('required_scope_missing'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false);
  end if;

  select * into v_res from growth.serviceos_handoff_reservation r where r.id=p_reservation_id;
  if v_res.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_reservation_not_found'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false);
  end if;

  if v_res.organization_id<>p_organization_id or v_res.business_unit_id<>p_business_unit_id or v_res.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'reservation_scope_mismatch'); end if;
  if v_res.reservation_status<>'reserved' then v_blockers:=array_append(v_blockers,'reservation_not_current'); end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then v_blockers:=array_append(v_blockers,'business_unit_scope_mismatch'); end if;

  select * into v_candidate from growth.handoff_candidate h where h.id=v_res.handoff_candidate_id;
  select * into v_prospect from growth.prospect p where p.id=v_res.prospect_id;
  select * into v_contact from growth.prospect_contact_candidate c where c.id=v_res.contact_candidate_id;
  select * into v_review from growth.qualification_review q where q.id=v_res.qualification_review_id;

  if v_candidate.id is null or v_candidate.organization_id<>p_organization_id or v_candidate.business_unit_id<>p_business_unit_id or v_candidate.jurisdiction_id<>p_jurisdiction_id or v_candidate.prospect_id<>v_res.prospect_id then v_blockers:=array_append(v_blockers,'handoff_candidate_scope_mismatch'); end if;
  if v_candidate.id is not null and v_candidate.status not in ('draft','ready') then v_blockers:=array_append(v_blockers,'handoff_candidate_not_current'); end if;
  if v_candidate.id is not null and (v_candidate.serviceos_customer_id is not null or v_candidate.serviceos_contact_id is not null or v_candidate.serviceos_location_id is not null or v_candidate.serviceos_service_request_id is not null or v_candidate.serviceos_opportunity_id is not null) then v_blockers:=array_append(v_blockers,'serviceos_ids_already_present'); end if;
  if v_candidate.id is not null and coalesce((v_candidate.handoff_payload->>'g4_required')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'g4_marker_missing'); end if;
  if v_candidate.id is not null and coalesce((v_candidate.handoff_payload->>'serviceos_handoff_authorized')::boolean,false) is true then v_blockers:=array_append(v_blockers,'g3_authorization_boundary_violated'); end if;

  if v_prospect.id is null or v_prospect.organization_id<>p_organization_id or v_prospect.business_unit_id<>p_business_unit_id or v_prospect.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'prospect_scope_mismatch');
  elsif v_prospect.lifecycle_status<>'handoff_ready' then v_blockers:=array_append(v_blockers,'prospect_not_handoff_ready'); end if;

  if v_contact.id is null or v_contact.organization_id<>p_organization_id or v_contact.business_unit_id<>p_business_unit_id or v_contact.jurisdiction_id<>p_jurisdiction_id or v_contact.prospect_id<>v_res.prospect_id or v_contact.review_status<>'accepted' or v_contact.verification_status<>'verified' or (nullif(btrim(coalesce(v_contact.email,'')),'') is null and nullif(regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g'),'') is null) then v_blockers:=array_append(v_blockers,'verified_accepted_contact_required'); end if;

  if v_review.id is null or v_review.organization_id<>p_organization_id or v_review.business_unit_id<>p_business_unit_id or v_review.jurisdiction_id<>p_jurisdiction_id or v_review.prospect_id<>v_res.prospect_id or v_review.contact_candidate_id<>v_res.contact_candidate_id or v_review.decision<>'qualified' or not (v_review.verified_service_need and v_review.supported_geography and v_review.verified_reachable_contact) then v_blockers:=array_append(v_blockers,'current_human_qualification_required'); end if;
  select * into v_latest_review from growth.qualification_review q where q.prospect_id=v_res.prospect_id and q.organization_id=p_organization_id and q.business_unit_id=p_business_unit_id and q.jurisdiction_id=p_jurisdiction_id order by q.reviewed_at desc,q.created_at desc,q.id desc limit 1;
  if v_latest_review.id is null or v_review.id is null or v_latest_review.id<>v_review.id or v_latest_review.decision<>'qualified' then v_blockers:=array_append(v_blockers,'later_terminal_or_newer_review_exists'); end if;

  if exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.prospect_id=v_res.prospect_id and s.active=true and s.effective_at<=v_now and (s.expires_at is null or s.expires_at>v_now) and s.channel in ('all','email')) then v_blockers:=array_append(v_blockers,'active_suppression'); end if;
  if exists(select 1 from growth.reply_classification_evidence r where r.prospect_id=v_res.prospect_id and r.organization_id=p_organization_id and r.business_unit_id=p_business_unit_id and r.jurisdiction_id=p_jurisdiction_id and r.classification='opt_out' and r.created_at>coalesce(v_review.reviewed_at,'epoch'::timestamptz)) then v_blockers:=array_append(v_blockers,'later_opt_out_exists'); end if;

  if v_candidate.id is not null then v_service_category:=nullif(btrim(v_candidate.handoff_payload->>'service_category'),''); end if;
  if v_service_category is null then v_blockers:=array_append(v_blockers,'canonical_service_category_missing'); end if;
  if v_prospect.id is not null and (nullif(btrim(coalesce(v_prospect.company_name,'')),'') is null or nullif(btrim(coalesce(v_prospect.city,'')),'') is null or nullif(btrim(coalesce(v_prospect.country_code,'')),'') is null) then v_blockers:=array_append(v_blockers,'canonical_identity_minimum_missing'); end if;
  if v_prospect.id is not null and nullif(btrim(coalesce(v_prospect.address_line1,'')),'') is null then v_blockers:=array_append(v_blockers,'service_address_missing'); end if;

  if v_res.planned_idempotency_scope<>'growth_g4_serviceos_handoff' or v_res.planned_idempotency_key<>('handoff_candidate:'||v_res.handoff_candidate_id::text) or v_res.planned_service_request_external_id<>('handoff_candidate:'||v_res.handoff_candidate_id::text||':service_request') or v_res.planned_opportunity_external_id<>('handoff_candidate:'||v_res.handoff_candidate_id::text||':opportunity') then v_blockers:=array_append(v_blockers,'reservation_identity_drift'); end if;
  if exists(select 1 from public.idempotency_key i where i.scope=v_res.planned_idempotency_scope and i.key=v_res.planned_idempotency_key) then v_blockers:=array_append(v_blockers,'canonical_idempotency_conflict'); end if;
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_res.planned_service_request_external_id and e.entity_type='service_request') then v_blockers:=array_append(v_blockers,'service_request_external_reference_conflict'); end if;
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_res.planned_opportunity_external_id and e.entity_type='opportunity') then v_blockers:=array_append(v_blockers,'opportunity_external_reference_conflict'); end if;

  if cardinality(v_blockers)>0 then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',to_jsonb(v_blockers),'policy_version','g4-canonical-plan-2026-08-25','reservation_id',v_res.id,'serviceos_mutation_authorized',false);
  end if;

  select array_agg(distinct cu.id) into v_customer_ids
  from public.customer cu join public.service_location sl on sl.customer_id=cu.id
  where cu.organization_id=p_organization_id and (cu.business_unit_id is null or cu.business_unit_id=p_business_unit_id)
    and lower(regexp_replace(btrim(cu.display_name),'\s+',' ','g'))=lower(regexp_replace(btrim(v_prospect.company_name),'\s+',' ','g'))
    and lower(regexp_replace(btrim(coalesce(sl.address_line1,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(v_prospect.address_line1),'\s+',' ','g'))
    and lower(regexp_replace(btrim(coalesce(sl.city,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(v_prospect.city),'\s+',' ','g'))
    and (nullif(regexp_replace(upper(coalesce(v_prospect.postal_code,'')),'[^A-Z0-9]','','g'),'') is null or regexp_replace(upper(coalesce(sl.postal_code,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(v_prospect.postal_code),'[^A-Z0-9]','','g'));
  if coalesce(cardinality(v_customer_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_customers_match_name_address'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
  if coalesce(cardinality(v_customer_ids),0)=1 then v_customer_id:=v_customer_ids[1]; end if;

  if v_customer_id is null then
    select array_agg(distinct cu.id) into v_customer_ids
    from public.customer cu join public.contact c on c.customer_id=cu.id
    where cu.organization_id=p_organization_id and (cu.business_unit_id is null or cu.business_unit_id=p_business_unit_id)
      and ((nullif(btrim(coalesce(v_contact.email,'')),'') is not null and nullif(btrim(coalesce(c.email,'')),'') is not null and lower(btrim(c.email))=lower(btrim(v_contact.email))) or (nullif(regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g'),'') is not null and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') is not null and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_contact.phone,'[^0-9]','','g')));
    if coalesce(cardinality(v_customer_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_customers_match_contact'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
    if coalesce(cardinality(v_customer_ids),0)=1 then v_customer_id:=v_customer_ids[1]; end if;
  end if;

  if v_customer_id is not null then
    select array_agg(c.id order by c.is_primary desc,c.created_at asc) into v_contact_ids from public.contact c where c.customer_id=v_customer_id and ((nullif(btrim(coalesce(v_contact.email,'')),'') is not null and nullif(btrim(coalesce(c.email,'')),'') is not null and lower(btrim(c.email))=lower(btrim(v_contact.email))) or (nullif(regexp_replace(coalesce(v_contact.phone,''),'[^0-9]','','g'),'') is not null and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') is not null and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_contact.phone,'[^0-9]','','g')));
    if coalesce(cardinality(v_contact_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_contacts_match'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
    if coalesce(cardinality(v_contact_ids),0)=1 then v_contact_id:=v_contact_ids[1]; end if;
    select array_agg(sl.id order by sl.created_at asc) into v_location_ids from public.service_location sl where sl.customer_id=v_customer_id and lower(regexp_replace(btrim(coalesce(sl.address_line1,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(v_prospect.address_line1),'\s+',' ','g')) and lower(regexp_replace(btrim(coalesce(sl.city,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(v_prospect.city),'\s+',' ','g')) and (nullif(regexp_replace(upper(coalesce(v_prospect.postal_code,'')),'[^A-Z0-9]','','g'),'') is null or regexp_replace(upper(coalesce(sl.postal_code,'')),'[^A-Z0-9]','','g')=regexp_replace(upper(v_prospect.postal_code),'[^A-Z0-9]','','g'));
    if coalesce(cardinality(v_location_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_locations_match'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
    if coalesce(cardinality(v_location_ids),0)=1 then v_location_id:=v_location_ids[1]; end if;
  end if;

  if v_customer_id is null then v_customer_action:='create'; v_contact_action:='create'; v_location_action:='create'; v_identity_resolution:='create_new_identity';
  else
    v_customer_action:='reuse';
    if v_contact_id is null then v_contact_action:='create'; else v_contact_action:='reuse'; end if;
    if v_location_id is null then v_location_action:='create'; else v_location_action:='reuse'; end if;
    if v_contact_action='reuse' and v_location_action='reuse' then v_identity_resolution:='reuse_existing_customer_identity'; elsif v_contact_action='create' and v_location_action='reuse' then v_identity_resolution:='reuse_customer_create_contact'; elsif v_contact_action='reuse' and v_location_action='create' then v_identity_resolution:='reuse_customer_create_location'; else v_identity_resolution:='reuse_customer_create_contact_location'; end if;
  end if;

  v_customer_ref:=case when v_customer_id is null then jsonb_build_object('mode','planned_new','ref','customer') else jsonb_build_object('mode','existing','id',v_customer_id) end;
  v_contact_ref:=case when v_contact_id is null then jsonb_build_object('mode','planned_new','ref','contact','customer_ref',v_customer_ref) else jsonb_build_object('mode','existing','id',v_contact_id,'customer_id',v_customer_id) end;
  v_location_ref:=case when v_location_id is null then jsonb_build_object('mode','planned_new','ref','service_location','customer_ref',v_customer_ref) else jsonb_build_object('mode','existing','id',v_location_id,'customer_id',v_customer_id) end;

  v_source_code:=lower(regexp_replace(btrim(v_prospect.source_lane),'[^a-zA-Z0-9]+','_','g'));
  select array_agg(ms.id order by ms.created_at asc) into v_marketing_source_ids from public.marketing_source ms where ms.organization_id=p_organization_id and ms.status='active' and (lower(ms.code)=v_source_code or lower(coalesce(ms.metadata->>'growth_source_lane',''))=lower(v_prospect.source_lane));
  if coalesce(cardinality(v_marketing_source_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_marketing_sources_match'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
  if coalesce(cardinality(v_marketing_source_ids),0)=1 then v_marketing_source_id:=v_marketing_source_ids[1]; else v_warnings:=v_warnings||jsonb_build_array('canonical_marketing_source_unmapped_growth_source_preserved'); end if;

  v_campaign_code:=nullif(btrim(v_candidate.handoff_payload->>'campaign_code'),'');
  if v_campaign_code is not null then
    select array_agg(c.id order by c.created_at asc) into v_campaign_ids from public.campaign c where c.organization_id=p_organization_id and c.status='active' and lower(c.code)=lower(v_campaign_code) and (v_marketing_source_id is null or c.marketing_source_id is null or c.marketing_source_id=v_marketing_source_id) and (c.starts_at is null or c.starts_at<=v_now) and (c.ends_at is null or c.ends_at>v_now);
    if coalesce(cardinality(v_campaign_ids),0)>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('multiple_canonical_campaigns_match'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
    if coalesce(cardinality(v_campaign_ids),0)=0 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('canonical_campaign_unresolved'),'policy_version','g4-canonical-plan-2026-08-25','serviceos_mutation_authorized',false); end if;
    v_campaign_id:=v_campaign_ids[1];
  end if;

  v_plan:=jsonb_build_object(
    'plan_version','g4-canonical-plan-2026-08-25','scope',jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id),
    'reservation',jsonb_build_object('id',v_res.id,'request_hash',v_res.request_hash,'idempotency_scope',v_res.planned_idempotency_scope,'idempotency_key',v_res.planned_idempotency_key,'service_request_external_id',v_res.planned_service_request_external_id,'opportunity_external_id',v_res.planned_opportunity_external_id),
    'identity_resolution',v_identity_resolution,
    'customer',jsonb_build_object('action',v_customer_action,'ref',v_customer_ref,'payload',case when v_customer_action='create' then jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'customer_type','business','display_name',v_prospect.company_name,'legal_name',v_prospect.company_name,'status','lead','metadata',jsonb_build_object('source','growth_layer_1_0','growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id)) else null end),
    'contact',jsonb_build_object('action',v_contact_action,'ref',v_contact_ref,'payload',case when v_contact_action='create' then jsonb_build_object('contact_type','primary','first_name',v_contact.first_name,'last_name',v_contact.last_name,'email',v_contact.email,'phone',v_contact.phone,'is_primary',true,'metadata',jsonb_build_object('source','growth_layer_1_0','growth_contact_candidate_id',v_contact.id)) else null end),
    'service_location',jsonb_build_object('action',v_location_action,'ref',v_location_ref,'payload',case when v_location_action='create' then jsonb_build_object('jurisdiction_id',p_jurisdiction_id,'label',coalesce(nullif(btrim(v_prospect.facility_type),''),'Primary Service Location'),'address_line1',v_prospect.address_line1,'address_line2',v_prospect.address_line2,'city',v_prospect.city,'subdivision',v_prospect.subdivision_code,'postal_code',v_prospect.postal_code,'country_code',v_prospect.country_code,'metadata',jsonb_build_object('source','growth_layer_1_0','growth_prospect_id',v_prospect.id)) else null end),
    'service_request',jsonb_build_object('action','create','payload',jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'customer_ref',v_customer_ref,'contact_ref',v_contact_ref,'service_location_ref',v_location_ref,'marketing_source_id',v_marketing_source_id,'campaign_id',v_campaign_id,'service_category',v_service_category,'lifecycle_status','qualified','intake_channel','growth_g4_handoff','title',v_prospect.company_name||' - '||v_service_category,'description',coalesce(nullif(btrim(v_prospect.service_need_summary),''),nullif(btrim(v_prospect.raw_notes),'')),'requirements',coalesce(v_candidate.handoff_payload->'requirements','{}'::jsonb),'metadata',jsonb_build_object('source','growth_layer_1_0','growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id,'growth_source_lane',v_prospect.source_lane,'growth_source_url',v_prospect.source_url,'growth_source_record_id',v_prospect.source_record_id))),
    'opportunity',jsonb_build_object('action','create','payload',jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'service_request_ref',jsonb_build_object('mode','planned_new','ref','service_request'),'customer_ref',v_customer_ref,'contact_ref',v_contact_ref,'service_location_ref',v_location_ref,'marketing_source_id',v_marketing_source_id,'campaign_id',v_campaign_id,'stage','qualified','title',v_prospect.company_name||' - '||v_service_category,'summary',coalesce(nullif(btrim(v_prospect.service_need_summary),''),nullif(btrim(v_prospect.raw_notes),'')),'metadata',jsonb_build_object('source','growth_layer_1_0','growth_prospect_id',v_prospect.id,'growth_handoff_candidate_id',v_candidate.id))),
    'external_references',jsonb_build_array(jsonb_build_object('system_name','growth_layer_1_0','entity_type','service_request','external_id',v_res.planned_service_request_external_id),jsonb_build_object('system_name','growth_layer_1_0','entity_type','opportunity','external_id',v_res.planned_opportunity_external_id)),
    'canonical_mutation_performed',false,'serviceos_mutation_authorized',false
  );
  v_plan_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_plan::text,'UTF8'),'sha256'),'hex');

  select * into v_existing_plan from growth.serviceos_handoff_plan p where p.reservation_id=v_res.id;
  if v_existing_plan.id is not null then
    if v_existing_plan.object_plan_hash<>v_plan_hash or v_existing_plan.object_plan<>v_plan then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('canonical_plan_drift'),'policy_version','g4-canonical-plan-2026-08-25','plan_id',v_existing_plan.id,'serviceos_mutation_authorized',false); end if;
    select coalesce(g.enabled,false) into v_handoff_gate from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled';
    return jsonb_build_object('status','READY_EXCEPT_HANDOFF_AUTHORIZATION','blocking_reasons','[]'::jsonb,'warnings',v_existing_plan.warnings,'policy_version','g4-canonical-plan-2026-08-25','plan_id',v_existing_plan.id,'object_plan_hash',v_existing_plan.object_plan_hash,'identity_resolution',v_existing_plan.identity_resolution,'object_plan',v_existing_plan.object_plan,'handoff_gate_enabled',v_handoff_gate,'serviceos_mutation_authorized',false,'idempotent_replay',true);
  end if;

  insert into growth.serviceos_handoff_plan(organization_id,business_unit_id,jurisdiction_id,reservation_id,handoff_candidate_id,prospect_id,contact_candidate_id,qualification_review_id,identity_resolution,plan_status,object_plan_hash,object_plan,warnings,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_res.id,v_candidate.id,v_prospect.id,v_contact.id,v_review.id,v_identity_resolution,'planned',v_plan_hash,v_plan,v_warnings,jsonb_build_object('dry_run_only',true,'canonical_mutation_performed',false,'serviceos_mutation_authorized',false)) returning id into v_plan_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,v_prospect.id,'g4_serviceos_handoff_dry_run_planned','growth_g4',jsonb_build_object('plan_id',v_plan_id,'reservation_id',v_res.id,'object_plan_hash',v_plan_hash,'identity_resolution',v_identity_resolution,'warnings',v_warnings,'canonical_mutation_performed',false,'serviceos_mutation_authorized',false));

  select coalesce(g.enabled,false) into v_handoff_gate from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled';
  return jsonb_build_object('status','READY_EXCEPT_HANDOFF_AUTHORIZATION','blocking_reasons','[]'::jsonb,'warnings',v_warnings,'policy_version','g4-canonical-plan-2026-08-25','plan_id',v_plan_id,'object_plan_hash',v_plan_hash,'identity_resolution',v_identity_resolution,'object_plan',v_plan,'handoff_gate_enabled',v_handoff_gate,'serviceos_mutation_authorized',false,'idempotent_replay',false);
end;
$$;

revoke execute on function public.growth_g4_serviceos_handoff_plan_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g4_build_serviceos_handoff_dry_run_plan(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g4_build_serviceos_handoff_dry_run_plan(uuid,uuid,uuid,uuid) to service_role;
