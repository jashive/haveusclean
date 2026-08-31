-- Growth Layer G6 — Production Readiness & Controlled Pilot Commissioning
-- First slice only: immutable commissioning evidence, bounded pilot policy, and
-- read-only fail-closed readiness evaluation. This migration does NOT enable
-- any Growth execution gate and does NOT authorize provider execution.

create table growth.commissioning_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  environment_name text not null check (environment_name in ('acceptance','production')),
  evidence_type text not null check (evidence_type in (
    'legal_compliance_approval','provider_security_review','sender_domain_readiness',
    'monitoring_alerting_readiness','rollback_emergency_stop_readiness',
    'staff_sop_training_ready','serviceos_handoff_pilot_ready','hems_pilot_approval'
  )),
  evidence_reference text not null check (btrim(evidence_reference) <> ''),
  approved_by_app_user_id uuid not null references public.app_user(id),
  approved_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  policy_version text not null default 'g6-commissioning-evidence-v1' check (btrim(policy_version) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commissioning_evidence_valid_window check (valid_until > valid_from and valid_until <= valid_from + interval '90 days'),
  constraint commissioning_evidence_idem_uq unique (organization_id,business_unit_id,jurisdiction_id,environment_name,evidence_type,idempotency_key)
);

create table growth.commissioning_evidence_revocation (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null unique references growth.commissioning_evidence(id),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  revoked_by_app_user_id uuid not null references public.app_user(id),
  revocation_reason text not null check (btrim(revocation_reason) <> ''),
  revoked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table growth.pilot_policy (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  environment_name text not null check (environment_name in ('acceptance','production')),
  pilot_stage text not null check (pilot_stage = 'manual_email_outreach'),
  provider_code text not null check (btrim(provider_code) <> ''),
  adapter_key text not null check (btrim(adapter_key) <> ''),
  adapter_version text not null check (btrim(adapter_version) <> ''),
  sender_email text not null check (sender_email = lower(btrim(sender_email)) and sender_email like '%@%'),
  daily_send_cap integer not null check (daily_send_cap between 1 and 25),
  total_send_cap integer not null check (total_send_cap between 1 and 100 and total_send_cap >= daily_send_cap),
  handoff_cap integer not null default 0 check (handoff_cap = 0),
  auto_followup_allowed boolean not null default false check (auto_followup_allowed = false),
  sms_allowed boolean not null default false check (sms_allowed = false),
  phone_allowed boolean not null default false check (phone_allowed = false),
  kill_on_any_complaint boolean not null default true check (kill_on_any_complaint = true),
  sender_health_policy_version text not null default 'g2-sender-health-2026-08-23' check (sender_health_policy_version = 'g2-sender-health-2026-08-23'),
  approved_by_app_user_id uuid not null references public.app_user(id),
  approval_reference text not null check (btrim(approval_reference) <> ''),
  approval_reason text not null check (btrim(approval_reason) <> ''),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  policy_version text not null default 'g6-pilot-policy-v1' check (policy_version = 'g6-pilot-policy-v1'),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pilot_policy_valid_window check (valid_until > valid_from and valid_until <= valid_from + interval '7 days'),
  constraint pilot_policy_idem_uq unique (organization_id,business_unit_id,jurisdiction_id,environment_name,idempotency_key)
);

create table growth.pilot_policy_revocation (
  id uuid primary key default gen_random_uuid(),
  pilot_policy_id uuid not null unique references growth.pilot_policy(id),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  revoked_by_app_user_id uuid not null references public.app_user(id),
  revocation_reason text not null check (btrim(revocation_reason) <> ''),
  revoked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table growth.commissioning_evidence enable row level security;
alter table growth.commissioning_evidence_revocation enable row level security;
alter table growth.pilot_policy enable row level security;
alter table growth.pilot_policy_revocation enable row level security;

create index commissioning_evidence_scope_current_idx on growth.commissioning_evidence (organization_id,business_unit_id,jurisdiction_id,environment_name,evidence_type,valid_until desc);
create index commissioning_evidence_bu_idx on growth.commissioning_evidence (business_unit_id);
create index commissioning_evidence_jur_idx on growth.commissioning_evidence (jurisdiction_id);
create index commissioning_evidence_approver_idx on growth.commissioning_evidence (approved_by_app_user_id);
create index commissioning_evidence_revocation_scope_idx on growth.commissioning_evidence_revocation (organization_id,business_unit_id,jurisdiction_id);
create index commissioning_evidence_revocation_bu_idx on growth.commissioning_evidence_revocation (business_unit_id);
create index commissioning_evidence_revocation_jur_idx on growth.commissioning_evidence_revocation (jurisdiction_id);
create index commissioning_evidence_revoker_idx on growth.commissioning_evidence_revocation (revoked_by_app_user_id);
create index pilot_policy_scope_current_idx on growth.pilot_policy (organization_id,business_unit_id,jurisdiction_id,environment_name,valid_until desc);
create index pilot_policy_bu_idx on growth.pilot_policy (business_unit_id);
create index pilot_policy_jur_idx on growth.pilot_policy (jurisdiction_id);
create index pilot_policy_approver_idx on growth.pilot_policy (approved_by_app_user_id);
create index pilot_policy_revocation_scope_idx on growth.pilot_policy_revocation (organization_id,business_unit_id,jurisdiction_id);
create index pilot_policy_revocation_bu_idx on growth.pilot_policy_revocation (business_unit_id);
create index pilot_policy_revocation_jur_idx on growth.pilot_policy_revocation (jurisdiction_id);
create index pilot_policy_revoker_idx on growth.pilot_policy_revocation (revoked_by_app_user_id);

create or replace function growth.g6_append_only_guard()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception '% is append-only',tg_table_name using errcode='55000'; end $$;

create trigger commissioning_evidence_append_only before update or delete on growth.commissioning_evidence for each row execute function growth.g6_append_only_guard();
create trigger commissioning_evidence_revocation_append_only before update or delete on growth.commissioning_evidence_revocation for each row execute function growth.g6_append_only_guard();
create trigger pilot_policy_append_only before update or delete on growth.pilot_policy for each row execute function growth.g6_append_only_guard();
create trigger pilot_policy_revocation_append_only before update or delete on growth.pilot_policy_revocation for each row execute function growth.g6_append_only_guard();

create or replace function public.growth_g6_record_commissioning_evidence(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text,
  p_evidence_type text,p_evidence_reference text,p_approved_by_app_user_id uuid,
  p_valid_from timestamptz,p_valid_until timestamptz,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_hash text; v_existing growth.commissioning_evidence%rowtype; v_id uuid;
begin
  if not exists(select 1 from public.business_unit bu where bu.id=p_business_unit_id and bu.organization_id=p_organization_id and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active') then raise exception 'invalid or inactive organization/business_unit/jurisdiction scope' using errcode='22023'; end if;
  if not exists(select 1 from public.app_user au where au.id=p_approved_by_app_user_id and au.status='active') then raise exception 'approver must be active app user' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,'environment_name',p_environment_name,'evidence_type',p_evidence_type,'evidence_reference',btrim(p_evidence_reference),'approved_by',p_approved_by_app_user_id,'valid_from',p_valid_from,'valid_until',p_valid_until,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.commissioning_evidence where organization_id=p_organization_id and business_unit_id=p_business_unit_id and jurisdiction_id=p_jurisdiction_id and environment_name=p_environment_name and evidence_type=p_evidence_type and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>v_hash then raise exception 'idempotency collision' using errcode='23505'; end if; return jsonb_build_object('evidence_id',v_existing.id,'idempotent_replay',true,'request_hash',v_hash); end if;
  insert into growth.commissioning_evidence(organization_id,business_unit_id,jurisdiction_id,environment_name,evidence_type,evidence_reference,approved_by_app_user_id,valid_from,valid_until,idempotency_key,request_hash,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name,p_evidence_type,btrim(p_evidence_reference),p_approved_by_app_user_id,p_valid_from,p_valid_until,p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('evidence_id',v_id,'idempotent_replay',false,'request_hash',v_hash);
end $$;

create or replace function public.growth_g6_revoke_commissioning_evidence(p_evidence_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_e growth.commissioning_evidence%rowtype; v_r growth.commissioning_evidence_revocation%rowtype;
begin
  select * into v_e from growth.commissioning_evidence where id=p_evidence_id; if not found then raise exception 'evidence not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user au where au.id=p_revoked_by_app_user_id and au.status='active') then raise exception 'revoker must be active app user' using errcode='22023'; end if;
  if btrim(coalesce(p_revocation_reason,''))='' then raise exception 'revocation reason required' using errcode='22023'; end if;
  select * into v_r from growth.commissioning_evidence_revocation where evidence_id=p_evidence_id; if found then return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',true); end if;
  insert into growth.commissioning_evidence_revocation(evidence_id,organization_id,business_unit_id,jurisdiction_id,revoked_by_app_user_id,revocation_reason) values(v_e.id,v_e.organization_id,v_e.business_unit_id,v_e.jurisdiction_id,p_revoked_by_app_user_id,btrim(p_revocation_reason)) returning * into v_r;
  return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',false);
end $$;

create or replace function public.growth_g6_record_pilot_policy(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text,
  p_provider_code text,p_adapter_key text,p_adapter_version text,p_sender_email text,
  p_daily_send_cap integer,p_total_send_cap integer,p_approved_by_app_user_id uuid,
  p_approval_reference text,p_approval_reason text,p_valid_from timestamptz,p_valid_until timestamptz,
  p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_hash text; v_existing growth.pilot_policy%rowtype; v_id uuid;
begin
  if not exists(select 1 from public.business_unit bu where bu.id=p_business_unit_id and bu.organization_id=p_organization_id and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active') then raise exception 'invalid or inactive organization/business_unit/jurisdiction scope' using errcode='22023'; end if;
  if not exists(select 1 from public.app_user au where au.id=p_approved_by_app_user_id and au.status='active') then raise exception 'approver must be active app user' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,'environment_name',p_environment_name,'provider_code',lower(btrim(p_provider_code)),'adapter_key',btrim(p_adapter_key),'adapter_version',btrim(p_adapter_version),'sender_email',lower(btrim(p_sender_email)),'daily_send_cap',p_daily_send_cap,'total_send_cap',p_total_send_cap,'approved_by',p_approved_by_app_user_id,'approval_reference',btrim(p_approval_reference),'approval_reason',btrim(p_approval_reason),'valid_from',p_valid_from,'valid_until',p_valid_until,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.pilot_policy where organization_id=p_organization_id and business_unit_id=p_business_unit_id and jurisdiction_id=p_jurisdiction_id and environment_name=p_environment_name and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_hash<>v_hash then raise exception 'idempotency collision' using errcode='23505'; end if; return jsonb_build_object('pilot_policy_id',v_existing.id,'idempotent_replay',true,'request_hash',v_hash); end if;
  insert into growth.pilot_policy(organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_stage,provider_code,adapter_key,adapter_version,sender_email,daily_send_cap,total_send_cap,approved_by_app_user_id,approval_reference,approval_reason,valid_from,valid_until,idempotency_key,request_hash,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_environment_name,'manual_email_outreach',lower(btrim(p_provider_code)),btrim(p_adapter_key),btrim(p_adapter_version),lower(btrim(p_sender_email)),p_daily_send_cap,p_total_send_cap,p_approved_by_app_user_id,btrim(p_approval_reference),btrim(p_approval_reason),p_valid_from,p_valid_until,p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('pilot_policy_id',v_id,'idempotent_replay',false,'request_hash',v_hash);
end $$;

create or replace function public.growth_g6_revoke_pilot_policy(p_pilot_policy_id uuid,p_revoked_by_app_user_id uuid,p_revocation_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_p growth.pilot_policy%rowtype; v_r growth.pilot_policy_revocation%rowtype;
begin
  select * into v_p from growth.pilot_policy where id=p_pilot_policy_id; if not found then raise exception 'pilot policy not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.app_user au where au.id=p_revoked_by_app_user_id and au.status='active') then raise exception 'revoker must be active app user' using errcode='22023'; end if;
  if btrim(coalesce(p_revocation_reason,''))='' then raise exception 'revocation reason required' using errcode='22023'; end if;
  select * into v_r from growth.pilot_policy_revocation where pilot_policy_id=p_pilot_policy_id; if found then return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',true); end if;
  insert into growth.pilot_policy_revocation(pilot_policy_id,organization_id,business_unit_id,jurisdiction_id,revoked_by_app_user_id,revocation_reason) values(v_p.id,v_p.organization_id,v_p.business_unit_id,v_p.jurisdiction_id,p_revoked_by_app_user_id,btrim(p_revocation_reason)) returning * into v_r;
  return jsonb_build_object('revocation_id',v_r.id,'idempotent_replay',false);
end $$;

create or replace function public.growth_g6_commissioning_readiness(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_environment_name text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_policy growth.pilot_policy%rowtype; v_sender jsonb; v_blockers text[]:=array[]::text[];
  v_required text[]:=array['legal_compliance_approval','provider_security_review','sender_domain_readiness','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval'];
  v_type text; v_gate record; v_provider_binding boolean:=false; v_allowlist boolean:=false; v_activation boolean:=false;
begin
  if not exists(select 1 from public.business_unit bu where bu.id=p_business_unit_id and bu.organization_id=p_organization_id and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active') then raise exception 'invalid or inactive organization/business_unit/jurisdiction scope' using errcode='22023'; end if;
  if p_environment_name not in ('acceptance','production') then raise exception 'invalid environment' using errcode='22023'; end if;
  foreach v_type in array v_required loop
    if not exists(select 1 from growth.commissioning_evidence e where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id and e.environment_name=p_environment_name and e.evidence_type=v_type and e.valid_from<=now() and e.valid_until>now() and not exists(select 1 from growth.commissioning_evidence_revocation r where r.evidence_id=e.id)) then v_blockers:=array_append(v_blockers,'missing_or_inactive_evidence:'||v_type); end if;
  end loop;
  select p.* into v_policy from growth.pilot_policy p where p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id and p.environment_name=p_environment_name and p.valid_from<=now() and p.valid_until>now() and not exists(select 1 from growth.pilot_policy_revocation r where r.pilot_policy_id=p.id) order by p.created_at desc limit 1;
  if not found then
    v_blockers:=array_append(v_blockers,'missing_or_inactive_pilot_policy');
  else
    v_sender:=public.growth_g2_evaluate_sender_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_policy.sender_email);
    if coalesce((v_sender->>'ready')::boolean,false)=false then v_blockers:=array_append(v_blockers,'sender_not_ready'); end if;
    select exists(select 1 from growth.provider_runtime_binding b where b.organization_id=p_organization_id and b.business_unit_id=p_business_unit_id and b.jurisdiction_id=p_jurisdiction_id and b.provider_code=v_policy.provider_code and b.channel='email' and b.environment_name=p_environment_name and b.adapter_key=v_policy.adapter_key and b.binding_status='approved_metadata_only' and (p_environment_name<>'production' or b.credential_state='configured_external') and b.approved_at<=now() and b.valid_until>now()) into v_provider_binding;
    if not v_provider_binding then v_blockers:=array_append(v_blockers,'provider_runtime_binding_not_ready'); end if;
    select exists(select 1 from growth.provider_adapter_allowlist a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=v_policy.provider_code and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=v_policy.adapter_key and a.adapter_version=v_policy.adapter_version and a.allowlist_status='allowed' and a.approved_at<=now() and a.valid_until>now()) into v_allowlist;
    if not v_allowlist then v_blockers:=array_append(v_blockers,'provider_adapter_not_allowlisted'); end if;
    select exists(select 1 from growth.provider_activation_approval a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=v_policy.provider_code and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=v_policy.adapter_key and a.adapter_version=v_policy.adapter_version and a.approval_status='approved' and a.valid_from<=now() and a.valid_until>now()) into v_activation;
    if not v_activation then v_blockers:=array_append(v_blockers,'provider_activation_approval_missing'); end if;
  end if;
  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then v_blockers:=array_append(v_blockers,'protected_gate_unexpectedly_enabled:'||v_gate.gate_code); end if; end loop;
  return jsonb_build_object('policy_version','g6-commissioning-readiness-v1','status',case when cardinality(v_blockers)=0 then 'READY_FOR_STAGED_ACTIVATION_REQUEST' else 'BLOCKED' end,'ready_for_staged_activation_request',cardinality(v_blockers)=0,'blockers',to_jsonb(v_blockers),'pilot_policy_id',v_policy.id,'pilot_stage',v_policy.pilot_stage,'daily_send_cap',v_policy.daily_send_cap,'total_send_cap',v_policy.total_send_cap,'handoff_cap',v_policy.handoff_cap,'auto_followup_allowed',coalesce(v_policy.auto_followup_allowed,false),'sms_allowed',coalesce(v_policy.sms_allowed,false),'phone_allowed',coalesce(v_policy.phone_allowed,false),'sender_readiness',coalesce(v_sender,'{}'::jsonb),'execution_authorized',false,'gate_mutation_performed',false);
end $$;

revoke all on growth.commissioning_evidence,growth.commissioning_evidence_revocation,growth.pilot_policy,growth.pilot_policy_revocation from anon,authenticated;
grant select on growth.commissioning_evidence,growth.commissioning_evidence_revocation,growth.pilot_policy,growth.pilot_policy_revocation to service_role;
revoke all on function growth.g6_append_only_guard() from public,anon,authenticated;
revoke all on function public.growth_g6_record_commissioning_evidence(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.growth_g6_revoke_commissioning_evidence(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.growth_g6_record_pilot_policy(uuid,uuid,uuid,text,text,text,text,text,integer,integer,uuid,text,text,timestamptz,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.growth_g6_revoke_pilot_policy(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.growth_g6_commissioning_readiness(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g6_record_commissioning_evidence(uuid,uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,text,jsonb) to service_role;
grant execute on function public.growth_g6_revoke_commissioning_evidence(uuid,uuid,text) to service_role;
grant execute on function public.growth_g6_record_pilot_policy(uuid,uuid,uuid,text,text,text,text,text,integer,integer,uuid,text,text,timestamptz,timestamptz,text,jsonb) to service_role;
grant execute on function public.growth_g6_revoke_pilot_policy(uuid,uuid,text) to service_role;
grant execute on function public.growth_g6_commissioning_readiness(uuid,uuid,uuid,text) to service_role;
