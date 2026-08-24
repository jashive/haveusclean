create table if not exists growth.legal_basis_evidence (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete cascade, contact_candidate_id uuid references growth.prospect_contact_candidate(id) on delete cascade,
  channel text not null check (channel in ('email','sms','phone')),
  basis_type text not null check (basis_type in ('express_consent','implied_consent_existing_business_relationship','implied_consent_conspicuously_published_business_contact','can_spam_commercial_email','inbound_request','other_documented_basis')),
  evidence_status text not null default 'pending' check (evidence_status in ('pending','accepted','rejected','expired','revoked')),
  evidence_source text not null, evidence_reference text, evidence_payload jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(), valid_until timestamptz, reviewed_by_app_user_id uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (valid_until is null or valid_until > valid_from)
);

create table if not exists growth.outreach_approval (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete cascade, contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete cascade,
  legal_basis_evidence_id uuid references growth.legal_basis_evidence(id), channel text not null check (channel in ('email','sms','phone')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','expired','revoked')),
  approved_subject text, approved_body text, approved_sender_identity text, approved_by_app_user_id uuid, approved_at timestamptz, expires_at timestamptz,
  idempotency_key text not null unique, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists growth.outreach_attempt (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete cascade, contact_candidate_id uuid not null references growth.prospect_contact_candidate(id) on delete cascade,
  outreach_approval_id uuid not null references growth.outreach_approval(id), channel text not null check (channel in ('email','sms','phone')),
  provider text, provider_message_id text, attempt_status text not null default 'created' check (attempt_status in ('created','submitted','delivered','failed','blocked','cancelled')),
  submitted_at timestamptz, created_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb, unique(provider, provider_message_id)
);

create table if not exists growth.outreach_event (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, business_unit_id uuid not null, jurisdiction_id uuid not null,
  prospect_id uuid not null references growth.prospect(id) on delete cascade, contact_candidate_id uuid references growth.prospect_contact_candidate(id) on delete set null,
  outreach_attempt_id uuid references growth.outreach_attempt(id) on delete set null, channel text not null check (channel in ('email','sms','phone')),
  event_type text not null check (event_type in ('submitted','delivered','bounce','complaint','unsubscribe','reply','failed','blocked','suppressed')),
  provider_event_id text, occurred_at timestamptz not null default now(), payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(provider_event_id)
);

create index if not exists legal_basis_evidence_scope_idx on growth.legal_basis_evidence(organization_id,business_unit_id,jurisdiction_id,prospect_id);
create index if not exists outreach_approval_scope_idx on growth.outreach_approval(organization_id,business_unit_id,jurisdiction_id,prospect_id);
create index if not exists outreach_attempt_scope_idx on growth.outreach_attempt(organization_id,business_unit_id,jurisdiction_id,prospect_id);
create index if not exists outreach_event_scope_idx on growth.outreach_event(organization_id,business_unit_id,jurisdiction_id,prospect_id,event_type,occurred_at desc);

alter table growth.legal_basis_evidence enable row level security; alter table growth.outreach_approval enable row level security;
alter table growth.outreach_attempt enable row level security; alter table growth.outreach_event enable row level security;
revoke all on growth.legal_basis_evidence from public, anon, authenticated; revoke all on growth.outreach_approval from public, anon, authenticated;
revoke all on growth.outreach_attempt from public, anon, authenticated; revoke all on growth.outreach_event from public, anon, authenticated;
grant select, insert, update, delete on growth.legal_basis_evidence to service_role; grant select, insert, update, delete on growth.outreach_approval to service_role;
grant select, insert, update, delete on growth.outreach_attempt to service_role; grant select, insert on growth.outreach_event to service_role;

create or replace function public.growth_g2_assert_target_scope(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ok boolean; begin
  select exists(select 1 from growth.prospect p where p.id=p_prospect_id and p.organization_id=p_organization_id and p.business_unit_id=p_business_unit_id and p.jurisdiction_id=p_jurisdiction_id) into v_ok;
  if not v_ok then raise exception 'growth_g2: prospect outside authorized scope'; end if;
  if p_contact_candidate_id is not null then
    select exists(select 1 from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id and c.prospect_id=p_prospect_id and c.organization_id=p_organization_id and c.business_unit_id=p_business_unit_id and c.jurisdiction_id=p_jurisdiction_id) into v_ok;
    if not v_ok then raise exception 'growth_g2: contact outside authorized scope'; end if;
  end if;
end; $$;

create or replace function public.growth_g2_record_legal_basis(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,p_channel text,p_basis_type text,p_evidence_source text,p_evidence_reference text default null,p_evidence_payload jsonb default '{}'::jsonb,p_valid_until timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_channel not in ('email','sms','phone') then raise exception 'growth_g2: unsupported channel'; end if;
  if p_basis_type not in ('express_consent','implied_consent_existing_business_relationship','implied_consent_conspicuously_published_business_contact','can_spam_commercial_email','inbound_request','other_documented_basis') then raise exception 'growth_g2: unsupported legal basis'; end if;
  insert into growth.legal_basis_evidence(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,basis_type,evidence_source,evidence_reference,evidence_payload,valid_until)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_channel,p_basis_type,p_evidence_source,p_evidence_reference,coalesce(p_evidence_payload,'{}'::jsonb),p_valid_until) returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_legal_basis_recorded','growth_g2',jsonb_build_object('legal_basis_evidence_id',v_id,'channel',p_channel,'basis_type',p_basis_type));
  return v_id;
end; $$;

create or replace function public.growth_g2_record_event(p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,p_outreach_attempt_id uuid,p_channel text,p_event_type text,p_provider_event_id text default null,p_occurred_at timestamptz default now(),p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_event_type not in ('submitted','delivered','bounce','complaint','unsubscribe','reply','failed','blocked','suppressed') then raise exception 'growth_g2: unsupported event type'; end if;
  insert into growth.outreach_event(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_attempt_id,channel,event_type,provider_event_id,occurred_at,payload)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_attempt_id,p_channel,p_event_type,p_provider_event_id,p_occurred_at,coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
  if p_event_type in ('bounce','complaint','unsubscribe','reply') and p_contact_candidate_id is not null then
    insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
    select p_organization_id,p_jurisdiction_id,p_prospect_id,p_channel,case when p_channel='email' then 'email' else 'phone' end,
      case when p_channel='email' then lower(trim(c.email)) else regexp_replace(coalesce(c.phone,''),'[^0-9+]','','g') end,
      p_event_type,'growth_g2_event',true,jsonb_build_object('outreach_event_id',v_id)
    from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id and ((p_channel='email' and c.email is not null) or (p_channel in ('sms','phone') and c.phone is not null));
  end if;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_outreach_event_recorded','growth_g2',jsonb_build_object('outreach_event_id',v_id,'event_type',p_event_type,'channel',p_channel));
  return v_id;
end; $$;

revoke execute on function public.growth_g2_assert_target_scope(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.growth_g2_record_legal_basis(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke execute on function public.growth_g2_record_event(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.growth_g2_assert_target_scope(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.growth_g2_record_legal_basis(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.growth_g2_record_event(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb) to service_role;
