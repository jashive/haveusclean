create table if not exists growth.provider_runtime_binding (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  provider_code text not null, channel text not null check (channel='email'), environment_name text not null check (environment_name in ('acceptance','production')),
  adapter_key text not null, credential_reference_name text not null, credential_state text not null check (credential_state in ('absent','configured_external')),
  binding_status text not null check (binding_status in ('approved_metadata_only','suspended','revoked')), approved_by_app_user_id uuid not null references public.app_user(id),
  approved_at timestamptz not null default now(), valid_until timestamptz not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique (organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key)
);
create table if not exists growth.provider_adapter_allowlist (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  provider_code text not null, channel text not null check (channel='email'), environment_name text not null check (environment_name in ('acceptance','production')),
  adapter_key text not null, adapter_version text not null, allowlist_status text not null check (allowlist_status in ('allowed','suspended','revoked')),
  approved_by_app_user_id uuid not null references public.app_user(id), approved_at timestamptz not null default now(), valid_until timestamptz not null,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique (organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key,adapter_version)
);
create table if not exists growth.provider_activation_approval (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  provider_code text not null, channel text not null check (channel='email'), environment_name text not null check (environment_name in ('acceptance','production')),
  adapter_key text not null, adapter_version text not null, approval_status text not null check (approval_status in ('approved','revoked','expired')),
  approved_by_app_user_id uuid not null references public.app_user(id), approved_at timestamptz not null default now(), valid_from timestamptz not null default now(),
  valid_until timestamptz not null, approval_reference text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique (organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key,adapter_version,approval_reference)
);
create table if not exists growth.provider_execution_lease (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  outreach_submission_reservation_id uuid not null references growth.outreach_submission_reservation(id) on delete restrict,
  provider_runtime_binding_id uuid not null references growth.provider_runtime_binding(id) on delete restrict,
  provider_adapter_allowlist_id uuid not null references growth.provider_adapter_allowlist(id) on delete restrict,
  provider_activation_approval_id uuid not null references growth.provider_activation_approval(id) on delete restrict,
  provider_code text not null, environment_name text not null check (environment_name in ('acceptance','production')), adapter_key text not null, adapter_version text not null,
  lease_token_hash text not null unique check (lease_token_hash ~ '^[0-9a-f]{64}$'), lease_status text not null check (lease_status in ('issued','consumed','expired','revoked')),
  issued_at timestamptz not null default now(), expires_at timestamptz not null, consumed_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique (outreach_submission_reservation_id)
);
create index if not exists provider_runtime_binding_reviewer_idx on growth.provider_runtime_binding(approved_by_app_user_id);
create index if not exists provider_adapter_allowlist_reviewer_idx on growth.provider_adapter_allowlist(approved_by_app_user_id);
create index if not exists provider_activation_approval_reviewer_idx on growth.provider_activation_approval(approved_by_app_user_id);
create index if not exists provider_execution_lease_runtime_binding_idx on growth.provider_execution_lease(provider_runtime_binding_id);
create index if not exists provider_execution_lease_allowlist_idx on growth.provider_execution_lease(provider_adapter_allowlist_id);
create index if not exists provider_execution_lease_activation_idx on growth.provider_execution_lease(provider_activation_approval_id);
alter table growth.provider_runtime_binding enable row level security;
alter table growth.provider_adapter_allowlist enable row level security;
alter table growth.provider_activation_approval enable row level security;
alter table growth.provider_execution_lease enable row level security;
revoke all on growth.provider_runtime_binding from public,anon,authenticated,service_role;
revoke all on growth.provider_adapter_allowlist from public,anon,authenticated,service_role;
revoke all on growth.provider_activation_approval from public,anon,authenticated,service_role;
revoke all on growth.provider_execution_lease from public,anon,authenticated,service_role;
grant select on growth.provider_runtime_binding to service_role;
grant select on growth.provider_adapter_allowlist to service_role;
grant select on growth.provider_activation_approval to service_role;
grant select on growth.provider_execution_lease to service_role;
create or replace function public.growth_g2_authorization_immutable_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin raise exception 'growth_g2: provider authorization records are immutable'; end; $$;
create or replace function public.growth_g2_execution_lease_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op='DELETE' then raise exception 'growth_g2: execution leases cannot be deleted'; end if;
  if new.organization_id is distinct from old.organization_id or new.business_unit_id is distinct from old.business_unit_id or new.jurisdiction_id is distinct from old.jurisdiction_id or new.outreach_submission_reservation_id is distinct from old.outreach_submission_reservation_id or new.provider_runtime_binding_id is distinct from old.provider_runtime_binding_id or new.provider_adapter_allowlist_id is distinct from old.provider_adapter_allowlist_id or new.provider_activation_approval_id is distinct from old.provider_activation_approval_id or new.provider_code is distinct from old.provider_code or new.environment_name is distinct from old.environment_name or new.adapter_key is distinct from old.adapter_key or new.adapter_version is distinct from old.adapter_version or new.lease_token_hash is distinct from old.lease_token_hash or new.issued_at is distinct from old.issued_at or new.expires_at is distinct from old.expires_at then raise exception 'growth_g2: execution lease identity is immutable'; end if;
  if old.lease_status <> 'issued' or new.lease_status not in ('consumed','expired','revoked') then raise exception 'growth_g2: invalid execution lease transition'; end if;
  if new.lease_status='consumed' and new.consumed_at is null then raise exception 'growth_g2: consumed lease requires consumed_at'; end if; return new; end; $$;
drop trigger if exists trg_growth_g2_runtime_binding_immutable on growth.provider_runtime_binding;
create trigger trg_growth_g2_runtime_binding_immutable before update or delete on growth.provider_runtime_binding for each row execute function public.growth_g2_authorization_immutable_guard();
drop trigger if exists trg_growth_g2_adapter_allowlist_immutable on growth.provider_adapter_allowlist;
create trigger trg_growth_g2_adapter_allowlist_immutable before update or delete on growth.provider_adapter_allowlist for each row execute function public.growth_g2_authorization_immutable_guard();
drop trigger if exists trg_growth_g2_activation_approval_immutable on growth.provider_activation_approval;
create trigger trg_growth_g2_activation_approval_immutable before update or delete on growth.provider_activation_approval for each row execute function public.growth_g2_authorization_immutable_guard();
drop trigger if exists trg_growth_g2_execution_lease_guard on growth.provider_execution_lease;
create trigger trg_growth_g2_execution_lease_guard before update or delete on growth.provider_execution_lease for each row execute function public.growth_g2_execution_lease_guard();

create or replace function public.growth_g2_register_provider_runtime_binding(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_credential_reference_name text,p_credential_state text,p_reviewer_app_user_id uuid,p_valid_until timestamptz,p_metadata jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin
  if p_environment_name not in ('acceptance','production') then raise exception 'growth_g2: unsupported provider environment'; end if;
  if p_credential_state not in ('absent','configured_external') then raise exception 'growth_g2: invalid credential state'; end if;
  if p_environment_name='acceptance' and p_credential_state<>'absent' then raise exception 'growth_g2: acceptance provider credentials must remain absent'; end if;
  if nullif(btrim(coalesce(p_provider_code,'')),'') is null or nullif(btrim(coalesce(p_adapter_key,'')),'') is null or nullif(btrim(coalesce(p_credential_reference_name,'')),'') is null then raise exception 'growth_g2: provider binding fields required'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if p_valid_until is null or p_valid_until<=now() then raise exception 'growth_g2: future binding expiry required'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: provider binding scope mismatch'; end if;
  select r.id into v_id from growth.provider_runtime_binding r where r.organization_id=p_organization_id and r.business_unit_id=p_business_unit_id and r.jurisdiction_id=p_jurisdiction_id and r.provider_code=lower(btrim(p_provider_code)) and r.channel='email' and r.environment_name=p_environment_name and r.adapter_key=btrim(p_adapter_key);
  if v_id is not null then return v_id; end if;
  insert into growth.provider_runtime_binding(organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key,credential_reference_name,credential_state,binding_status,approved_by_app_user_id,approved_at,valid_until,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,lower(btrim(p_provider_code)),'email',p_environment_name,btrim(p_adapter_key),btrim(p_credential_reference_name),p_credential_state,'approved_metadata_only',p_reviewer_app_user_id,now(),p_valid_until,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id; return v_id; end; $$;

create or replace function public.growth_g2_register_provider_adapter_allowlist(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text,p_reviewer_app_user_id uuid,p_valid_until timestamptz,p_metadata jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin
  if p_environment_name not in ('acceptance','production') then raise exception 'growth_g2: unsupported provider environment'; end if;
  if nullif(btrim(coalesce(p_provider_code,'')),'') is null or nullif(btrim(coalesce(p_adapter_key,'')),'') is null or nullif(btrim(coalesce(p_adapter_version,'')),'') is null then raise exception 'growth_g2: allowlist fields required'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if p_valid_until is null or p_valid_until<=now() then raise exception 'growth_g2: future allowlist expiry required'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: allowlist scope mismatch'; end if;
  select a.id into v_id from growth.provider_adapter_allowlist a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version);
  if v_id is not null then return v_id; end if;
  insert into growth.provider_adapter_allowlist(organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key,adapter_version,allowlist_status,approved_by_app_user_id,approved_at,valid_until,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,lower(btrim(p_provider_code)),'email',p_environment_name,btrim(p_adapter_key),btrim(p_adapter_version),'allowed',p_reviewer_app_user_id,now(),p_valid_until,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id; return v_id; end; $$;

create or replace function public.growth_g2_record_provider_activation_approval(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text,p_reviewer_app_user_id uuid,p_valid_until timestamptz,p_approval_reference text,p_metadata jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin
  if p_environment_name not in ('acceptance','production') then raise exception 'growth_g2: unsupported provider environment'; end if;
  if nullif(btrim(coalesce(p_provider_code,'')),'') is null or nullif(btrim(coalesce(p_adapter_key,'')),'') is null or nullif(btrim(coalesce(p_adapter_version,'')),'') is null or nullif(btrim(coalesce(p_approval_reference,'')),'') is null then raise exception 'growth_g2: activation approval fields required'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if p_valid_until is null or p_valid_until<=now() then raise exception 'growth_g2: future activation expiry required'; end if;
  if p_valid_until>now()+interval '24 hours' then raise exception 'growth_g2: activation approval cannot exceed 24 hours'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: activation approval scope mismatch'; end if;
  select a.id into v_id from growth.provider_activation_approval a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version) and a.approval_reference=btrim(p_approval_reference);
  if v_id is not null then return v_id; end if;
  insert into growth.provider_activation_approval(organization_id,business_unit_id,jurisdiction_id,provider_code,channel,environment_name,adapter_key,adapter_version,approval_status,approved_by_app_user_id,approved_at,valid_from,valid_until,approval_reference,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,lower(btrim(p_provider_code)),'email',p_environment_name,btrim(p_adapter_key),btrim(p_adapter_version),'approved',p_reviewer_app_user_id,now(),now(),p_valid_until,btrim(p_approval_reference),coalesce(p_metadata,'{}'::jsonb)) returning id into v_id; return v_id; end; $$;

create or replace function public.growth_g2_evaluate_provider_execution_authorization(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_reservation_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text) returns jsonb language plpgsql security definer set search_path='' as $$ declare v_res growth.outreach_submission_reservation%rowtype; v_binding growth.provider_runtime_binding%rowtype; v_allow growth.provider_adapter_allowlist%rowtype; v_activation growth.provider_activation_approval%rowtype; v_blockers text[]:=array[]::text[]; begin
  select * into v_res from growth.outreach_submission_reservation r where r.id=p_reservation_id;
  if v_res.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_not_found'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  if v_res.organization_id<>p_organization_id or v_res.business_unit_id<>p_business_unit_id or v_res.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'reservation_scope_mismatch'); end if;
  if v_res.reservation_status<>'reserved' then v_blockers:=array_append(v_blockers,'reservation_not_reserved'); end if;
  if v_res.provider_code<>lower(btrim(coalesce(p_provider_code,''))) then v_blockers:=array_append(v_blockers,'reservation_provider_mismatch'); end if;
  if coalesce((v_res.metadata->>'non_sending')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'reservation_not_non_sending'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'growth_layer_disabled'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'outreach_gate_disabled'); end if;
  select * into v_binding from growth.provider_runtime_binding b where b.organization_id=p_organization_id and b.business_unit_id=p_business_unit_id and b.jurisdiction_id=p_jurisdiction_id and b.provider_code=lower(btrim(p_provider_code)) and b.channel='email' and b.environment_name=p_environment_name and b.adapter_key=btrim(p_adapter_key) order by b.created_at desc limit 1;
  if v_binding.id is null then v_blockers:=array_append(v_blockers,'runtime_binding_missing'); else if v_binding.binding_status<>'approved_metadata_only' or v_binding.valid_until<=now() then v_blockers:=array_append(v_blockers,'runtime_binding_not_current'); end if; if v_binding.credential_state<>'configured_external' then v_blockers:=array_append(v_blockers,'provider_credentials_absent'); end if; end if;
  select * into v_allow from growth.provider_adapter_allowlist a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version) order by a.created_at desc limit 1;
  if v_allow.id is null then v_blockers:=array_append(v_blockers,'adapter_not_allowlisted'); else if v_allow.allowlist_status<>'allowed' or v_allow.valid_until<=now() then v_blockers:=array_append(v_blockers,'adapter_allowlist_not_current'); end if; end if;
  select * into v_activation from growth.provider_activation_approval a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.provider_code=lower(btrim(p_provider_code)) and a.channel='email' and a.environment_name=p_environment_name and a.adapter_key=btrim(p_adapter_key) and a.adapter_version=btrim(p_adapter_version) and a.approval_status='approved' and a.valid_from<=now() and a.valid_until>now() order by a.created_at desc limit 1;
  if v_activation.id is null then v_blockers:=array_append(v_blockers,'human_activation_approval_missing'); end if;
  return jsonb_build_object('status',case when cardinality(v_blockers)=0 then 'AUTHORIZED_FOR_LEASE' else 'BLOCKED' end,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-provider-execution-auth-2026-08-24','reservation_id',v_res.id,'runtime_binding_id',v_binding.id,'allowlist_id',v_allow.id,'activation_approval_id',v_activation.id,'credential_reference_name',v_binding.credential_reference_name); end; $$;

create or replace function public.growth_g2_issue_provider_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_reservation_id uuid,p_provider_code text,p_environment_name text,p_adapter_key text,p_adapter_version text) returns jsonb language plpgsql security definer set search_path='' as $$ declare v_auth jsonb; v_binding uuid; v_allow uuid; v_activation uuid; v_existing growth.provider_execution_lease%rowtype; v_token_material text; v_token_hash text; v_id uuid; v_exp timestamptz; begin
  v_auth:=public.growth_g2_evaluate_provider_execution_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,p_provider_code,p_environment_name,p_adapter_key,p_adapter_version);
  if v_auth->>'status'<>'AUTHORIZED_FOR_LEASE' then return v_auth; end if;
  v_binding:=(v_auth->>'runtime_binding_id')::uuid; v_allow:=(v_auth->>'allowlist_id')::uuid; v_activation:=(v_auth->>'activation_approval_id')::uuid;
  select * into v_existing from growth.provider_execution_lease l where l.outreach_submission_reservation_id=p_reservation_id;
  if v_existing.id is not null then if v_existing.lease_status='issued' and v_existing.expires_at>now() then return jsonb_build_object('status','LEASE_ISSUED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_existing.id,'expires_at',v_existing.expires_at,'lease_token_hash',v_existing.lease_token_hash); end if; return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('reservation_lease_already_exists'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_exp:=least(now()+interval '10 minutes',(select a.valid_until from growth.provider_activation_approval a where a.id=v_activation));
  if v_exp<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('activation_expired'),'policy_version','g2-provider-execution-auth-2026-08-24'); end if;
  v_token_material:=gen_random_uuid()::text||'|'||clock_timestamp()::text||'|'||p_reservation_id::text||'|'||lower(btrim(p_provider_code))||'|'||btrim(p_adapter_key)||'|'||btrim(p_adapter_version);
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token_material,'UTF8'),'sha256'),'hex');
  insert into growth.provider_execution_lease(organization_id,business_unit_id,jurisdiction_id,outreach_submission_reservation_id,provider_runtime_binding_id,provider_adapter_allowlist_id,provider_activation_approval_id,provider_code,environment_name,adapter_key,adapter_version,lease_token_hash,lease_status,issued_at,expires_at,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_reservation_id,v_binding,v_allow,v_activation,lower(btrim(p_provider_code)),p_environment_name,btrim(p_adapter_key),btrim(p_adapter_version),v_token_hash,'issued',now(),v_exp,jsonb_build_object('single_use',true,'credentials_external_only',true,'policy_version','g2-provider-execution-auth-2026-08-24')) returning id into v_id;
  return jsonb_build_object('status','LEASE_ISSUED','policy_version','g2-provider-execution-auth-2026-08-24','lease_id',v_id,'expires_at',v_exp,'lease_token_hash',v_token_hash); end; $$;

revoke execute on function public.growth_g2_authorization_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_execution_lease_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_register_provider_runtime_binding(uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_register_provider_adapter_allowlist(uuid,uuid,uuid,text,text,text,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_record_provider_activation_approval(uuid,uuid,uuid,text,text,text,text,uuid,timestamptz,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_evaluate_provider_execution_authorization(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_issue_provider_execution_lease(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.growth_g2_register_provider_runtime_binding(uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz,jsonb) to service_role;
grant execute on function public.growth_g2_register_provider_adapter_allowlist(uuid,uuid,uuid,text,text,text,text,uuid,timestamptz,jsonb) to service_role;
grant execute on function public.growth_g2_record_provider_activation_approval(uuid,uuid,uuid,text,text,text,text,uuid,timestamptz,text,jsonb) to service_role;
grant execute on function public.growth_g2_evaluate_provider_execution_authorization(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.growth_g2_issue_provider_execution_lease(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
