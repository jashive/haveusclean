create table if not exists growth.serviceos_handoff_reservation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  handoff_candidate_id uuid not null references growth.handoff_candidate(id) on delete restrict,
  prospect_id uuid not null references growth.prospect(id) on delete restrict,
  contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete restrict,
  qualification_review_id uuid not null references growth.qualification_review(id) on delete restrict,
  planned_idempotency_scope text not null,
  planned_idempotency_key text not null,
  planned_service_request_external_id text not null,
  planned_opportunity_external_id text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  reservation_status text not null default 'reserved' check (reservation_status='reserved'),
  snapshot jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (handoff_candidate_id),
  unique (planned_idempotency_scope,planned_idempotency_key),
  unique (planned_service_request_external_id),
  unique (planned_opportunity_external_id)
);

create index if not exists serviceos_handoff_reservation_scope_idx on growth.serviceos_handoff_reservation(organization_id,business_unit_id,jurisdiction_id,created_at desc);
create index if not exists serviceos_handoff_reservation_prospect_idx on growth.serviceos_handoff_reservation(prospect_id);
create index if not exists serviceos_handoff_reservation_contact_idx on growth.serviceos_handoff_reservation(contact_candidate_id);
create index if not exists serviceos_handoff_reservation_review_idx on growth.serviceos_handoff_reservation(qualification_review_id);

alter table growth.serviceos_handoff_reservation enable row level security;
revoke all on growth.serviceos_handoff_reservation from public,anon,authenticated,service_role;
grant select on growth.serviceos_handoff_reservation to service_role;

create or replace function public.growth_g4_serviceos_handoff_reservation_immutable_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'growth_g4: ServiceOS handoff reservations are immutable';
end;
$$;

drop trigger if exists trg_growth_g4_serviceos_handoff_reservation_immutable on growth.serviceos_handoff_reservation;
create trigger trg_growth_g4_serviceos_handoff_reservation_immutable
before update or delete on growth.serviceos_handoff_reservation
for each row execute function public.growth_g4_serviceos_handoff_reservation_immutable_guard();

create or replace function public.growth_g4_reserve_serviceos_handoff_preflight(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_handoff_candidate_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_candidate growth.handoff_candidate%rowtype;
  v_prospect growth.prospect%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_review growth.qualification_review%rowtype;
  v_latest_review growth.qualification_review%rowtype;
  v_existing growth.serviceos_handoff_reservation%rowtype;
  v_blockers text[]:=array[]::text[];
  v_planned_scope text:='growth_g4_serviceos_handoff';
  v_planned_key text;
  v_sr_external text;
  v_opp_external text;
  v_snapshot jsonb;
  v_request_hash text;
  v_reservation_id uuid;
  v_gate_enabled boolean:=false;
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null or p_handoff_candidate_id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('required_scope_missing'),'policy_version','g4-serviceos-preflight-2026-08-25','serviceos_mutation_authorized',false);
  end if;

  select * into v_candidate from growth.handoff_candidate h where h.id=p_handoff_candidate_id;
  if v_candidate.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_candidate_not_found'),'policy_version','g4-serviceos-preflight-2026-08-25','serviceos_mutation_authorized',false);
  end if;

  if v_candidate.organization_id<>p_organization_id or v_candidate.business_unit_id<>p_business_unit_id or v_candidate.jurisdiction_id<>p_jurisdiction_id then
    v_blockers:=array_append(v_blockers,'handoff_candidate_scope_mismatch');
  end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then
    v_blockers:=array_append(v_blockers,'business_unit_scope_mismatch');
  end if;
  if v_candidate.status not in ('draft','ready') then v_blockers:=array_append(v_blockers,'handoff_candidate_not_current'); end if;
  if v_candidate.serviceos_customer_id is not null or v_candidate.serviceos_contact_id is not null or v_candidate.serviceos_location_id is not null or v_candidate.serviceos_service_request_id is not null or v_candidate.serviceos_opportunity_id is not null then
    v_blockers:=array_append(v_blockers,'serviceos_ids_already_present');
  end if;
  if coalesce((v_candidate.handoff_payload->>'g4_required')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'g4_marker_missing'); end if;
  if coalesce((v_candidate.handoff_payload->>'serviceos_handoff_authorized')::boolean,false) is true then v_blockers:=array_append(v_blockers,'g3_authorization_boundary_violated'); end if;
  if nullif(btrim(coalesce(v_candidate.idempotency_key,'')),'') is null then v_blockers:=array_append(v_blockers,'growth_idempotency_key_missing'); end if;

  select * into v_prospect from growth.prospect p where p.id=v_candidate.prospect_id;
  if v_prospect.id is null or v_prospect.organization_id<>p_organization_id or v_prospect.business_unit_id<>p_business_unit_id or v_prospect.jurisdiction_id<>p_jurisdiction_id then
    v_blockers:=array_append(v_blockers,'prospect_scope_mismatch');
  else
    if v_prospect.lifecycle_status<>'handoff_ready' then v_blockers:=array_append(v_blockers,'prospect_not_handoff_ready'); end if;
    if nullif(btrim(coalesce(v_prospect.source_lane,'')),'') is null then v_blockers:=array_append(v_blockers,'source_attribution_missing'); end if;
  end if;

  begin
    select (v_candidate.qualification_evidence->>'qualification_review_id')::uuid into strict v_review.id;
  exception when others then
    v_review.id:=null;
  end;
  if v_review.id is null then
    v_blockers:=array_append(v_blockers,'qualification_review_reference_missing');
  else
    select * into v_review from growth.qualification_review q where q.id=v_review.id;
    if v_review.id is null or v_review.organization_id<>p_organization_id or v_review.business_unit_id<>p_business_unit_id or v_review.jurisdiction_id<>p_jurisdiction_id or v_review.prospect_id<>v_candidate.prospect_id then
      v_blockers:=array_append(v_blockers,'qualification_review_scope_mismatch');
    else
      if v_review.decision<>'qualified' then v_blockers:=array_append(v_blockers,'current_human_qualification_required'); end if;
      if not (v_review.verified_service_need and v_review.supported_geography and v_review.verified_reachable_contact) then
        v_blockers:=array_append(v_blockers,'qualification_controls_incomplete');
      end if;
      if v_review.reviewer_app_user_id is null then v_blockers:=array_append(v_blockers,'human_reviewer_missing'); end if;
    end if;
  end if;

  select * into v_latest_review from growth.qualification_review q where q.prospect_id=v_candidate.prospect_id and q.organization_id=p_organization_id and q.business_unit_id=p_business_unit_id and q.jurisdiction_id=p_jurisdiction_id order by q.reviewed_at desc,q.created_at desc,q.id desc limit 1;
  if v_latest_review.id is null or v_review.id is null or v_latest_review.id<>v_review.id or v_latest_review.decision<>'qualified' then
    v_blockers:=array_append(v_blockers,'later_terminal_or_newer_review_exists');
  end if;

  if v_review.contact_candidate_id is not null then
    select * into v_contact from growth.prospect_contact_candidate c where c.id=v_review.contact_candidate_id;
  end if;
  if v_contact.id is null or v_contact.organization_id<>p_organization_id or v_contact.business_unit_id<>p_business_unit_id or v_contact.jurisdiction_id<>p_jurisdiction_id or v_contact.prospect_id<>v_candidate.prospect_id or v_contact.review_status<>'accepted' or v_contact.verification_status<>'verified' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then
    v_blockers:=array_append(v_blockers,'verified_accepted_contact_required');
  end if;

  if exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.prospect_id=v_candidate.prospect_id and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email')) then
    v_blockers:=array_append(v_blockers,'active_suppression');
  end if;
  if exists(select 1 from growth.reply_classification_evidence r where r.prospect_id=v_candidate.prospect_id and r.organization_id=p_organization_id and r.business_unit_id=p_business_unit_id and r.jurisdiction_id=p_jurisdiction_id and r.classification='opt_out' and r.created_at>coalesce(v_review.reviewed_at,'epoch'::timestamptz)) then
    v_blockers:=array_append(v_blockers,'later_opt_out_exists');
  end if;

  v_planned_key:='handoff_candidate:'||v_candidate.id::text;
  v_sr_external:='handoff_candidate:'||v_candidate.id::text||':service_request';
  v_opp_external:='handoff_candidate:'||v_candidate.id::text||':opportunity';

  if exists(select 1 from public.idempotency_key i where i.scope=v_planned_scope and i.key=v_planned_key) then v_blockers:=array_append(v_blockers,'canonical_idempotency_conflict'); end if;
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_sr_external and e.entity_type='service_request') then v_blockers:=array_append(v_blockers,'service_request_external_reference_conflict'); end if;
  if exists(select 1 from public.external_reference e where e.system_name='growth_layer_1_0' and e.external_id=v_opp_external and e.entity_type='opportunity') then v_blockers:=array_append(v_blockers,'opportunity_external_reference_conflict'); end if;

  select coalesce(g.enabled,false) into v_gate_enabled from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled';

  if cardinality(v_blockers)>0 then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',to_jsonb(v_blockers),'policy_version','g4-serviceos-preflight-2026-08-25','handoff_candidate_id',v_candidate.id,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled);
  end if;

  v_snapshot:=jsonb_build_object(
    'snapshot_version','g4-serviceos-handoff-reservation-2026-08-25',
    'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
    'handoff_candidate_id',v_candidate.id,'prospect_id',v_candidate.prospect_id,'contact_candidate_id',v_contact.id,'qualification_review_id',v_review.id,
    'source_lane',v_prospect.source_lane,'company_name',v_prospect.company_name,'contact_email',lower(btrim(v_contact.email)),
    'planned_idempotency_scope',v_planned_scope,'planned_idempotency_key',v_planned_key,'planned_service_request_external_id',v_sr_external,'planned_opportunity_external_id',v_opp_external,
    'g4_required',true,'serviceos_handoff_authorized',false,'canonical_mutation_performed',false
  );
  v_request_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');

  select * into v_existing from growth.serviceos_handoff_reservation r where r.handoff_candidate_id=v_candidate.id;
  if v_existing.id is not null then
    if v_existing.request_hash<>v_request_hash or v_existing.planned_idempotency_key<>v_planned_key or v_existing.planned_service_request_external_id<>v_sr_external or v_existing.planned_opportunity_external_id<>v_opp_external then
      return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_reservation_conflict'),'policy_version','g4-serviceos-preflight-2026-08-25','reservation_id',v_existing.id,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled);
    end if;
    return jsonb_build_object('status',case when v_gate_enabled then 'READY_FOR_GOVERNED_HANDOFF' else 'READY_EXCEPT_HANDOFF_GATE' end,'blocking_reasons','[]'::jsonb,'policy_version','g4-serviceos-preflight-2026-08-25','reservation_id',v_existing.id,'request_hash',v_existing.request_hash,'planned_idempotency_scope',v_existing.planned_idempotency_scope,'planned_idempotency_key',v_existing.planned_idempotency_key,'planned_service_request_external_id',v_existing.planned_service_request_external_id,'planned_opportunity_external_id',v_existing.planned_opportunity_external_id,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled,'idempotent_replay',true);
  end if;

  insert into growth.serviceos_handoff_reservation(organization_id,business_unit_id,jurisdiction_id,handoff_candidate_id,prospect_id,contact_candidate_id,qualification_review_id,planned_idempotency_scope,planned_idempotency_key,planned_service_request_external_id,planned_opportunity_external_id,request_hash,reservation_status,snapshot,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_candidate.id,v_candidate.prospect_id,v_contact.id,v_review.id,v_planned_scope,v_planned_key,v_sr_external,v_opp_external,v_request_hash,'reserved',v_snapshot,jsonb_build_object('non_mutating',true,'serviceos_mutation_authorized',false,'handoff_gate_state_at_reservation',v_gate_enabled))
  returning id into v_reservation_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,v_candidate.prospect_id,'g4_serviceos_handoff_preflight_reserved','growth_g4',jsonb_build_object('reservation_id',v_reservation_id,'handoff_candidate_id',v_candidate.id,'request_hash',v_request_hash,'handoff_gate_enabled',v_gate_enabled,'serviceos_mutation_authorized',false));

  return jsonb_build_object('status',case when v_gate_enabled then 'READY_FOR_GOVERNED_HANDOFF' else 'READY_EXCEPT_HANDOFF_GATE' end,'blocking_reasons','[]'::jsonb,'policy_version','g4-serviceos-preflight-2026-08-25','reservation_id',v_reservation_id,'request_hash',v_request_hash,'planned_idempotency_scope',v_planned_scope,'planned_idempotency_key',v_planned_key,'planned_service_request_external_id',v_sr_external,'planned_opportunity_external_id',v_opp_external,'serviceos_mutation_authorized',false,'handoff_gate_enabled',v_gate_enabled,'idempotent_replay',false);
end;
$$;

revoke execute on function public.growth_g4_serviceos_handoff_reservation_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g4_reserve_serviceos_handoff_preflight(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g4_reserve_serviceos_handoff_preflight(uuid,uuid,uuid,uuid) to service_role;
