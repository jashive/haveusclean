-- Growth Layer 1.0 / Milestone G1 foundation.
-- Additive only. This migration does not alter ServiceOS canonical Revenue lifecycle semantics.
-- Growth remains a private, server-side pre-qualification layer until governed ServiceOS handoff.

begin;

create schema if not exists growth;

revoke all on schema growth from public, anon, authenticated;
grant usage on schema growth to service_role;

create table growth.prospect (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  external_prospect_key text not null,
  lifecycle_status text not null default 'discovered',
  source_lane text not null,
  source_url text,
  source_record_id text,
  city text not null,
  subdivision_code text,
  country_code text not null,
  company_name text not null,
  normalized_company_name text,
  website text,
  normalized_domain text,
  phone text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  segment text not null,
  facility_type text,
  raw_notes text,
  verification_status text not null default 'unverified',
  duplicate_of_prospect_id uuid references growth.prospect(id),
  owner_app_user_id uuid references public.app_user(id),
  buyer_title_guess text,
  service_need_summary text,
  risk_flags jsonb not null default '[]'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  last_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_prospect_external_key_uk unique (organization_id, external_prospect_key),
  constraint growth_prospect_status_ck check (lifecycle_status in (
    'discovered','normalized','enriched','scored','review_ready','outreach_eligible',
    'sequenced','engaged','qualification_pending','handoff_ready','nurture',
    'suppressed','disqualified'
  )),
  constraint growth_prospect_verification_ck check (verification_status in ('unverified','partially_verified','verified','rejected')),
  constraint growth_prospect_country_ck check (country_code in ('CA','US')),
  constraint growth_prospect_company_ck check (btrim(company_name) <> ''),
  constraint growth_prospect_city_ck check (btrim(city) <> ''),
  constraint growth_prospect_segment_ck check (btrim(segment) <> ''),
  constraint growth_prospect_source_lane_ck check (btrim(source_lane) <> ''),
  constraint growth_prospect_no_self_duplicate_ck check (duplicate_of_prospect_id is null or duplicate_of_prospect_id <> id)
);

create index growth_prospect_queue_idx
  on growth.prospect (organization_id, business_unit_id, jurisdiction_id, lifecycle_status, created_at);
create index growth_prospect_domain_idx
  on growth.prospect (organization_id, normalized_domain)
  where normalized_domain is not null;
create index growth_prospect_company_city_idx
  on growth.prospect (organization_id, lower(normalized_company_name), lower(city))
  where normalized_company_name is not null;

create table growth.prospect_contact_candidate (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references growth.prospect(id) on delete cascade,
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  first_name text,
  last_name text,
  buyer_title text,
  email text,
  phone text,
  linkedin_url text,
  contact_source text,
  source_url text,
  verification_status text not null default 'unverified',
  is_primary_candidate boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_contact_verification_ck check (verification_status in ('unverified','partially_verified','verified','invalid')),
  constraint growth_contact_reachable_ck check (email is not null or phone is not null or linkedin_url is not null)
);

create index growth_contact_prospect_idx on growth.prospect_contact_candidate (prospect_id, is_primary_candidate desc, created_at);
create index growth_contact_email_idx on growth.prospect_contact_candidate (organization_id, lower(email)) where email is not null;
create index growth_contact_phone_idx on growth.prospect_contact_candidate (organization_id, phone) where phone is not null;

create table growth.enrichment_evidence (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references growth.prospect(id) on delete cascade,
  organization_id uuid not null references public.organization(id),
  evidence_type text not null,
  field_name text not null,
  field_value jsonb not null,
  source_label text,
  source_url text,
  observed_at timestamptz,
  confidence numeric(5,4),
  is_inferred boolean not null default false,
  model_or_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint growth_evidence_type_ck check (evidence_type in ('source_fact','contact_fact','facility_fact','market_fact','inference','manual_note')),
  constraint growth_evidence_confidence_ck check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint growth_evidence_inference_source_ck check (not is_inferred or model_or_agent is not null)
);

create index growth_evidence_prospect_idx on growth.enrichment_evidence (prospect_id, created_at);

create table growth.prospect_score (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references growth.prospect(id) on delete cascade,
  organization_id uuid not null references public.organization(id),
  score_version text not null,
  icp_fit_score numeric(5,2) not null default 0,
  data_quality_score numeric(5,2) not null default 0,
  contactability_score numeric(5,2) not null default 0,
  intent_score numeric(5,2) not null default 0,
  total_score numeric(5,2) not null,
  segment_fit text,
  rationale jsonb not null default '{}'::jsonb,
  scored_by text not null,
  scored_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  constraint growth_score_icp_ck check (icp_fit_score between 0 and 100),
  constraint growth_score_quality_ck check (data_quality_score between 0 and 100),
  constraint growth_score_contactability_ck check (contactability_score between 0 and 100),
  constraint growth_score_intent_ck check (intent_score between 0 and 100),
  constraint growth_score_total_ck check (total_score between 0 and 100)
);

create unique index growth_score_one_current_idx
  on growth.prospect_score (prospect_id)
  where is_current;
create index growth_score_rank_idx
  on growth.prospect_score (organization_id, total_score desc, scored_at desc)
  where is_current;

create table growth.suppression (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  prospect_id uuid references growth.prospect(id) on delete set null,
  channel text not null,
  identity_type text not null,
  identity_value_normalized text not null,
  reason text not null,
  source text not null,
  active boolean not null default true,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint growth_suppression_channel_ck check (channel in ('all','email','phone','sms','linkedin')),
  constraint growth_suppression_identity_ck check (identity_type in ('email','domain','phone','prospect','company')),
  constraint growth_suppression_reason_ck check (reason in ('opt_out','do_not_contact','hard_bounce','complaint','legal_hold','duplicate','invalid_contact','manual_suppression')),
  constraint growth_suppression_identity_value_ck check (btrim(identity_value_normalized) <> ''),
  constraint growth_suppression_expiry_ck check (expires_at is null or expires_at > effective_at)
);

create unique index growth_suppression_identity_uk
  on growth.suppression (organization_id, jurisdiction_id, channel, identity_type, identity_value_normalized)
  where active;

create table growth.handoff_candidate (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references growth.prospect(id),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  status text not null default 'draft',
  trigger_type text,
  qualified_by_app_user_id uuid references public.app_user(id),
  qualification_evidence jsonb not null default '{}'::jsonb,
  handoff_payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  serviceos_customer_id uuid references public.customer(id),
  serviceos_contact_id uuid references public.contact(id),
  serviceos_location_id uuid references public.service_location(id),
  serviceos_service_request_id uuid references public.service_request(id),
  serviceos_opportunity_id uuid references public.opportunity(id),
  attempt_count integer not null default 0,
  last_error text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_handoff_idempotency_uk unique (organization_id, idempotency_key),
  constraint growth_handoff_status_ck check (status in ('draft','ready','submitted','succeeded','failed','cancelled')),
  constraint growth_handoff_trigger_ck check (trigger_type is null or trigger_type in ('positive_reply','qualified_call','salesperson_manual')),
  constraint growth_handoff_attempt_ck check (attempt_count >= 0),
  constraint growth_handoff_success_ids_ck check (
    status <> 'succeeded' or (serviceos_service_request_id is not null and serviceos_opportunity_id is not null)
  )
);

create index growth_handoff_queue_idx on growth.handoff_candidate (organization_id, status, created_at);

create table growth.audit_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid references public.business_unit(id),
  prospect_id uuid references growth.prospect(id) on delete set null,
  actor_app_user_id uuid references public.app_user(id),
  event_type text not null,
  source_system text not null default 'growth_layer_1_0',
  correlation_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint growth_audit_event_type_ck check (btrim(event_type) <> '')
);

create index growth_audit_prospect_idx on growth.audit_event (prospect_id, occurred_at desc);
create index growth_audit_correlation_idx on growth.audit_event (correlation_id) where correlation_id is not null;

create or replace function growth.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function growth.set_updated_at() from public, anon, authenticated;
grant execute on function growth.set_updated_at() to service_role;

create trigger growth_prospect_set_updated_at
before update on growth.prospect
for each row execute function growth.set_updated_at();

create trigger growth_contact_set_updated_at
before update on growth.prospect_contact_candidate
for each row execute function growth.set_updated_at();

create trigger growth_handoff_set_updated_at
before update on growth.handoff_candidate
for each row execute function growth.set_updated_at();

alter table growth.prospect enable row level security;
alter table growth.prospect_contact_candidate enable row level security;
alter table growth.enrichment_evidence enable row level security;
alter table growth.prospect_score enable row level security;
alter table growth.suppression enable row level security;
alter table growth.handoff_candidate enable row level security;
alter table growth.audit_event enable row level security;

revoke all on all tables in schema growth from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema growth to service_role;

alter default privileges in schema growth revoke all on tables from public, anon, authenticated;
alter default privileges in schema growth grant select, insert, update, delete on tables to service_role;
alter default privileges in schema growth revoke all on functions from public, anon, authenticated;
alter default privileges in schema growth grant execute on functions to service_role;

comment on schema growth is 'Have Us Clean Growth Layer 1.0 private pre-qualification prospecting domain; ServiceOS remains canonical Revenue system of record.';
comment on table growth.prospect is 'Cold/unqualified prospect queue only. Must not be treated as ServiceOS customer, service_request, or opportunity.';
comment on table growth.handoff_candidate is 'Governed adapter queue linking qualified Growth prospects to canonical ServiceOS Revenue records.';

commit;
