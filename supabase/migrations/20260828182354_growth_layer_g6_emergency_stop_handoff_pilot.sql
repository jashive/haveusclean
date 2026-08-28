-- Growth Layer G6 — safe emergency stop + separately governed capped G4 handoff pilot.
-- No feature gate is enabled by this migration. Emergency-stop functions only
-- disable/suspend/revoke. Handoff execution now requires a current G6 handoff
-- pilot policy in addition to the existing G4 authorization/lease controls.

create table growth.handoff_pilot_policy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  handoff_cap integer not null check (handoff_cap between 1 and 5),
  evidence_snapshot jsonb not null,
  approved_by_app_user_id uuid not null references public.app_user(id),
  approval_reference text not null check (btrim(approval_reference)<>''),
  approval_reason text not null check (btrim(approval_reason)<>''),
  approved_at timestamptz not null default now(),
  valid_until timestamptz not null,
  policy_version text not null default 'g6-handoff-pilot-v1' check (policy_version='g6-handoff-pilot-v1'),
  idempotency_key text not null check (btrim(idempotency_key)<>''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint handoff_pilot_policy_valid_window check (valid_until>approved_at and valid_until<=approved_at+interval '24 hours'),
  constraint handoff_pilot_policy_idem_uq unique(organization_id,business_unit_id,jurisdiction_id,idempotency_key)
);

create table growth.handoff_pilot_policy_revocation (
  id uuid primary key default gen_random_uuid(),
  handoff_pilot_policy_id uuid not null unique references growth.handoff_pilot_policy(id),
  revoked_by_app_user_id uuid not null references public.app_user(id),
  revocation_reason text not null check (btrim(revocation_reason)<>''),
  revoked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table growth.handoff_pilot_reservation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  handoff_pilot_policy_id uuid not null references growth.handoff_pilot_policy(id),
  serviceos_handoff_authorization_id uuid not null unique references growth.serviceos_handoff_authorization(id),
  handoff_candidate_id uuid not null references growth.handoff_candidate(id),
  reservation_status text not null default 'reserved_for_lease' check (reservation_status='reserved_for_lease'),
  created_at timestamptz not null default now()
);

alter table growth.handoff_pilot_policy enable row level security;
alter table growth.handoff_pilot_policy_revocation enable row level security;
alter table growth.handoff_pilot_reservation enable row level security;

create index handoff_pilot_policy_scope_idx on growth.handoff_pilot_policy(organization_id,business_unit_id,jurisdiction_id,valid_until desc);
create index handoff_pilot_policy_approver_idx on growth.handoff_pilot_policy(approved_by_app_user_id);
create index handoff_pilot_revoker_idx on growth.handoff_pilot_policy_revocation(revoked_by_app_user_id);
create index handoff_pilot_reservation_policy_idx on growth.handoff_pilot_reservation(handoff_pilot_policy_id,created_at);
create index handoff_pilot_reservation_bu_idx on growth.handoff_pilot_reservation(business_unit_id);
create index handoff_pilot_reservation_jur_idx on growth.handoff_pilot_reservation(jurisdiction_id);
create index handoff_pilot_reservation_candidate_idx on growth.handoff_pilot_reservation(handoff_candidate_id);

create trigger handoff_pilot_policy_append_only before update or delete on growth.handoff_pilot_policy for each row execute function growth.g6_append_only_guard();
create trigger handoff_pilot_policy_revocation_append_only before update or delete on growth.handoff_pilot_policy_revocation for each row execute function growth.g6_append_only_guard();
create trigger handoff_pilot_reservation_append_only before update or delete on growth.handoff_pilot_reservation for each row execute function growth.g6_append_only_guard();

create or replace function public.growth_g6_handoff_pilot_evidence_snapshot(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_required text[]:=array['serviceos_handoff_pilot_ready','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval']; v_type text; v_eid uuid; v_evidence jsonb:='{}'::jsonb; v_blockers text[]:=array[]::text[]; v_hash text;
begin
  if not exists(select 1 from public.business_unit bu where bu.id=p_business_unit_id and bu.organization_id=p_organization_id and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active') then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('invalid_or_inactive_scope'),'policy_version','g6-handoff-pilot-evidence-v1'); end if;
  foreach v_type in array v_required loop
    select e.id into v_eid from growth.commissioning_evidence e
     where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id
       and e.evidence_type=v_type and e.environment_name='production' and e.valid_from<=now() and e.valid_until>now()
       and not exists(select 1 from growth.commissioning_evidence_revocation r where r.evidence_id=e.id)
     order by e.created_at desc limit 1;
    if v_eid is null then v_blockers:=array_append(v_blockers,'missing_or_inactive_evidence:'||v_type); else v_evidence:=v_evidence||jsonb_build_object(v_type,v_eid); end if;
    v_eid:=null;
  end loop;
  v_hash:=encode(extensions.digest(convert_to(v_evidence::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'HANDOFF_EVIDENCE_READY' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'evidence_snapshot',v_evidence,'evidence_snapshot_hash',v_hash,'policy_version','g6-handoff-pilot-evidence-v1');
end $$;

create or replace function public.growth_g6_record_handoff_pilot_policy(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_handoff_cap integer,p_approved_by_app_user_id uuid,p_approval_reference text,p_approval_reason text,p_valid_until timestamptz,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_ev jsonb; v_hash text; v_existing growth.handoff_pilot_policy%rowtype; v_id uuid;
begin
  if p_handoff_cap<1 or p_handoff_cap>5 then raise exception 'handoff cap must be between 1 and 5' using errcode='22023'; end if;
  if not exists(select 1 from public.app_user u where u.id=p_approved_by_app_user_id and u.status='active') then raise exception 'active human approver required' using errcode='22023'; end if;
  if exists(select 1 from growth.feature_gate g where g.gate_code='growth_serviceos_handoff_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_gate_must_be_off_for_policy_approval'),'policy_version','g6-handoff-pilot-v1'); end if;
  if exists(select 1 from growth.handoff_pilot_policy p where p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id and p.valid_until>now() and not exists(select 1 from growth.handoff_pilot_policy_revocation r where r.handoff_pilot_policy_id=p.id)) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('current_handoff_pilot_policy_already_exists'),'policy_version','g6-handoff-pilot-v1'); end if;
  v_ev:=public.growth_g6_handoff_pilot_evidence_snapshot(p_organization_id,p_business_unit_id,p_jurisdiction_id);
  if v_ev->>'status'<>'HANDOFF_EVIDENCE_READY' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_ev->'blocking_reasons','policy_version','g6-handoff-pilot-v1'); end if;
  if p_valid_until<=now() or p_valid_until>now()+interval '24 hours' then raise exception 'invalid handoff pilot validity window' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,'handoff_cap',p_handoff_cap,'evidence_snapshot',v_ev->'evidence_snapshot','approved_by',p_approved_by_app_user_id,'approval_reference',btrim(p_approval_reference),'approval_reason',btrim(p_approval_reason),'valid_until',p_valid_until,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.handoff_pilot_policy p where p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id and p.idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>v_hash then raise exception 'idempotency collision' using errcode='23505'; end if; return jsonb_build_object('status','HANDOFF_PILOT_POLICY_APPROVED','handoff_pilot_policy_id',v_existing.id,'idempotent_replay',true,'gate_mutation_performed',false); end if;
  insert into growth.handoff_pilot_policy(organization_id,business_unit_id,jurisdiction_id,handoff_cap,evidence_snapshot,approved_by_app_user_id,approval_reference,approval_reason,valid_until,idempotency_key,request_hash,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_handoff_cap,v_ev->'evidence_snapshot',p_approved_by_app_user_id,btrim(p_approval_reference),btrim(p_approval_reason),p_valid_until,p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('status','HANDOFF_PILOT_POLICY_APPROVED','handoff_pilot_policy_id',v_id,'idempotent_replay',false,'gate_mutation_performed',false,'handoff_cap',p_handoff_cap);
end $$;

create or replace function public.growth_g6_evaluate_handoff_pilot_policy(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_count int; v_policy growth.handoff_pilot_policy%rowtype; v_ev jsonb; v_blockers text[]:=array[]::text[]; v_reserved int:=0;
begin
  select count(*) into v_count from growth.handoff_pilot_policy p where p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id and p.valid_until>now() and not exists(select 1 from growth.handoff_pilot_policy_revocation r where r.handoff_pilot_policy_id=p.id);
  if v_count=0 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_pilot_policy_missing'),'policy_version','g6-handoff-pilot-v1'); end if;
  if v_count>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_pilot_policy_ambiguous'),'policy_version','g6-handoff-pilot-v1'); end if;
  select * into v_policy from growth.handoff_pilot_policy p where p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id and p.valid_until>now() and not exists(select 1 from growth.handoff_pilot_policy_revocation r where r.handoff_pilot_policy_id=p.id) order by p.created_at desc,p.id limit 1;
  v_ev:=public.growth_g6_handoff_pilot_evidence_snapshot(p_organization_id,p_business_unit_id,p_jurisdiction_id);
  if v_ev->>'status'<>'HANDOFF_EVIDENCE_READY' then v_blockers:=v_blockers||array(select jsonb_array_elements_text(v_ev->'blocking_reasons')); end if;
  if coalesce(v_ev->'evidence_snapshot','{}'::jsonb)<>v_policy.evidence_snapshot then v_blockers:=array_append(v_blockers,'handoff_pilot_evidence_drift'); end if;
  select count(*) into v_reserved from growth.handoff_pilot_reservation r where r.handoff_pilot_policy_id=v_policy.id;
  return jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'HANDOFF_PILOT_AUTHORIZED' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'handoff_pilot_policy_id',v_policy.id,'handoff_cap',v_policy.handoff_cap,'reserved_handoffs',v_reserved,'remaining_handoffs',greatest(v_policy.handoff_cap-v_reserved,0),'valid_until',v_policy.valid_until,'policy_version','g6-handoff-pilot-v1');
end $$;

create or replace function public.growth_g6_reserve_handoff_pilot_slot(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_serviceos_handoff_authorization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_eval jsonb; v_policy growth.handoff_pilot_policy%rowtype; v_auth growth.serviceos_handoff_authorization%rowtype; v_existing growth.handoff_pilot_reservation%rowtype; v_reserved int; v_id uuid;
begin
  v_eval:=public.growth_g6_evaluate_handoff_pilot_policy(p_organization_id,p_business_unit_id,p_jurisdiction_id);
  if v_eval->>'status'<>'HANDOFF_PILOT_AUTHORIZED' then return v_eval; end if;
  select * into v_policy from growth.handoff_pilot_policy where id=(v_eval->>'handoff_pilot_policy_id')::uuid for update;
  select * into v_auth from growth.serviceos_handoff_authorization where id=p_serviceos_handoff_authorization_id;
  if v_auth.id is null or v_auth.organization_id<>p_organization_id or v_auth.business_unit_id<>p_business_unit_id or v_auth.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g4_authorization_scope_mismatch'),'policy_version','g6-handoff-pilot-v1'); end if;
  select * into v_existing from growth.handoff_pilot_reservation where serviceos_handoff_authorization_id=v_auth.id;
  if found then
    if v_existing.handoff_pilot_policy_id=v_policy.id then return jsonb_build_object('status','HANDOFF_SLOT_RESERVED','handoff_pilot_reservation_id',v_existing.id,'handoff_pilot_policy_id',v_policy.id,'idempotent_replay',true); end if;
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g4_authorization_already_bound_to_other_handoff_policy'),'policy_version','g6-handoff-pilot-v1');
  end if;
  select count(*) into v_reserved from growth.handoff_pilot_reservation where handoff_pilot_policy_id=v_policy.id;
  if v_reserved>=v_policy.handoff_cap then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('handoff_pilot_cap_reached'),'policy_version','g6-handoff-pilot-v1'); end if;
  insert into growth.handoff_pilot_reservation(organization_id,business_unit_id,jurisdiction_id,handoff_pilot_policy_id,serviceos_handoff_authorization_id,handoff_candidate_id)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_policy.id,v_auth.id,v_auth.handoff_candidate_id) returning id into v_id;
  return jsonb_build_object('status','HANDOFF_SLOT_RESERVED','handoff_pilot_reservation_id',v_id,'handoff_pilot_policy_id',v_policy.id,'idempotent_replay',false,'reserved_after',v_reserved+1,'handoff_cap',v_policy.handoff_cap);
end $$;

alter table growth.serviceos_handoff_execution_lease add column g6_handoff_pilot_policy_id uuid references growth.handoff_pilot_policy(id);
alter table growth.serviceos_handoff_execution_lease add column g6_handoff_pilot_reservation_id uuid references growth.handoff_pilot_reservation(id);
create index serviceos_handoff_lease_g6_policy_idx on growth.serviceos_handoff_execution_lease(g6_handoff_pilot_policy_id);
create index serviceos_handoff_lease_g6_reservation_idx on growth.serviceos_handoff_execution_lease(g6_handoff_pilot_reservation_id);

create or replace function public.growth_g4_evaluate_serviceos_handoff_authorization(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_authorization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_auth growth.serviceos_handoff_authorization%rowtype; v_plan growth.serviceos_handoff_plan%rowtype; v_eval jsonb; v_gate boolean:=false; v_blockers text[]:=array[]::text[]; v_g6 jsonb; v_lease growth.serviceos_handoff_execution_lease%rowtype;
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
  v_g6:=public.growth_g6_evaluate_handoff_pilot_policy(p_organization_id,p_business_unit_id,p_jurisdiction_id);
  if v_g6->>'status'<>'HANDOFF_PILOT_AUTHORIZED' then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_g6->'blocking_reasons',jsonb_build_array('g6_handoff_pilot_not_authorized')),'authorization_id',v_auth.id,'policy_version','g4-handoff-authorization-2026-08-26','g6_policy_version','g6-handoff-pilot-v1','serviceos_mutation_authorized',false); end if;
  select * into v_lease from growth.serviceos_handoff_execution_lease l where l.authorization_id=v_auth.id;
  if v_lease.id is not null then
    if v_lease.g6_handoff_pilot_policy_id is null or v_lease.g6_handoff_pilot_reservation_id is null or v_lease.g6_handoff_pilot_policy_id<>(v_g6->>'handoff_pilot_policy_id')::uuid or not exists(select 1 from growth.handoff_pilot_reservation r where r.id=v_lease.g6_handoff_pilot_reservation_id and r.handoff_pilot_policy_id=v_lease.g6_handoff_pilot_policy_id and r.serviceos_handoff_authorization_id=v_auth.id) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g6_handoff_lease_binding_invalid'),'authorization_id',v_auth.id,'policy_version','g4-handoff-authorization-2026-08-26','serviceos_mutation_authorized',false); end if;
  end if;
  return jsonb_build_object('status','AUTHORIZED_FOR_EXECUTION_LEASE','authorization_id',v_auth.id,'plan_id',v_auth.plan_id,'object_plan_hash',v_auth.object_plan_hash,'valid_until',least(v_auth.valid_until,(v_g6->>'valid_until')::timestamptz),'policy_version','g4-handoff-authorization-2026-08-26','g6_handoff_pilot_policy_id',v_g6->>'handoff_pilot_policy_id','serviceos_mutation_authorized',false);
end $$;

create or replace function public.growth_g4_issue_serviceos_handoff_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_authorization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_eval jsonb; v_auth growth.serviceos_handoff_authorization%rowtype; v_existing growth.serviceos_handoff_execution_lease%rowtype; v_raw_token text; v_token_hash text; v_id uuid; v_exp timestamptz; v_slot jsonb; v_policy_id uuid; v_slot_id uuid;
begin
  v_eval:=public.growth_g4_evaluate_serviceos_handoff_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_authorization_id);
  if coalesce(v_eval->>'status','')<>'AUTHORIZED_FOR_EXECUTION_LEASE' then return v_eval; end if;
  select * into v_auth from growth.serviceos_handoff_authorization a where a.id=p_authorization_id;
  select * into v_existing from growth.serviceos_handoff_execution_lease l where l.authorization_id=p_authorization_id;
  if v_existing.id is not null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_lease_already_exists'),'lease_id',v_existing.id,'policy_version','g4-handoff-execution-lease-2026-08-26','serviceos_mutation_authorized',false); end if;
  v_slot:=public.growth_g6_reserve_handoff_pilot_slot(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_authorization_id);
  if v_slot->>'status'<>'HANDOFF_SLOT_RESERVED' then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_slot->'blocking_reasons',jsonb_build_array('g6_handoff_slot_reservation_failed')),'policy_version','g4-handoff-execution-lease-2026-08-26','g6_policy_version','g6-handoff-pilot-v1','serviceos_mutation_authorized',false); end if;
  v_policy_id:=(v_slot->>'handoff_pilot_policy_id')::uuid; v_slot_id:=(v_slot->>'handoff_pilot_reservation_id')::uuid;
  v_exp:=least(now()+interval '10 minutes',v_auth.valid_until,(select valid_until from growth.handoff_pilot_policy where id=v_policy_id));
  if v_exp<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_expired'),'policy_version','g4-handoff-execution-lease-2026-08-26','serviceos_mutation_authorized',false); end if;
  v_raw_token:=pg_catalog.encode(extensions.gen_random_bytes(32),'hex'); v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token,'UTF8'),'sha256'),'hex');
  insert into growth.serviceos_handoff_execution_lease(organization_id,business_unit_id,jurisdiction_id,authorization_id,plan_id,reservation_id,handoff_candidate_id,object_plan_hash,lease_token_hash,lease_status,issued_at,expires_at,metadata,g6_handoff_pilot_policy_id,g6_handoff_pilot_reservation_id)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_auth.id,v_auth.plan_id,v_auth.reservation_id,v_auth.handoff_candidate_id,v_auth.object_plan_hash,v_token_hash,'issued',now(),v_exp,jsonb_build_object('single_use',true,'policy_version','g4-handoff-execution-lease-2026-08-26','g6_handoff_pilot_required',true),v_policy_id,v_slot_id) returning id into v_id;
  return jsonb_build_object('status','LEASE_ISSUED','lease_id',v_id,'authorization_id',v_auth.id,'plan_id',v_auth.plan_id,'object_plan_hash',v_auth.object_plan_hash,'expires_at',v_exp,'execution_token',v_raw_token,'policy_version','g4-handoff-execution-lease-2026-08-26','g6_handoff_pilot_policy_id',v_policy_id,'g6_handoff_pilot_reservation_id',v_slot_id,'serviceos_mutation_authorized',false);
end $$;

create or replace function public.growth_g6_revoke_handoff_pilot_policy(p_handoff_pilot_policy_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_p growth.handoff_pilot_policy%rowtype; v_r growth.handoff_pilot_policy_revocation%rowtype; v_l record;
begin
  select * into v_p from growth.handoff_pilot_policy where id=p_handoff_pilot_policy_id; if not found then raise exception 'handoff pilot policy not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user u where u.id=p_revoked_by_app_user_id and u.status='active') then raise exception 'active human revoker required' using errcode='22023'; end if;
  if btrim(coalesce(p_revocation_reason,''))='' then raise exception 'revocation reason required' using errcode='22023'; end if;
  select * into v_r from growth.handoff_pilot_policy_revocation where handoff_pilot_policy_id=v_p.id;
  if not found then insert into growth.handoff_pilot_policy_revocation(handoff_pilot_policy_id,revoked_by_app_user_id,revocation_reason) values(v_p.id,p_revoked_by_app_user_id,btrim(p_revocation_reason)) returning * into v_r; end if;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_serviceos_handoff_enabled' and enabled=true;
  for v_l in select l.id,l.organization_id,l.business_unit_id,l.jurisdiction_id from growth.serviceos_handoff_execution_lease l where l.g6_handoff_pilot_policy_id=v_p.id and l.lease_status='issued' loop
    perform public.growth_g4_revoke_serviceos_handoff_execution_lease(v_l.organization_id,v_l.business_unit_id,v_l.jurisdiction_id,v_l.id,'G6 handoff pilot policy revoked: '||btrim(p_revocation_reason));
  end loop;
  return jsonb_build_object('status','HANDOFF_PILOT_REVOKED','revocation_id',v_r.id,'handoff_gate_forced_off',true,'policy_version','g6-handoff-pilot-v1');
end $$;

create or replace function public.growth_g6_emergency_stop_outreach_pilot(p_staged_activation_authorization_id uuid,p_actor_app_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_a growth.staged_activation_authorization%rowtype; v_l record; v_binding uuid; v_allow uuid; v_activation uuid;
begin
  select * into v_a from growth.staged_activation_authorization where id=p_staged_activation_authorization_id;
  if not found then raise exception 'staged activation authorization not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user u where u.id=p_actor_app_user_id and u.status='active') then raise exception 'active human actor required' using errcode='22023'; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception 'emergency stop reason required' using errcode='22023'; end if;
  if not exists(select 1 from growth.staged_activation_authorization_revocation r where r.authorization_id=v_a.id) then insert into growth.staged_activation_authorization_revocation(authorization_id,revoked_by_app_user_id,revocation_reason) values(v_a.id,p_actor_app_user_id,'EMERGENCY STOP: '||btrim(p_reason)); end if;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled') and enabled=true;
  for v_l in select id from growth.provider_execution_lease where g6_staged_activation_authorization_id=v_a.id and lease_status='issued' loop perform public.growth_g2_revoke_provider_execution_lease(v_l.id,p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end loop;
  select id into v_binding from growth.provider_runtime_binding where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and binding_status='approved_metadata_only' order by created_at desc limit 1;
  if v_binding is not null then perform public.growth_g2_set_provider_runtime_binding_status(v_binding,'suspended',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  select id into v_allow from growth.provider_adapter_allowlist where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and adapter_version=v_a.adapter_version and allowlist_status='allowed' order by created_at desc limit 1;
  if v_allow is not null then perform public.growth_g2_set_provider_adapter_allowlist_status(v_allow,'suspended',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  select id into v_activation from growth.provider_activation_approval where organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id and jurisdiction_id=v_a.jurisdiction_id and provider_code=v_a.provider_code and environment_name=v_a.environment_name and adapter_key=v_a.adapter_key and adapter_version=v_a.adapter_version and approval_status='approved' order by created_at desc limit 1;
  if v_activation is not null then perform public.growth_g2_set_provider_activation_approval_status(v_activation,'revoked',p_actor_app_user_id,'G6 emergency stop: '||btrim(p_reason)); end if;
  insert into growth.audit_event(organization_id,business_unit_id,actor_app_user_id,event_type,source_system,correlation_id,payload) values(v_a.organization_id,v_a.business_unit_id,p_actor_app_user_id,'g6_outreach_pilot_emergency_stopped','growth_g6',v_a.id,jsonb_build_object('reason',btrim(p_reason),'provider_code',v_a.provider_code,'adapter_key',v_a.adapter_key,'adapter_version',v_a.adapter_version,'gates_forced_off',jsonb_build_array('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled')));
  return jsonb_build_object('status','EMERGENCY_STOPPED','authorization_id',v_a.id,'outreach_gate_enabled',false,'provider_execution_gate_enabled',false,'auto_followup_gate_enabled',false,'policy_version','g6-emergency-stop-v1');
end $$;

revoke all on growth.handoff_pilot_policy,growth.handoff_pilot_policy_revocation,growth.handoff_pilot_reservation from anon,authenticated;
grant select on growth.handoff_pilot_policy,growth.handoff_pilot_policy_revocation,growth.handoff_pilot_reservation to service_role;
revoke all on function public.growth_g6_handoff_pilot_evidence_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.growth_g6_record_handoff_pilot_policy(uuid,uuid,uuid,integer,uuid,text,text,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.growth_g6_evaluate_handoff_pilot_policy(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.growth_g6_reserve_handoff_pilot_slot(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.growth_g6_revoke_handoff_pilot_policy(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.growth_g6_emergency_stop_outreach_pilot(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g6_handoff_pilot_evidence_snapshot(uuid,uuid,uuid) to service_role;
grant execute on function public.growth_g6_record_handoff_pilot_policy(uuid,uuid,uuid,integer,uuid,text,text,timestamptz,text,jsonb) to service_role;
grant execute on function public.growth_g6_evaluate_handoff_pilot_policy(uuid,uuid,uuid) to service_role;
grant execute on function public.growth_g6_reserve_handoff_pilot_slot(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.growth_g6_revoke_handoff_pilot_policy(uuid,uuid,text) to service_role;
grant execute on function public.growth_g6_emergency_stop_outreach_pilot(uuid,uuid,text) to service_role;
