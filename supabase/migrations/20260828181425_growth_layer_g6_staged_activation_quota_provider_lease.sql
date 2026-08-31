-- Growth Layer G6 — staged activation authorization, server-side pilot quota,
-- and production provider-lease hardening.
-- This migration does not enable any feature gate. It makes future production
-- provider execution fail closed unless a current G6 staged authorization and
-- quota reservation are present in addition to the existing G2 controls.

create table growth.staged_activation_authorization (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  environment_name text not null check (environment_name in ('acceptance','production')),
  pilot_policy_id uuid not null references growth.pilot_policy(id),
  pilot_policy_request_hash text not null check (pilot_policy_request_hash ~ '^[0-9a-f]{64}$'),
  provider_code text not null,
  adapter_key text not null,
  adapter_version text not null,
  sender_email text not null,
  evidence_snapshot jsonb not null,
  runtime_prerequisite_fingerprint text not null check (runtime_prerequisite_fingerprint ~ '^[0-9a-f]{64}$'),
  approved_by_app_user_id uuid not null references public.app_user(id),
  approval_reference text not null check (btrim(approval_reference) <> ''),
  approval_reason text not null check (btrim(approval_reason) <> ''),
  approved_at timestamptz not null default now(),
  valid_until timestamptz not null,
  policy_version text not null default 'g6-staged-activation-v1' check (policy_version='g6-staged-activation-v1'),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint staged_activation_authorization_valid_window check (valid_until > approved_at and valid_until <= approved_at + interval '24 hours'),
  constraint staged_activation_authorization_idem_uq unique (organization_id,business_unit_id,jurisdiction_id,environment_name,idempotency_key)
);

create table growth.staged_activation_authorization_revocation (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null unique references growth.staged_activation_authorization(id),
  revoked_by_app_user_id uuid not null references public.app_user(id),
  revocation_reason text not null check (btrim(revocation_reason) <> ''),
  revoked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table growth.pilot_send_reservation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  staged_activation_authorization_id uuid not null references growth.staged_activation_authorization(id),
  pilot_policy_id uuid not null references growth.pilot_policy(id),
  outreach_submission_reservation_id uuid not null unique references growth.outreach_submission_reservation(id),
  quota_timezone text not null,
  quota_day date not null,
  reservation_status text not null default 'reserved_for_lease' check (reservation_status='reserved_for_lease'),
  created_at timestamptz not null default now()
);

alter table growth.staged_activation_authorization enable row level security;
alter table growth.staged_activation_authorization_revocation enable row level security;
alter table growth.pilot_send_reservation enable row level security;

create index staged_activation_scope_idx on growth.staged_activation_authorization(organization_id,business_unit_id,jurisdiction_id,environment_name,provider_code,adapter_key,adapter_version,valid_until desc);
create index staged_activation_policy_idx on growth.staged_activation_authorization(pilot_policy_id);
create index staged_activation_approver_idx on growth.staged_activation_authorization(approved_by_app_user_id);
create index staged_activation_revoker_idx on growth.staged_activation_authorization_revocation(revoked_by_app_user_id);
create index pilot_send_auth_quota_idx on growth.pilot_send_reservation(staged_activation_authorization_id,quota_day,created_at);
create index pilot_send_policy_idx on growth.pilot_send_reservation(pilot_policy_id);
create index pilot_send_bu_idx on growth.pilot_send_reservation(business_unit_id);
create index pilot_send_jur_idx on growth.pilot_send_reservation(jurisdiction_id);

create trigger staged_activation_authorization_append_only before update or delete on growth.staged_activation_authorization for each row execute function growth.g6_append_only_guard();
create trigger staged_activation_authorization_revocation_append_only before update or delete on growth.staged_activation_authorization_revocation for each row execute function growth.g6_append_only_guard();
create trigger pilot_send_reservation_append_only before update or delete on growth.pilot_send_reservation for each row execute function growth.g6_append_only_guard();

create or replace function public.growth_g6_runtime_prerequisite_snapshot(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_policy growth.pilot_policy%rowtype;
  v_sender jsonb;
  v_evidence jsonb := '{}'::jsonb;
  v_blockers text[] := array[]::text[];
  v_required text[] := array['legal_compliance_approval','provider_security_review','sender_domain_readiness','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval'];
  v_type text; v_eid uuid; v_binding uuid; v_allow uuid; v_activation uuid; v_timezone text; v_base jsonb; v_fp text;
begin
  select j.timezone into v_timezone from public.business_unit bu join public.jurisdiction j on j.id=bu.jurisdiction_id
   where bu.id=p_business_unit_id and bu.organization_id=p_organization_id and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active';
  if v_timezone is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('invalid_or_inactive_scope'),'policy_version','g6-runtime-prerequisite-v1'); end if;

  select pp.* into v_policy from growth.pilot_policy pp
   where pp.organization_id=p_organization_id and pp.business_unit_id=p_business_unit_id and pp.jurisdiction_id=p_jurisdiction_id and pp.environment_name=p_environment_name
     and pp.valid_from<=now() and pp.valid_until>now() and not exists(select 1 from growth.pilot_policy_revocation r where r.pilot_policy_id=pp.id)
   order by pp.created_at desc limit 1;
  if v_policy.id is null then v_blockers:=array_append(v_blockers,'missing_or_inactive_pilot_policy'); end if;

  foreach v_type in array v_required loop
    select e.id into v_eid from growth.commissioning_evidence e
     where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id and e.environment_name=p_environment_name
       and e.evidence_type=v_type and e.valid_from<=now() and e.valid_until>now()
       and not exists(select 1 from growth.commissioning_evidence_revocation r where r.evidence_id=e.id)
     order by e.created_at desc limit 1;
    if v_eid is null then v_blockers:=array_append(v_blockers,'missing_or_inactive_evidence:'||v_type);
    else v_evidence:=v_evidence||jsonb_build_object(v_type,v_eid); end if;
    v_eid:=null;
  end loop;

  if v_policy.id is not null then
    v_sender:=public.growth_g2_evaluate_sender_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_policy.sender_email);
    if coalesce((v_sender->>'ready')::boolean,false)=false then v_blockers:=array_append(v_blockers,'sender_not_ready'); end if;
    select b.id into v_binding from growth.provider_runtime_binding b
     where b.organization_id=p_organization_id and b.business_unit_id=p_business_unit_id and b.jurisdiction_id=p_jurisdiction_id
       and b.provider_code=v_policy.provider_code and b.channel='email' and b.environment_name=p_environment_name and b.adapter_key=v_policy.adapter_key
       and b.binding_status='approved_metadata_only' and (p_environment_name<>'production' or b.credential_state='configured_external') and b.approved_at<=now() and b.valid_until>now()
     order by b.created_at desc limit 1;
    if v_binding is null then v_blockers:=array_append(v_blockers,'provider_runtime_binding_not_ready'); end if;
    select a.id into v_allow from growth.provider_adapter_allowlist a
     where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id
       and a.provider_code=v_policy.provider_code and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=v_policy.adapter_key and a.adapter_version=v_policy.adapter_version
       and a.allowlist_status='allowed' and a.approved_at<=now() and a.valid_until>now()
     order by a.created_at desc limit 1;
    if v_allow is null then v_blockers:=array_append(v_blockers,'provider_adapter_not_allowlisted'); end if;
    select a.id into v_activation from growth.provider_activation_approval a
     where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id
       and a.provider_code=v_policy.provider_code and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=v_policy.adapter_key and a.adapter_version=v_policy.adapter_version
       and a.approval_status='approved' and a.valid_from<=now() and a.valid_until>now()
     order by a.created_at desc limit 1;
    if v_activation is null then v_blockers:=array_append(v_blockers,'provider_activation_approval_missing'); end if;
  end if;

  v_base:=jsonb_build_object(
    'policy_version','g6-runtime-prerequisite-v1','organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
    'environment_name',p_environment_name,'pilot_policy_id',v_policy.id,'pilot_policy_request_hash',v_policy.request_hash,
    'provider_code',v_policy.provider_code,'adapter_key',v_policy.adapter_key,'adapter_version',v_policy.adapter_version,'sender_email',v_policy.sender_email,
    'daily_send_cap',v_policy.daily_send_cap,'total_send_cap',v_policy.total_send_cap,'quota_timezone',v_timezone,
    'evidence_snapshot',v_evidence,'sender_readiness',coalesce(v_sender,'{}'::jsonb),'runtime_binding_id',v_binding,'allowlist_id',v_allow,'activation_approval_id',v_activation
  );
  v_fp:=encode(extensions.digest(convert_to(v_base::text,'UTF8'),'sha256'),'hex');
  return v_base||jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'PREREQUISITES_READY' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'runtime_prerequisite_fingerprint',v_fp);
end $$;

create or replace function public.growth_g6_record_staged_activation_authorization(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text,
  p_approved_by_app_user_id uuid,p_approval_reference text,p_approval_reason text,p_valid_until timestamptz,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_ready jsonb; v_snap jsonb; v_existing growth.staged_activation_authorization%rowtype; v_hash text; v_id uuid; v_policy_until timestamptz;
begin
  if not exists(select 1 from public.app_user au where au.id=p_approved_by_app_user_id and au.status='active') then raise exception 'approver must be active app user' using errcode='22023'; end if;
  v_ready:=public.growth_g6_commissioning_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name);
  if v_ready->>'status'<>'READY_FOR_STAGED_ACTIVATION_REQUEST' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_ready->'blockers','policy_version','g6-staged-activation-v1'); end if;
  v_snap:=public.growth_g6_runtime_prerequisite_snapshot(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name);
  if v_snap->>'status'<>'PREREQUISITES_READY' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_snap->'blocking_reasons','policy_version','g6-staged-activation-v1'); end if;
  select valid_until into v_policy_until from growth.pilot_policy where id=(v_snap->>'pilot_policy_id')::uuid;
  if p_valid_until<=now() or p_valid_until>now()+interval '24 hours' or p_valid_until>v_policy_until then raise exception 'authorization validity exceeds allowed window' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,'environment_name',p_environment_name,'pilot_policy_id',v_snap->>'pilot_policy_id','pilot_policy_request_hash',v_snap->>'pilot_policy_request_hash','runtime_fingerprint',v_snap->>'runtime_prerequisite_fingerprint','approved_by',p_approved_by_app_user_id,'approval_reference',btrim(p_approval_reference),'approval_reason',btrim(p_approval_reason),'valid_until',p_valid_until,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.staged_activation_authorization a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.environment_name=p_environment_name and a.idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>v_hash then raise exception 'idempotency collision' using errcode='23505'; end if; return jsonb_build_object('status','STAGED_ACTIVATION_AUTHORIZED','authorization_id',v_existing.id,'idempotent_replay',true,'gate_mutation_performed',false); end if;
  insert into growth.staged_activation_authorization(organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_policy_id,pilot_policy_request_hash,provider_code,adapter_key,adapter_version,sender_email,evidence_snapshot,runtime_prerequisite_fingerprint,approved_by_app_user_id,approval_reference,approval_reason,valid_until,idempotency_key,request_hash,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name,(v_snap->>'pilot_policy_id')::uuid,v_snap->>'pilot_policy_request_hash',v_snap->>'provider_code',v_snap->>'adapter_key',v_snap->>'adapter_version',v_snap->>'sender_email',v_snap->'evidence_snapshot',v_snap->>'runtime_prerequisite_fingerprint',p_approved_by_app_user_id,btrim(p_approval_reference),btrim(p_approval_reason),p_valid_until,p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('status','STAGED_ACTIVATION_AUTHORIZED','authorization_id',v_id,'idempotent_replay',false,'gate_mutation_performed',false,'runtime_prerequisite_fingerprint',v_snap->>'runtime_prerequisite_fingerprint');
end $$;

create or replace function public.growth_g6_revoke_staged_activation_authorization(p_authorization_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_a growth.staged_activation_authorization%rowtype; v_r growth.staged_activation_authorization_revocation%rowtype;
begin
  select * into v_a from growth.staged_activation_authorization where id=p_authorization_id; if not found then raise exception 'authorization not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user au where au.id=p_revoked_by_app_user_id and au.status='active') then raise exception 'revoker must be active app user' using errcode='22023'; end if;
  if btrim(coalesce(p_revocation_reason,''))='' then raise exception 'revocation reason required' using errcode='22023'; end if;
  select * into v_r from growth.staged_activation_authorization_revocation where authorization_id=p_authorization_id; if found then return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',true); end if;
  insert into growth.staged_activation_authorization_revocation(authorization_id,revoked_by_app_user_id,revocation_reason) values(v_a.id,p_revoked_by_app_user_id,btrim(p_revocation_reason)) returning * into v_r;
  return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',false);
end $$;

create or replace function public.growth_g6_evaluate_staged_activation_authorization(p_authorization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_a growth.staged_activation_authorization%rowtype; v_snap jsonb; v_blockers text[]:=array[]::text[];
begin
  select * into v_a from growth.staged_activation_authorization where id=p_authorization_id;
  if v_a.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_not_found'),'policy_version','g6-staged-activation-v1'); end if;
  if v_a.valid_until<=now() then v_blockers:=array_append(v_blockers,'authorization_expired'); end if;
  if exists(select 1 from growth.staged_activation_authorization_revocation r where r.authorization_id=v_a.id) then v_blockers:=array_append(v_blockers,'authorization_revoked'); end if;
  v_snap:=public.growth_g6_runtime_prerequisite_snapshot(v_a.organization_id,v_a.business_unit_id,v_a.jurisdiction_id,v_a.environment_name);
  if v_snap->>'status'<>'PREREQUISITES_READY' then v_blockers:=v_blockers||array(select jsonb_array_elements_text(v_snap->'blocking_reasons')); end if;
  if coalesce(v_snap->>'pilot_policy_id','')<>v_a.pilot_policy_id::text or coalesce(v_snap->>'pilot_policy_request_hash','')<>v_a.pilot_policy_request_hash then v_blockers:=array_append(v_blockers,'pilot_policy_drift'); end if;
  if coalesce(v_snap->>'runtime_prerequisite_fingerprint','')<>v_a.runtime_prerequisite_fingerprint then v_blockers:=array_append(v_blockers,'runtime_prerequisite_drift'); end if;
  if exists(select 1 from growth.feature_gate g where g.gate_code in ('growth_auto_followup_enabled','growth_serviceos_handoff_enabled') and g.enabled=true) then v_blockers:=array_append(v_blockers,'later_stage_gate_enabled_during_manual_email_pilot'); end if;
  return jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'AUTHORIZED_FOR_STAGED_ACTIVATION' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g6-staged-activation-v1','authorization_id',v_a.id,'pilot_policy_id',v_a.pilot_policy_id,'provider_code',v_a.provider_code,'adapter_key',v_a.adapter_key,'adapter_version',v_a.adapter_version,'sender_email',v_a.sender_email,'runtime_prerequisite_fingerprint',v_a.runtime_prerequisite_fingerprint,'valid_until',v_a.valid_until);
end $$;

create or replace function public.growth_g6_reserve_pilot_send_for_provider_lease(p_authorization_id uuid,p_outreach_submission_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_a growth.staged_activation_authorization%rowtype; v_p growth.pilot_policy%rowtype; v_r growth.outreach_submission_reservation%rowtype; v_sender growth.sender_identity%rowtype; v_eval jsonb; v_existing growth.pilot_send_reservation%rowtype; v_tz text; v_day date; v_daily int; v_total int; v_id uuid;
begin
  select * into v_a from growth.staged_activation_authorization where id=p_authorization_id for update;
  if v_a.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_not_found'),'policy_version','g6-pilot-quota-v1'); end if;
  v_eval:=public.growth_g6_evaluate_staged_activation_authorization(v_a.id);
  if v_eval->>'status'<>'AUTHORIZED_FOR_STAGED_ACTIVATION' then return jsonb_build_object('status','BLOCKED','blocking_reasons',v_eval->'blocking_reasons','policy_version','g6-pilot-quota-v1'); end if;
  select * into v_p from growth.pilot_policy where id=v_a.pilot_policy_id;
  select * into v_r from growth.outreach_submission_reservation where id=p_outreach_submission_reservation_id;
  if v_r.id is null or v_r.organization_id<>v_a.organization_id or v_r.business_unit_id<>v_a.business_unit_id or v_r.jurisdiction_id<>v_a.jurisdiction_id or v_r.provider_code<>v_a.provider_code or v_r.reservation_status<>'reserved' or coalesce((v_r.metadata->>'non_sending')::boolean,false) is not true then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('submission_reservation_context_mismatch'),'policy_version','g6-pilot-quota-v1'); end if;
  select * into v_sender from growth.sender_identity where id=v_r.sender_identity_id;
  if v_sender.id is null or v_sender.email_address<>v_a.sender_email then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_sender_mismatch'),'policy_version','g6-pilot-quota-v1'); end if;
  select * into v_existing from growth.pilot_send_reservation where outreach_submission_reservation_id=v_r.id;
  if found then
    if v_existing.staged_activation_authorization_id=v_a.id then return jsonb_build_object('status','PILOT_SEND_RESERVED','pilot_send_reservation_id',v_existing.id,'idempotent_replay',true,'quota_day',v_existing.quota_day); end if;
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_already_bound_to_other_authorization'),'policy_version','g6-pilot-quota-v1');
  end if;
  select timezone into v_tz from public.jurisdiction where id=v_a.jurisdiction_id;
  if v_tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_tz) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('invalid_quota_timezone'),'policy_version','g6-pilot-quota-v1'); end if;
  v_day:=(now() at time zone v_tz)::date;
  select count(*) into v_total from growth.pilot_send_reservation where staged_activation_authorization_id=v_a.id;
  select count(*) into v_daily from growth.pilot_send_reservation where staged_activation_authorization_id=v_a.id and quota_day=v_day;
  if v_total>=v_p.total_send_cap then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_total_send_cap_reached'),'policy_version','g6-pilot-quota-v1'); end if;
  if v_daily>=v_p.daily_send_cap then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('pilot_daily_send_cap_reached'),'policy_version','g6-pilot-quota-v1'); end if;
  insert into growth.pilot_send_reservation(organization_id,business_unit_id,jurisdiction_id,staged_activation_authorization_id,pilot_policy_id,outreach_submission_reservation_id,quota_timezone,quota_day)
  values(v_a.organization_id,v_a.business_unit_id,v_a.jurisdiction_id,v_a.id,v_a.pilot_policy_id,v_r.id,v_tz,v_day) returning id into v_id;
  return jsonb_build_object('status','PILOT_SEND_RESERVED','pilot_send_reservation_id',v_id,'idempotent_replay',false,'quota_day',v_day,'quota_timezone',v_tz,'daily_reserved_after',v_daily+1,'total_reserved_after',v_total+1,'daily_send_cap',v_p.daily_send_cap,'total_send_cap',v_p.total_send_cap);
end $$;

alter table growth.provider_execution_lease add column g6_staged_activation_authorization_id uuid references growth.staged_activation_authorization(id);
alter table growth.provider_execution_lease add column g6_pilot_send_reservation_id uuid references growth.pilot_send_reservation(id);
create index provider_execution_lease_g6_auth_idx on growth.provider_execution_lease(g6_staged_activation_authorization_id);
create index provider_execution_lease_g6_send_idx on growth.provider_execution_lease(g6_pilot_send_reservation_id);

-- Existing G2 lease issuance is preserved for Acceptance. Production-shaped/live
-- provider execution now additionally requires exactly one current G6 staged
-- authorization and a server-side quota reservation.
create or replace function public.growth_g2_issue_provider_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_reservation_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_auth jsonb; v_binding uuid; v_allow uuid; v_activation uuid; v_existing growth.provider_execution_lease%rowtype; v_raw_token text; v_token_hash text; v_id uuid; v_exp timestamptz;
  v_g6_auth_id uuid; v_g6_count int; v_g6_res jsonb; v_g6_send_id uuid;
begin
  v_auth:=public.growth_g2_evaluate_provider_execution_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,p_provider_code,p_environment_name,p_adapter_key,p_adapter_version);
  if v_auth->>'status'<>'AUTHORIZED_FOR_LEASE' then return v_auth; end if;
  v_binding:=(v_auth->>'runtime_binding_id')::uuid; v_allow:=(v_auth->>'allowlist_id')::uuid; v_activation:=(v_auth->>'activation_approval_id')::uuid;
  select * into v_existing from growth.provider_execution_lease l where l.outreach_submission_reservation_id=p_reservation_id;
  if v_existing.id is not null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_lease_already_exists'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;

  if p_environment_name='production' then
    select count(*) into v_g6_count
    from growth.staged_activation_authorization a
    join growth.pilot_policy pp on pp.id=a.pilot_policy_id
    where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.environment_name='production'
      and a.provider_code=lower(btrim(p_provider_code)) and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version)
      and a.valid_until>now() and not exists(select 1 from growth.staged_activation_authorization_revocation r where r.authorization_id=a.id)
      and pp.valid_from<=now() and pp.valid_until>now() and not exists(select 1 from growth.pilot_policy_revocation pr where pr.pilot_policy_id=pp.id);
    if v_g6_count=0 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g6_staged_activation_authorization_missing'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
    if v_g6_count>1 then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g6_staged_activation_authorization_ambiguous'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
    select a.id into v_g6_auth_id
    from growth.staged_activation_authorization a
    join growth.pilot_policy pp on pp.id=a.pilot_policy_id
    where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.environment_name='production'
      and a.provider_code=lower(btrim(p_provider_code)) and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version)
      and a.valid_until>now() and not exists(select 1 from growth.staged_activation_authorization_revocation r where r.authorization_id=a.id)
      and pp.valid_from<=now() and pp.valid_until>now() and not exists(select 1 from growth.pilot_policy_revocation pr where pr.pilot_policy_id=pp.id)
    order by a.created_at desc,a.id limit 1;
    v_g6_res:=public.growth_g6_reserve_pilot_send_for_provider_lease(v_g6_auth_id,p_reservation_id);
    if v_g6_res->>'status'<>'PILOT_SEND_RESERVED' then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_g6_res->'blocking_reasons',jsonb_build_array('g6_pilot_send_reservation_failed')),'policy_version','g2-provider-execution-auth-2026-08-24','g6_policy_version','g6-pilot-quota-v1'); end if;
    v_g6_send_id:=(v_g6_res->>'pilot_send_reservation_id')::uuid;
  end if;

  v_exp:=least(now()+interval '10 minutes',(select a.valid_until from growth.provider_activation_approval a where a.id=v_activation));
  if p_environment_name='production' then v_exp:=least(v_exp,(select a.valid_until from growth.staged_activation_authorization a where a.id=v_g6_auth_id)); end if;
  if v_exp<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('activation_expired'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_raw_token:=pg_catalog.encode(extensions.gen_random_bytes(32),'hex'); v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token,'UTF8'),'sha256'),'hex');
  insert into growth.provider_execution_lease(organization_id,business_unit_id,jurisdiction_id,outreach_submission_reservation_id,provider_runtime_binding_id,provider_adapter_allowlist_id,provider_activation_approval_id,provider_code,environment_name,adapter_key,adapter_version,lease_token_hash,lease_status,issued_at,expires_at,metadata,g6_staged_activation_authorization_id,g6_pilot_send_reservation_id)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,v_binding,v_allow,v_activation,lower(btrim(p_provider_code)),p_environment_name,btrim(p_adapter_key),btrim(p_adapter_version),v_token_hash,'issued',now(),v_exp,jsonb_build_object('single_use',true,'credentials_external_only',true,'policy_version','g2-provider-execution-auth-2026-08-24','g6_required',p_environment_name='production'),v_g6_auth_id,v_g6_send_id) returning id into v_id;
  return jsonb_build_object('status','LEASE_ISSUED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_id,'expires_at',v_exp,'execution_token',v_raw_token,'g6_staged_activation_authorization_id',v_g6_auth_id,'g6_pilot_send_reservation_id',v_g6_send_id);
end $$;

create or replace function public.growth_g2_consume_provider_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_lease_id uuid,p_execution_token text,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_lease growth.provider_execution_lease%rowtype; v_token_hash text; v_activation growth.provider_activation_approval%rowtype; v_binding growth.provider_runtime_binding%rowtype; v_allow growth.provider_adapter_allowlist%rowtype; v_g6 jsonb;
begin
  if nullif(btrim(coalesce(p_execution_token,'')),'') is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('execution_token_missing'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_lease from growth.provider_execution_lease l where l.id=p_lease_id for update;
  if v_lease.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_found'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.organization_id<>p_organization_id or v_lease.business_unit_id<>p_business_unit_id or v_lease.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_scope_mismatch'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.provider_code<>lower(btrim(coalesce(p_provider_code,''))) or v_lease.environment_name<>p_environment_name or v_lease.adapter_key<>btrim(coalesce(p_adapter_key,'')) or v_lease.adapter_version<>btrim(coalesce(p_adapter_version,'')) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_adapter_context_mismatch'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.lease_status<>'issued' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_issued'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_lease.expires_at<=now() then update growth.provider_execution_lease set lease_status='expired' where id=v_lease.id; return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_expired'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('growth_layer_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('outreach_gate_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_provider_execution_enabled' and g.enabled=true) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('provider_execution_gate_disabled'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if p_environment_name='production' then
    if v_lease.g6_staged_activation_authorization_id is null or v_lease.g6_pilot_send_reservation_id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g6_pilot_authorization_link_missing'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
    v_g6:=public.growth_g6_evaluate_staged_activation_authorization(v_lease.g6_staged_activation_authorization_id);
    if v_g6->>'status'<>'AUTHORIZED_FOR_STAGED_ACTIVATION' then return jsonb_build_object('status','BLOCKED','blocking_reasons',coalesce(v_g6->'blocking_reasons',jsonb_build_array('g6_authorization_not_current')),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
    if not exists(select 1 from growth.pilot_send_reservation s where s.id=v_lease.g6_pilot_send_reservation_id and s.staged_activation_authorization_id=v_lease.g6_staged_activation_authorization_id and s.outreach_submission_reservation_id=v_lease.outreach_submission_reservation_id) then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('g6_pilot_send_reservation_link_invalid'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  end if;
  select * into v_binding from growth.provider_runtime_binding b where b.id=v_lease.provider_runtime_binding_id;
  if v_binding.id is null or v_binding.binding_status<>'approved_metadata_only' or v_binding.valid_until<=now() or v_binding.credential_state<>'configured_external' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('runtime_binding_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_allow from growth.provider_adapter_allowlist a where a.id=v_lease.provider_adapter_allowlist_id;
  if v_allow.id is null or v_allow.allowlist_status<>'allowed' or v_allow.valid_until<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('adapter_allowlist_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  select * into v_activation from growth.provider_activation_approval a where a.id=v_lease.provider_activation_approval_id;
  if v_activation.id is null or v_activation.approval_status<>'approved' or v_activation.valid_from>now() or v_activation.valid_until<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('human_activation_approval_not_current'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(btrim(p_execution_token),'UTF8'),'sha256'),'hex');
  if v_token_hash<>v_lease.lease_token_hash then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('execution_token_invalid'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  update growth.provider_execution_lease set lease_status='consumed',consumed_at=now() where id=v_lease.id;
  return jsonb_build_object('status','LEASE_CONSUMED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_lease.id,'reservation_id',v_lease.outreach_submission_reservation_id,'provider_code',v_lease.provider_code,'environment_name',v_lease.environment_name,'adapter_key',v_lease.adapter_key,'adapter_version',v_lease.adapter_version,'g6_staged_activation_authorization_id',v_lease.g6_staged_activation_authorization_id,'g6_pilot_send_reservation_id',v_lease.g6_pilot_send_reservation_id);
end $$;

revoke all on growth.staged_activation_authorization,growth.staged_activation_authorization_revocation,growth.pilot_send_reservation from anon,authenticated;
grant select on growth.staged_activation_authorization,growth.staged_activation_authorization_revocation,growth.pilot_send_reservation to service_role;
revoke all on function public.growth_g6_runtime_prerequisite_snapshot(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.growth_g6_record_staged_activation_authorization(uuid,uuid,uuid,text,uuid,text,text,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.growth_g6_revoke_staged_activation_authorization(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.growth_g6_evaluate_staged_activation_authorization(uuid) from public,anon,authenticated;
revoke all on function public.growth_g6_reserve_pilot_send_for_provider_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g6_runtime_prerequisite_snapshot(uuid,uuid,uuid,text) to service_role;
grant execute on function public.growth_g6_record_staged_activation_authorization(uuid,uuid,uuid,text,uuid,text,text,timestamptz,text,jsonb) to service_role;
grant execute on function public.growth_g6_revoke_staged_activation_authorization(uuid,uuid,text) to service_role;
grant execute on function public.growth_g6_evaluate_staged_activation_authorization(uuid) to service_role;
grant execute on function public.growth_g6_reserve_pilot_send_for_provider_lease(uuid,uuid) to service_role;
