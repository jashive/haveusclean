create table if not exists growth.serviceos_handoff_authorization (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  reservation_id uuid not null references growth.serviceos_handoff_reservation(id) on delete restrict,
  plan_id uuid not null references growth.serviceos_handoff_plan(id) on delete restrict,
  handoff_candidate_id uuid not null references growth.handoff_candidate(id) on delete restrict,
  prospect_id uuid not null references growth.prospect(id) on delete restrict,
  object_plan_hash text not null check (object_plan_hash ~ '^[0-9a-f]{64}$'),
  reservation_request_hash text not null check (reservation_request_hash ~ '^[0-9a-f]{64}$'),
  approval_status text not null check (approval_status='approved'),
  approved_by_app_user_id uuid not null references public.app_user(id) on delete restrict,
  approved_at timestamptz not null default now(),
  valid_until timestamptz not null,
  approval_reference text not null,
  approval_reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id),
  unique (reservation_id),
  unique (handoff_candidate_id),
  unique (approval_reference)
);

create table if not exists growth.serviceos_handoff_authorization_revocation (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references growth.serviceos_handoff_authorization(id) on delete restrict,
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  revoked_by_app_user_id uuid not null references public.app_user(id) on delete restrict,
  revoked_at timestamptz not null default now(),
  revocation_reference text not null,
  revocation_reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (authorization_id),
  unique (revocation_reference)
);

create index if not exists serviceos_handoff_authorization_scope_idx on growth.serviceos_handoff_authorization(organization_id,business_unit_id,jurisdiction_id,approved_at desc);
create index if not exists serviceos_handoff_authorization_candidate_idx on growth.serviceos_handoff_authorization(handoff_candidate_id);
create index if not exists serviceos_handoff_authorization_prospect_idx on growth.serviceos_handoff_authorization(prospect_id);
create index if not exists serviceos_handoff_authorization_approver_idx on growth.serviceos_handoff_authorization(approved_by_app_user_id);
create index if not exists serviceos_handoff_authorization_revocation_scope_idx on growth.serviceos_handoff_authorization_revocation(organization_id,business_unit_id,jurisdiction_id,revoked_at desc);
create index if not exists serviceos_handoff_authorization_revoker_idx on growth.serviceos_handoff_authorization_revocation(revoked_by_app_user_id);

alter table growth.serviceos_handoff_authorization enable row level security;
alter table growth.serviceos_handoff_authorization_revocation enable row level security;
revoke all on growth.serviceos_handoff_authorization from public,anon,authenticated,service_role;
revoke all on growth.serviceos_handoff_authorization_revocation from public,anon,authenticated,service_role;
grant select on growth.serviceos_handoff_authorization to service_role;
grant select on growth.serviceos_handoff_authorization_revocation to service_role;

create or replace function public.growth_g4_handoff_authorization_immutable_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'growth_g4: ServiceOS handoff authorization records are immutable';
end;
$$;

drop trigger if exists trg_growth_g4_handoff_authorization_immutable on growth.serviceos_handoff_authorization;
create trigger trg_growth_g4_handoff_authorization_immutable before update or delete on growth.serviceos_handoff_authorization for each row execute function public.growth_g4_handoff_authorization_immutable_guard();
drop trigger if exists trg_growth_g4_handoff_authorization_revocation_immutable on growth.serviceos_handoff_authorization_revocation;
create trigger trg_growth_g4_handoff_authorization_revocation_immutable before update or delete on growth.serviceos_handoff_authorization_revocation for each row execute function public.growth_g4_handoff_authorization_immutable_guard();

create or replace function public.growth_g4_record_serviceos_handoff_authorization(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_plan_id uuid,
  p_object_plan_hash text,
  p_approved_by_app_user_id uuid,
  p_valid_until timestamptz,
  p_approval_reference text,
  p_approval_reason text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_plan growth.serviceos_handoff_plan%rowtype;
  v_res growth.serviceos_handoff_reservation%rowtype;
  v_existing growth.serviceos_handoff_authorization%rowtype;
  v_eval jsonb;
  v_id uuid;
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null or p_plan_id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('required_scope_missing'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;
  if p_approved_by_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_approved_by_app_user_id and u.status='active') then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('active_human_approver_required'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;
  if nullif(btrim(coalesce(p_approval_reference,'')),'') is null or nullif(btrim(coalesce(p_approval_reason,'')),'') is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('approval_reference_and_reason_required'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;
  if p_valid_until is null or p_valid_until<=now() or p_valid_until>now()+interval '24 hours' then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_expiry_must_be_future_and_within_24_hours'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;

  select * into v_plan from growth.serviceos_handoff_plan p where p.id=p_plan_id;
  if v_plan.id is null then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_plan_not_found'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;
  if v_plan.organization_id<>p_organization_id or v_plan.business_unit_id<>p_business_unit_id or v_plan.jurisdiction_id<>p_jurisdiction_id then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_plan_scope_mismatch'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;
  if p_object_plan_hash is null or p_object_plan_hash<>v_plan.object_plan_hash then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('object_plan_hash_mismatch'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;

  select * into v_res from growth.serviceos_handoff_reservation r where r.id=v_plan.reservation_id;
  if v_res.id is null or v_res.organization_id<>p_organization_id or v_res.business_unit_id<>p_business_unit_id or v_res.jurisdiction_id<>p_jurisdiction_id or v_res.handoff_candidate_id<>v_plan.handoff_candidate_id or v_res.prospect_id<>v_plan.prospect_id then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_plan_lineage_mismatch'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;

  v_eval:=public.growth_g4_build_serviceos_handoff_dry_run_plan(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_plan.reservation_id);
  if coalesce(v_eval->>'status','')<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' or coalesce(v_eval->>'plan_id','')<>v_plan.id::text or coalesce(v_eval->>'object_plan_hash','')<>v_plan.object_plan_hash then
    return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_eval->'blocking_reasons',jsonb_build_array('handoff_plan_no_longer_current')),'policy_version','g4-handoff-authorization-2026-08-26','plan_id',v_plan.id,'serviceos_mutation_authorized',false);
  end if;

  select * into v_existing from growth.serviceos_handoff_authorization a where a.plan_id=v_plan.id;
  if v_existing.id is not null then
    if v_existing.object_plan_hash<>v_plan.object_plan_hash or v_existing.approval_reference<>btrim(p_approval_reference) then
      return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_replay_conflict'),'policy_version','g4-handoff-authorization-2026-08-26','authorization_id',v_existing.id,'serviceos_mutation_authorized',false);
    end if;
    return jsonb_build_object('status','AUTHORIZED_EXCEPT_HANDOFF_GATE','authorization_id',v_existing.id,'plan_id',v_plan.id,'object_plan_hash',v_plan.object_plan_hash,'idempotent_replay',true,'valid_until',v_existing.valid_until,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
  end if;

  insert into growth.serviceos_handoff_authorization(organization_id,business_unit_id,jurisdiction_id,reservation_id,plan_id,handoff_candidate_id,prospect_id,object_plan_hash,reservation_request_hash,approval_status,approved_by_app_user_id,approved_at,valid_until,approval_reference,approval_reason,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_plan.reservation_id,v_plan.id,v_plan.handoff_candidate_id,v_plan.prospect_id,v_plan.object_plan_hash,v_res.request_hash,'approved',p_approved_by_app_user_id,now(),p_valid_until,btrim(p_approval_reference),btrim(p_approval_reason),coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;

  return jsonb_build_object('status','AUTHORIZED_EXCEPT_HANDOFF_GATE','authorization_id',v_id,'plan_id',v_plan.id,'object_plan_hash',v_plan.object_plan_hash,'idempotent_replay',false,'valid_until',p_valid_until,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
end;
$$;

create or replace function public.growth_g4_revoke_serviceos_handoff_authorization(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_authorization_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reference text,p_revocation_reason text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth growth.serviceos_handoff_authorization%rowtype; v_existing growth.serviceos_handoff_authorization_revocation%rowtype; v_id uuid;
begin
  select * into v_auth from growth.serviceos_handoff_authorization a where a.id=p_authorization_id;
  if v_auth.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_not_found'),'serviceos_mutation_authorized',false); end if;
  if v_auth.organization_id<>p_organization_id or v_auth.business_unit_id<>p_business_unit_id or v_auth.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_scope_mismatch'),'serviceos_mutation_authorized',false); end if;
  if p_revoked_by_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_revoked_by_app_user_id and u.status='active') then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('active_human_revoker_required'),'serviceos_mutation_authorized',false); end if;
  if nullif(btrim(coalesce(p_revocation_reference,'')),'') is null or nullif(btrim(coalesce(p_revocation_reason,'')),'') is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('revocation_reference_and_reason_required'),'serviceos_mutation_authorized',false); end if;
  select * into v_existing from growth.serviceos_handoff_authorization_revocation r where r.authorization_id=v_auth.id;
  if v_existing.id is not null then return jsonb_build_object('status','REVOKED','revocation_id',v_existing.id,'authorization_id',v_auth.id,'idempotent_replay',true,'serviceos_mutation_authorized',false); end if;
  insert into growth.serviceos_handoff_authorization_revocation(authorization_id,organization_id,business_unit_id,jurisdiction_id,revoked_by_app_user_id,revoked_at,revocation_reference,revocation_reason,metadata)
  values(v_auth.id,p_organization_id,p_business_unit_id,p_jurisdiction_id,p_revoked_by_app_user_id,now(),btrim(p_revocation_reference),btrim(p_revocation_reason),coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('status','REVOKED','revocation_id',v_id,'authorization_id',v_auth.id,'idempotent_replay',false,'serviceos_mutation_authorized',false);
end;
$$;

create or replace function public.growth_g4_evaluate_serviceos_handoff_authorization(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_authorization_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth growth.serviceos_handoff_authorization%rowtype; v_plan growth.serviceos_handoff_plan%rowtype; v_eval jsonb; v_gate boolean:=false; v_blockers text[]:=array[]::text[];
begin
  select * into v_auth from growth.serviceos_handoff_authorization a where a.id=p_authorization_id;
  if v_auth.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_not_found'),'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false); end if;
  if v_auth.organization_id<>p_organization_id or v_auth.business_unit_id<>p_business_unit_id or v_auth.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'authorization_scope_mismatch'); end if;
  if v_auth.approval_status<>'approved' then v_blockers:=array_append(v_blockers,'authorization_not_approved'); end if;
  if v_auth.valid_until<=now() then v_blockers:=array_append(v_blockers,'authorization_expired'); end if;
  if exists(select 1 from growth.serviceos_handoff_authorization_revocation r where r.authorization_id=v_auth.id) then v_blockers:=array_append(v_blockers,'authorization_revoked'); end if;
  select * into v_plan from growth.serviceos_handoff_plan p where p.id=v_auth.plan_id;
  if v_plan.id is null or v_plan.object_plan_hash<>v_auth.object_plan_hash or v_plan.reservation_id<>v_auth.reservation_id or v_plan.handoff_candidate_id<>v_auth.handoff_candidate_id or v_plan.prospect_id<>v_auth.prospect_id then v_blockers:=array_append(v_blockers,'authorization_plan_lineage_drift'); end if;
  if cardinality(v_blockers)>0 then return jsonb_build_object('status','BLOCKED','blocking_reasons',to_jsonb(v_blockers),'authorization_id',v_auth.id,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false); end if;
  v_eval:=public.growth_g4_build_serviceos_handoff_dry_run_plan(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_auth.reservation_id);
  if coalesce(v_eval->>'status','')<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' or coalesce(v_eval->>'plan_id','')<>v_auth.plan_id::text or coalesce(v_eval->>'object_plan_hash','')<>v_auth.object_plan_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_eval->'blocking_reasons',jsonb_build_array('authorized_plan_no_longer_current')),'authorization_id',v_auth.id,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false); end if;
  select coalesce(enabled,false) into v_gate from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled';
  if not coalesce(v_gate,false) then return jsonb_build_object('status','AUTHORIZED_EXCEPT_HANDOFF_GATE','authorization_id',v_auth.id,'plan_id',v_auth.plan_id,'object_plan_hash',v_auth.object_plan_hash,'valid_until',v_auth.valid_until,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false); end if;
  return jsonb_build_object('status','AUTHORIZED_FOR_EXECUTION_LEASE','authorization_id',v_auth.id,'plan_id',v_auth.plan_id,'object_plan_hash',v_auth.object_plan_hash,'valid_until',v_auth.valid_until,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false);
end;
$$;

revoke execute on function public.growth_g4_record_serviceos_handoff_authorization(uuid,uuid,uuid,uuid,text,uuid,timestamptz,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g4_revoke_serviceos_handoff_authorization(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g4_evaluate_serviceos_handoff_authorization(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g4_record_serviceos_handoff_authorization(uuid,uuid,uuid,uuid,text,uuid,timestamptz,text,text,jsonb) to service_role;
grant execute on function public.growth_g4_revoke_serviceos_handoff_authorization(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.growth_g4_evaluate_serviceos_handoff_authorization(uuid,uuid,uuid,uuid) to service_role;
