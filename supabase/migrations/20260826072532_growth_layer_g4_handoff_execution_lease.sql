create table if not exists growth.serviceos_handoff_execution_lease (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  authorization_id uuid not null references growth.serviceos_handoff_authorization(id) on delete restrict,
  plan_id uuid not null references growth.serviceos_handoff_plan(id) on delete restrict,
  reservation_id uuid not null references growth.serviceos_handoff_reservation(id) on delete restrict,
  handoff_candidate_id uuid not null references growth.handoff_candidate(id) on delete restrict,
  object_plan_hash text not null check (object_plan_hash ~ '^[0-9a-f]{64}$'),
  lease_token_hash text not null unique check (lease_token_hash ~ '^[0-9a-f]{64}$'),
  lease_status text not null check (lease_status in ('issued','consumed','expired','revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (authorization_id),
  unique (plan_id),
  unique (reservation_id),
  unique (handoff_candidate_id)
);
create index if not exists serviceos_handoff_execution_lease_scope_idx on growth.serviceos_handoff_execution_lease(organization_id,business_unit_id,jurisdiction_id,issued_at desc);
create index if not exists serviceos_handoff_execution_lease_authorization_idx on growth.serviceos_handoff_execution_lease(authorization_id);
alter table growth.serviceos_handoff_execution_lease enable row level security;
revoke all on growth.serviceos_handoff_execution_lease from public,anon,authenticated,service_role;
grant select on growth.serviceos_handoff_execution_lease to service_role;
create or replace function public.growth_g4_handoff_execution_lease_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'growth_g4: ServiceOS handoff execution leases cannot be deleted'; end if;
  if new.organization_id is distinct from old.organization_id or new.business_unit_id is distinct from old.business_unit_id or new.jurisdiction_id is distinct from old.jurisdiction_id or new.authorization_id is distinct from old.authorization_id or new.plan_id is distinct from old.plan_id or new.reservation_id is distinct from old.reservation_id or new.handoff_candidate_id is distinct from old.handoff_candidate_id or new.object_plan_hash is distinct from old.object_plan_hash or new.lease_token_hash is distinct from old.lease_token_hash or new.issued_at is distinct from old.issued_at or new.expires_at is distinct from old.expires_at then raise exception 'growth_g4: ServiceOS handoff execution lease identity is immutable'; end if;
  if old.lease_status<>'issued' or new.lease_status not in ('consumed','expired','revoked') then raise exception 'growth_g4: invalid handoff execution lease transition'; end if;
  if new.lease_status='consumed' and new.consumed_at is null then raise exception 'growth_g4: consumed handoff execution lease requires consumed_at'; end if;
  if new.lease_status<>'consumed' and new.consumed_at is distinct from old.consumed_at then raise exception 'growth_g4: consumed_at may only change on consume'; end if;
  return new;
end;
$$;
drop trigger if exists trg_growth_g4_handoff_execution_lease_guard on growth.serviceos_handoff_execution_lease;
create trigger trg_growth_g4_handoff_execution_lease_guard before update or delete on growth.serviceos_handoff_execution_lease for each row execute function public.growth_g4_handoff_execution_lease_guard();
create or replace function public.growth_g4_issue_serviceos_handoff_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_authorization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_eval jsonb; v_auth growth.serviceos_handoff_authorization%rowtype; v_existing growth.serviceos_handoff_execution_lease%rowtype; v_raw_token text; v_token_hash text; v_id uuid; v_exp timestamptz;
begin
  v_eval:=public.growth_g4_evaluate_serviceos_handoff_authorization(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_authorization_id);
  if coalesce(v_eval->>'status','')<>'AUTHORIZED_FOR_EXECUTION_LEASE' then return v_eval; end if;
  select * into v_auth from growth.serviceos_handoff_authorization a where a.id=p_authorization_id;
  select * into v_existing from growth.serviceos_handoff_execution_lease l where l.authorization_id=p_authorization_id;
  if v_existing.id is not null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_lease_already_exists'),'lease_id',v_existing.id,'policy_version','g4-handoff-execution-lease-2026-08-26','serviceos_mutation_authorized',false); end if;
  v_exp:=least(now()+interval '10 minutes',v_auth.valid_until);
  if v_exp<=now() then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('authorization_expired'),'policy_version','g4-handoff-execution-lease-2026-08-26','serviceos_mutation_authorized',false); end if;
  v_raw_token:=pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  v_token_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_raw_token,'UTF8'),'sha256'),'hex');
  insert into growth.serviceos_handoff_execution_lease(organization_id,business_unit_id,jurisdiction_id,authorization_id,plan_id,reservation_id,handoff_candidate_id,object_plan_hash,lease_token_hash,lease_status,issued_at,expires_at,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_auth.id,v_auth.plan_id,v_auth.reservation_id,v_auth.handoff_candidate_id,v_auth.object_plan_hash,v_token_hash,'issued',now(),v_exp,jsonb_build_object('single_use',true,'policy_version','g4-handoff-execution-lease-2026-08-26')) returning id into v_id;
  return jsonb_build_object('status','LEASE_ISSUED','lease_id',v_id,'authorization_id',v_auth.id,'plan_id',v_auth.plan_id,'object_plan_hash',v_auth.object_plan_hash,'expires_at',v_exp,'execution_token',v_raw_token,'policy_version','g4-handoff-execution-lease-2026-08-26','serviceos_mutation_authorized',false);
end;
$$;
create or replace function public.growth_g4_revoke_serviceos_handoff_execution_lease(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_lease_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_lease growth.serviceos_handoff_execution_lease%rowtype;
begin
  select * into v_lease from growth.serviceos_handoff_execution_lease l where l.id=p_lease_id;
  if v_lease.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_found'),'serviceos_mutation_authorized',false); end if;
  if v_lease.organization_id<>p_organization_id or v_lease.business_unit_id<>p_business_unit_id or v_lease.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_scope_mismatch'),'serviceos_mutation_authorized',false); end if;
  if v_lease.lease_status='revoked' then return jsonb_build_object('status','REVOKED','lease_id',v_lease.id,'idempotent_replay',true,'serviceos_mutation_authorized',false); end if;
  if v_lease.lease_status<>'issued' then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('lease_not_revocable'),'lease_id',v_lease.id,'serviceos_mutation_authorized',false); end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('revocation_reason_required'),'serviceos_mutation_authorized',false); end if;
  update growth.serviceos_handoff_execution_lease set lease_status='revoked',metadata=metadata||jsonb_build_object('revocation_reason',btrim(p_reason),'revoked_at',now()) where id=v_lease.id;
  return jsonb_build_object('status','REVOKED','lease_id',v_lease.id,'idempotent_replay',false,'serviceos_mutation_authorized',false);
end;
$$;
revoke execute on function public.growth_g4_issue_serviceos_handoff_execution_lease(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.growth_g4_revoke_serviceos_handoff_execution_lease(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g4_issue_serviceos_handoff_execution_lease(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.growth_g4_revoke_serviceos_handoff_execution_lease(uuid,uuid,uuid,uuid,text) to service_role;
