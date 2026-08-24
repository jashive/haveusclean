create table if not exists growth.provider_adapter_contract (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  jurisdiction_id uuid not null,
  provider_code text not null,
  channel text not null check (channel='email'),
  contract_version text not null,
  contract_status text not null check (contract_status in ('approved_contract_only','suspended','revoked')),
  supports_idempotency boolean not null,
  supports_provider_message_id boolean not null,
  supports_delivery_events boolean not null,
  supports_unsubscribe boolean not null,
  credentials_state text not null default 'absent' check (credentials_state='absent'),
  approved_by_app_user_id uuid not null references public.app_user(id),
  approved_at timestamptz not null default now(),
  valid_until timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id,business_unit_id,jurisdiction_id,provider_code,channel,contract_version)
);

create table if not exists growth.outreach_submission_reservation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  jurisdiction_id uuid not null,
  outreach_attempt_id uuid not null references growth.outreach_attempt(id) on delete restrict,
  sender_identity_id uuid not null references growth.sender_identity(id) on delete restrict,
  provider_adapter_contract_id uuid not null references growth.provider_adapter_contract(id) on delete restrict,
  provider_code text not null,
  envelope_version text not null,
  sender_hash text not null check (sender_hash ~ '^[0-9a-f]{64}$'),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  envelope_hash text not null check (envelope_hash ~ '^[0-9a-f]{64}$'),
  submission_key text not null unique check (submission_key ~ '^[0-9a-f]{64}$'),
  envelope jsonb not null,
  reservation_status text not null default 'reserved' check (reservation_status='reserved'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (outreach_attempt_id)
);

create index if not exists provider_adapter_contract_scope_idx on growth.provider_adapter_contract(organization_id,business_unit_id,jurisdiction_id,provider_code,channel,created_at desc);
create index if not exists outreach_submission_reservation_sender_idx on growth.outreach_submission_reservation(sender_identity_id,created_at desc);

alter table growth.provider_adapter_contract enable row level security;
alter table growth.outreach_submission_reservation enable row level security;

revoke all on growth.provider_adapter_contract from public,anon,authenticated,service_role;
revoke all on growth.outreach_submission_reservation from public,anon,authenticated,service_role;
grant select on growth.provider_adapter_contract to service_role;
grant select on growth.outreach_submission_reservation to service_role;

create or replace function public.growth_g2_provider_contract_immutable_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'growth_g2: provider adapter contracts are immutable; register a new contract version';
end;
$$;

create or replace function public.growth_g2_submission_reservation_immutable_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'growth_g2: submission reservations are immutable';
end;
$$;

drop trigger if exists trg_growth_g2_provider_contract_immutable on growth.provider_adapter_contract;
create trigger trg_growth_g2_provider_contract_immutable before update or delete on growth.provider_adapter_contract for each row execute function public.growth_g2_provider_contract_immutable_guard();

drop trigger if exists trg_growth_g2_submission_reservation_immutable on growth.outreach_submission_reservation;
create trigger trg_growth_g2_submission_reservation_immutable before update or delete on growth.outreach_submission_reservation for each row execute function public.growth_g2_submission_reservation_immutable_guard();

create or replace function public.growth_g2_register_provider_adapter_contract(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_provider_code text,p_contract_version text,
  p_supports_idempotency boolean,p_supports_provider_message_id boolean,p_supports_delivery_events boolean,p_supports_unsubscribe boolean,
  p_reviewer_app_user_id uuid,p_valid_until timestamptz,p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_provider_code,'')),'') is null then raise exception 'growth_g2: provider code required'; end if;
  if nullif(btrim(coalesce(p_contract_version,'')),'') is null then raise exception 'growth_g2: contract version required'; end if;
  if p_reviewer_app_user_id is null or not exists(select 1 from public.app_user u where u.id=p_reviewer_app_user_id) then raise exception 'growth_g2: human reviewer required'; end if;
  if p_valid_until is null or p_valid_until<=now() then raise exception 'growth_g2: future contract expiry required'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: provider contract scope mismatch'; end if;
  select c.id into v_id from growth.provider_adapter_contract c where c.organization_id=p_organization_id and c.business_unit_id=p_business_unit_id and c.jurisdiction_id=p_jurisdiction_id and c.provider_code=lower(btrim(p_provider_code)) and c.channel='email' and c.contract_version=btrim(p_contract_version);
  if v_id is not null then return v_id; end if;
  insert into growth.provider_adapter_contract(organization_id,business_unit_id,jurisdiction_id,provider_code,channel,contract_version,contract_status,supports_idempotency,supports_provider_message_id,supports_delivery_events,supports_unsubscribe,credentials_state,approved_by_app_user_id,approved_at,valid_until,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,lower(btrim(p_provider_code)),'email',btrim(p_contract_version),'approved_contract_only',p_supports_idempotency,p_supports_provider_message_id,p_supports_delivery_events,p_supports_unsubscribe,'absent',p_reviewer_app_user_id,now(),p_valid_until,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,null,'g2_provider_adapter_contract_registered','growth_g2',jsonb_build_object('provider_adapter_contract_id',v_id,'provider_code',lower(btrim(p_provider_code)),'contract_version',btrim(p_contract_version),'credentials_state','absent'));
  return v_id;
end;
$$;

create or replace function public.growth_g2_reserve_submission_preflight(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_outreach_attempt_id uuid,p_provider_code text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_attempt growth.outreach_attempt%rowtype;
  v_approval growth.outreach_approval%rowtype;
  v_basis growth.legal_basis_evidence%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_sender growth.sender_identity%rowtype;
  v_contract growth.provider_adapter_contract%rowtype;
  v_existing growth.outreach_submission_reservation%rowtype;
  v_sender_ready jsonb;
  v_blockers text[]:=array[]::text[];
  v_envelope jsonb;
  v_sender_hash text;
  v_recipient_hash text;
  v_content_hash text;
  v_envelope_hash text;
  v_submission_key text;
  v_reservation_id uuid;
  v_email text;
begin
  if nullif(btrim(coalesce(p_provider_code,'')),'') is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('provider_code_missing'),'policy_version','g2-provider-preflight-2026-08-23'); end if;
  select * into v_attempt from growth.outreach_attempt a where a.id=p_outreach_attempt_id;
  if v_attempt.id is null then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('attempt_not_found'),'policy_version','g2-provider-preflight-2026-08-23'); end if;
  if v_attempt.organization_id<>p_organization_id or v_attempt.business_unit_id<>p_business_unit_id or v_attempt.jurisdiction_id<>p_jurisdiction_id then return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('attempt_scope_mismatch'),'policy_version','g2-provider-preflight-2026-08-23'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'growth_layer_disabled'); end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then v_blockers:=array_append(v_blockers,'outreach_gate_disabled'); end if;
  if v_attempt.channel<>'email' then v_blockers:=array_append(v_blockers,'unsupported_channel'); end if;
  if v_attempt.attempt_status<>'created' or v_attempt.provider is not null or v_attempt.provider_message_id is not null or v_attempt.submitted_at is not null then v_blockers:=array_append(v_blockers,'attempt_not_pristine'); end if;
  if coalesce((v_attempt.metadata->>'non_sending')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'attempt_not_non_sending'); end if;
  select * into v_approval from growth.outreach_approval a where a.id=v_attempt.outreach_approval_id;
  if v_approval.id is null or v_approval.organization_id<>p_organization_id or v_approval.business_unit_id<>p_business_unit_id or v_approval.jurisdiction_id<>p_jurisdiction_id or v_approval.prospect_id<>v_attempt.prospect_id or v_approval.contact_candidate_id<>v_attempt.contact_candidate_id or v_approval.channel<>'email' or v_approval.approval_status<>'approved' or v_approval.approved_by_app_user_id is null or v_approval.approved_at is null or v_approval.expires_at is null or v_approval.expires_at<=now() then v_blockers:=array_append(v_blockers,'current_human_approval_required'); end if;
  if nullif(btrim(coalesce(v_approval.approved_subject,'')),'') is null or nullif(btrim(coalesce(v_approval.approved_body,'')),'') is null then v_blockers:=array_append(v_blockers,'approved_content_missing'); end if;
  if coalesce((v_approval.metadata->>'postal_address_confirmed')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'postal_address_confirmation_missing'); end if;
  if coalesce((v_approval.metadata->>'unsubscribe_mechanism_confirmed')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'unsubscribe_mechanism_confirmation_missing'); end if;
  select * into v_sender from growth.sender_identity s where s.id=v_attempt.sender_identity_id;
  if v_sender.id is null or v_sender.organization_id<>p_organization_id or v_sender.business_unit_id<>p_business_unit_id or v_sender.jurisdiction_id<>p_jurisdiction_id then v_blockers:=array_append(v_blockers,'sender_scope_mismatch'); else
    v_sender_ready:=public.growth_g2_evaluate_sender_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_sender.email_address);
    if coalesce((v_sender_ready->>'ready')::boolean,false) is not true then v_blockers:=array_append(v_blockers,'sender_not_ready'); end if;
    if lower(btrim(coalesce(v_approval.approved_sender_identity,'')))<>v_sender.email_address then v_blockers:=array_append(v_blockers,'approved_sender_mismatch'); end if;
  end if;
  select * into v_contact from growth.prospect_contact_candidate c where c.id=v_attempt.contact_candidate_id;
  if v_contact.id is null or v_contact.organization_id<>p_organization_id or v_contact.business_unit_id<>p_business_unit_id or v_contact.jurisdiction_id<>p_jurisdiction_id or v_contact.prospect_id<>v_attempt.prospect_id or v_contact.verification_status<>'verified' or v_contact.review_status<>'accepted' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then v_blockers:=array_append(v_blockers,'verified_accepted_recipient_required'); end if;
  v_email:=lower(btrim(coalesce(v_contact.email,'')));
  select * into v_basis from growth.legal_basis_evidence e where e.id=v_approval.legal_basis_evidence_id;
  if v_basis.id is null or v_basis.organization_id<>p_organization_id or v_basis.business_unit_id<>p_business_unit_id or v_basis.jurisdiction_id<>p_jurisdiction_id or v_basis.prospect_id<>v_attempt.prospect_id or v_basis.contact_candidate_id<>v_attempt.contact_candidate_id or v_basis.channel<>'email' or v_basis.evidence_status<>'accepted' or v_basis.valid_from>now() or (v_basis.valid_until is not null and v_basis.valid_until<=now()) then v_blockers:=array_append(v_blockers,'accepted_current_legal_basis_required'); end if;
  if exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email') and (s.prospect_id=v_attempt.prospect_id or (s.identity_type='email' and s.identity_value_normalized=v_email))) then v_blockers:=array_append(v_blockers,'active_suppression'); end if;
  if exists(select 1 from growth.outreach_event e where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id and e.prospect_id=v_attempt.prospect_id and e.contact_candidate_id=v_attempt.contact_candidate_id and e.channel='email' and e.event_type='reply') then v_blockers:=array_append(v_blockers,'reply_received'); end if;
  select * into v_contract from growth.provider_adapter_contract c where c.organization_id=p_organization_id and c.business_unit_id=p_business_unit_id and c.jurisdiction_id=p_jurisdiction_id and c.provider_code=lower(btrim(p_provider_code)) and c.channel='email' order by c.created_at desc limit 1;
  if v_contract.id is null then v_blockers:=array_append(v_blockers,'provider_contract_missing'); else
    if v_contract.contract_status<>'approved_contract_only' then v_blockers:=array_append(v_blockers,'provider_contract_not_approved'); end if;
    if v_contract.valid_until<=now() then v_blockers:=array_append(v_blockers,'provider_contract_expired'); end if;
    if not v_contract.supports_idempotency then v_blockers:=array_append(v_blockers,'provider_idempotency_unsupported'); end if;
    if not v_contract.supports_provider_message_id then v_blockers:=array_append(v_blockers,'provider_message_id_unsupported'); end if;
    if not v_contract.supports_delivery_events then v_blockers:=array_append(v_blockers,'provider_delivery_events_unsupported'); end if;
    if not v_contract.supports_unsubscribe then v_blockers:=array_append(v_blockers,'provider_unsubscribe_unsupported'); end if;
    if v_contract.credentials_state<>'absent' then v_blockers:=array_append(v_blockers,'provider_credentials_not_authorized'); end if;
  end if;
  if cardinality(v_blockers)>0 then return jsonb_build_object('status','BLOCKED','blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-provider-preflight-2026-08-23','outreach_attempt_id',v_attempt.id); end if;
  v_sender_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_sender.email_address,'UTF8'),'sha256'),'hex');
  v_recipient_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_email,'UTF8'),'sha256'),'hex');
  v_content_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_approval.approved_subject||E'\n'||v_approval.approved_body,'UTF8'),'sha256'),'hex');
  v_envelope:=jsonb_build_object('envelope_version','g2-provider-envelope-2026-08-23','organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,'outreach_attempt_id',v_attempt.id,'sender_identity_id',v_sender.id,'from',v_sender.email_address,'to',v_email,'subject',v_approval.approved_subject,'body',v_approval.approved_body,'provider_code',v_contract.provider_code,'provider_contract_version',v_contract.contract_version,'unsubscribe_required',true,'non_sending_preflight',true);
  v_envelope_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_envelope::text,'UTF8'),'sha256'),'hex');
  v_submission_key:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_organization_id::text||'|'||p_business_unit_id::text||'|'||p_jurisdiction_id::text||'|'||v_attempt.id::text||'|'||v_sender_hash||'|'||v_recipient_hash||'|'||v_content_hash||'|'||v_contract.provider_code||'|'||v_contract.contract_version,'UTF8'),'sha256'),'hex');
  select * into v_existing from growth.outreach_submission_reservation r where r.outreach_attempt_id=v_attempt.id;
  if v_existing.id is not null then
    if v_existing.submission_key=v_submission_key and v_existing.envelope_hash=v_envelope_hash and v_existing.provider_code=v_contract.provider_code then return jsonb_build_object('status','READY_EXCEPT_PROVIDER','blocking_reasons','[]'::jsonb,'policy_version','g2-provider-preflight-2026-08-23','reservation_id',v_existing.id,'submission_key',v_existing.submission_key,'sender_hash',v_existing.sender_hash,'recipient_hash',v_existing.recipient_hash,'content_hash',v_existing.content_hash,'envelope_hash',v_existing.envelope_hash,'provider_credentials_state','absent'); end if;
    return jsonb_build_object('status','BLOCKED','blocking_reasons',jsonb_build_array('submission_reservation_conflict'),'policy_version','g2-provider-preflight-2026-08-23','reservation_id',v_existing.id);
  end if;
  insert into growth.outreach_submission_reservation(organization_id,business_unit_id,jurisdiction_id,outreach_attempt_id,sender_identity_id,provider_adapter_contract_id,provider_code,envelope_version,sender_hash,recipient_hash,content_hash,envelope_hash,submission_key,envelope,reservation_status,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_attempt.id,v_sender.id,v_contract.id,v_contract.provider_code,'g2-provider-envelope-2026-08-23',v_sender_hash,v_recipient_hash,v_content_hash,v_envelope_hash,v_submission_key,v_envelope,'reserved',jsonb_build_object('non_sending',true,'credentials_state','absent','preflight_policy','g2-provider-preflight-2026-08-23')) returning id into v_reservation_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,v_attempt.prospect_id,'g2_submission_preflight_reserved','growth_g2',jsonb_build_object('reservation_id',v_reservation_id,'outreach_attempt_id',v_attempt.id,'provider_code',v_contract.provider_code,'submission_key',v_submission_key,'envelope_hash',v_envelope_hash,'status','READY_EXCEPT_PROVIDER'));
  return jsonb_build_object('status','READY_EXCEPT_PROVIDER','blocking_reasons','[]'::jsonb,'policy_version','g2-provider-preflight-2026-08-23','reservation_id',v_reservation_id,'submission_key',v_submission_key,'sender_hash',v_sender_hash,'recipient_hash',v_recipient_hash,'content_hash',v_content_hash,'envelope_hash',v_envelope_hash,'provider_credentials_state','absent');
end;
$$;

revoke execute on function public.growth_g2_provider_contract_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_submission_reservation_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_register_provider_adapter_contract(uuid,uuid,uuid,text,text,boolean,boolean,boolean,boolean,uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_reserve_submission_preflight(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g2_register_provider_adapter_contract(uuid,uuid,uuid,text,text,boolean,boolean,boolean,boolean,uuid,timestamptz,jsonb) to service_role;
grant execute on function public.growth_g2_reserve_submission_preflight(uuid,uuid,uuid,uuid,text) to service_role;
