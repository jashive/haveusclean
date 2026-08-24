-- Growth Layer 1.0 / G1 field-level provenance and human review actions.
-- Acceptance-safe, additive, and does not activate outreach or ServiceOS handoff.

begin;

alter table growth.prospect_contact_candidate
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewer_app_user_id uuid references public.app_user(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

alter table growth.prospect_contact_candidate
  drop constraint if exists growth_contact_review_status_ck;
alter table growth.prospect_contact_candidate
  add constraint growth_contact_review_status_ck
  check (review_status in ('pending','accepted','rejected'));

create table if not exists growth.field_resolution (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  prospect_id uuid not null references growth.prospect(id) on delete cascade,
  evidence_id uuid not null references growth.enrichment_evidence(id) on delete restrict,
  field_name text not null,
  decision text not null,
  applied_value jsonb,
  is_inferred boolean not null default false,
  reviewer_app_user_id uuid references public.app_user(id),
  decision_notes text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint growth_field_resolution_field_ck check (field_name in (
    'website','normalized_domain','phone','address_line1','postal_code',
    'facility_type','buyer_title_guess','service_need_summary'
  )),
  constraint growth_field_resolution_decision_ck check (decision in ('accepted','rejected'))
);

create unique index if not exists growth_field_resolution_current_decision_idx
  on growth.field_resolution (prospect_id, evidence_id, field_name);
create index if not exists growth_field_resolution_prospect_idx
  on growth.field_resolution (prospect_id, decided_at desc);

create or replace function growth.assert_field_resolution_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p_org uuid;
  p_bu uuid;
  p_jur uuid;
  e_org uuid;
  e_prospect uuid;
begin
  select organization_id, business_unit_id, jurisdiction_id
    into p_org, p_bu, p_jur
  from growth.prospect
  where id = new.prospect_id;

  if p_org is null then
    raise exception 'growth field resolution: unknown prospect_id';
  end if;

  if new.organization_id <> p_org or new.business_unit_id <> p_bu or new.jurisdiction_id <> p_jur then
    raise exception 'growth field resolution: prospect scope mismatch';
  end if;

  select organization_id, prospect_id
    into e_org, e_prospect
  from growth.enrichment_evidence
  where id = new.evidence_id;

  if e_org is null then
    raise exception 'growth field resolution: unknown evidence_id';
  end if;

  if e_org <> p_org or e_prospect <> new.prospect_id then
    raise exception 'growth field resolution: evidence scope mismatch';
  end if;

  return new;
end;
$$;

revoke all on function growth.assert_field_resolution_scope() from public, anon, authenticated;
grant execute on function growth.assert_field_resolution_scope() to service_role;

drop trigger if exists growth_field_resolution_scope_guard on growth.field_resolution;
create trigger growth_field_resolution_scope_guard
before insert or update of organization_id, business_unit_id, jurisdiction_id, prospect_id, evidence_id
on growth.field_resolution
for each row execute function growth.assert_field_resolution_scope();

alter table growth.field_resolution enable row level security;
revoke all on growth.field_resolution from public, anon, authenticated;
grant select, insert, update, delete on growth.field_resolution to service_role;

create or replace function public.growth_g1_resolve_field(
  p_prospect_id uuid,
  p_organization_id uuid,
  p_field_name text,
  p_evidence_id uuid,
  p_decision text,
  p_reviewer_app_user_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
  v_bu uuid;
  v_jur uuid;
  v_value jsonb;
  v_is_inferred boolean;
  v_evidence_type text;
  v_source_label text;
  v_source_url text;
begin
  if p_decision not in ('accept','reject') then
    raise exception 'growth field resolution: decision must be accept or reject';
  end if;

  if p_field_name not in (
    'website','normalized_domain','phone','address_line1','postal_code',
    'facility_type','buyer_title_guess','service_need_summary'
  ) then
    raise exception 'growth field resolution: unsupported field';
  end if;

  select organization_id, business_unit_id, jurisdiction_id
    into v_org, v_bu, v_jur
  from growth.prospect
  where id = p_prospect_id and organization_id = p_organization_id;

  if v_org is null then
    raise exception 'growth field resolution: prospect not found in organization';
  end if;

  select field_value, is_inferred, evidence_type, source_label, source_url
    into v_value, v_is_inferred, v_evidence_type, v_source_label, v_source_url
  from growth.enrichment_evidence
  where id = p_evidence_id
    and prospect_id = p_prospect_id
    and organization_id = p_organization_id;

  if v_evidence_type is null then
    raise exception 'growth field resolution: evidence not found for prospect';
  end if;

  if v_evidence_type <> 'manual_note' and v_source_label is null and v_source_url is null then
    raise exception 'growth field resolution: source provenance required';
  end if;

  if v_is_inferred and p_field_name not in ('facility_type','buyer_title_guess','service_need_summary') then
    raise exception 'growth field resolution: inferred evidence cannot update identity field';
  end if;

  insert into growth.field_resolution (
    organization_id, business_unit_id, jurisdiction_id, prospect_id,
    evidence_id, field_name, decision, applied_value, is_inferred,
    reviewer_app_user_id, decision_notes
  ) values (
    v_org, v_bu, v_jur, p_prospect_id,
    p_evidence_id, p_field_name,
    case when p_decision = 'accept' then 'accepted' else 'rejected' end,
    case when p_decision = 'accept' then v_value else null end,
    v_is_inferred, p_reviewer_app_user_id, nullif(p_notes,'')
  )
  on conflict (prospect_id, evidence_id, field_name)
  do update set
    decision = excluded.decision,
    applied_value = excluded.applied_value,
    is_inferred = excluded.is_inferred,
    reviewer_app_user_id = excluded.reviewer_app_user_id,
    decision_notes = excluded.decision_notes,
    decided_at = now()
  returning id into v_id;

  if p_decision = 'accept' then
    case p_field_name
      when 'website' then update growth.prospect set website = v_value #>> '{}' where id = p_prospect_id;
      when 'normalized_domain' then update growth.prospect set normalized_domain = lower(v_value #>> '{}') where id = p_prospect_id;
      when 'phone' then update growth.prospect set phone = regexp_replace(v_value #>> '{}', '\D', '', 'g') where id = p_prospect_id;
      when 'address_line1' then update growth.prospect set address_line1 = v_value #>> '{}' where id = p_prospect_id;
      when 'postal_code' then update growth.prospect set postal_code = v_value #>> '{}' where id = p_prospect_id;
      when 'facility_type' then update growth.prospect set facility_type = v_value #>> '{}' where id = p_prospect_id;
      when 'buyer_title_guess' then update growth.prospect set buyer_title_guess = v_value #>> '{}' where id = p_prospect_id;
      when 'service_need_summary' then update growth.prospect set service_need_summary = v_value #>> '{}' where id = p_prospect_id;
    end case;
  end if;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, actor_app_user_id, event_type, payload
  ) values (
    v_org, v_bu, p_prospect_id, p_reviewer_app_user_id,
    'enrichment_field_reviewed',
    jsonb_build_object(
      'field_resolution_id', v_id,
      'field_name', p_field_name,
      'evidence_id', p_evidence_id,
      'decision', p_decision,
      'is_inferred', v_is_inferred
    )
  );

  return v_id;
end;
$$;

create or replace function public.growth_g1_review_duplicate(
  p_duplicate_review_id uuid,
  p_organization_id uuid,
  p_decision text,
  p_reviewer_app_user_id uuid,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id uuid;
  v_match_id uuid;
  v_org uuid;
  v_bu uuid;
begin
  if p_decision not in ('confirm_duplicate','confirm_unique','dismiss') then
    raise exception 'growth duplicate review: invalid decision';
  end if;

  select prospect_id, matched_prospect_id, organization_id, business_unit_id
    into v_prospect_id, v_match_id, v_org, v_bu
  from growth.duplicate_review
  where id = p_duplicate_review_id
    and organization_id = p_organization_id
    and review_status = 'pending';

  if v_prospect_id is null then
    raise exception 'growth duplicate review: pending review not found';
  end if;

  if p_decision = 'confirm_duplicate' and v_match_id is null then
    raise exception 'growth duplicate review: matched prospect required to confirm duplicate';
  end if;

  update growth.duplicate_review
  set review_status = case
        when p_decision = 'confirm_duplicate' then 'confirmed_duplicate'
        when p_decision = 'confirm_unique' then 'confirmed_unique'
        else 'dismissed'
      end,
      reviewer_app_user_id = p_reviewer_app_user_id,
      reviewed_at = now(),
      decision_notes = nullif(p_notes,'')
  where id = p_duplicate_review_id;

  if p_decision = 'confirm_duplicate' then
    update growth.prospect
    set duplicate_of_prospect_id = v_match_id,
        lifecycle_status = 'suppressed',
        risk_flags = case
          when risk_flags @> '["duplicate"]'::jsonb then risk_flags
          else risk_flags || '["duplicate"]'::jsonb
        end
    where id = v_prospect_id;
  else
    update growth.prospect
    set duplicate_of_prospect_id = null,
        lifecycle_status = case when lifecycle_status = 'suppressed' then 'review_ready' else lifecycle_status end
    where id = v_prospect_id;
  end if;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, actor_app_user_id, event_type, payload
  ) values (
    v_org, v_bu, v_prospect_id, p_reviewer_app_user_id,
    'duplicate_review_completed',
    jsonb_build_object('duplicate_review_id', p_duplicate_review_id, 'decision', p_decision, 'matched_prospect_id', v_match_id)
  );

  return p_decision;
end;
$$;

create or replace function public.growth_g1_review_contact(
  p_contact_candidate_id uuid,
  p_organization_id uuid,
  p_decision text,
  p_reviewer_app_user_id uuid,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id uuid;
  v_org uuid;
  v_bu uuid;
begin
  if p_decision not in ('accept','reject') then
    raise exception 'growth contact review: decision must be accept or reject';
  end if;

  select prospect_id, organization_id, business_unit_id
    into v_prospect_id, v_org, v_bu
  from growth.prospect_contact_candidate
  where id = p_contact_candidate_id
    and organization_id = p_organization_id;

  if v_prospect_id is null then
    raise exception 'growth contact review: candidate not found';
  end if;

  if p_decision = 'accept' then
    update growth.prospect_contact_candidate
    set is_primary_candidate = false
    where prospect_id = v_prospect_id
      and id <> p_contact_candidate_id
      and is_primary_candidate;
  end if;

  update growth.prospect_contact_candidate
  set review_status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
      is_primary_candidate = (p_decision = 'accept'),
      reviewer_app_user_id = p_reviewer_app_user_id,
      reviewed_at = now(),
      review_notes = nullif(p_notes,'')
  where id = p_contact_candidate_id;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, actor_app_user_id, event_type, payload
  ) values (
    v_org, v_bu, v_prospect_id, p_reviewer_app_user_id,
    'contact_candidate_reviewed',
    jsonb_build_object('contact_candidate_id', p_contact_candidate_id, 'decision', p_decision)
  );

  return p_decision;
end;
$$;

create or replace function public.growth_g1_complete_review(
  p_prospect_id uuid,
  p_organization_id uuid,
  p_reviewer_app_user_id uuid,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bu uuid;
  v_pending_duplicates integer;
  v_confirmed_duplicates integer;
  v_accepted_contacts integer;
  v_current_scores integer;
  v_evidence integer;
begin
  select business_unit_id into v_bu
  from growth.prospect
  where id = p_prospect_id and organization_id = p_organization_id;

  if v_bu is null then
    raise exception 'growth review completion: prospect not found';
  end if;

  select count(*) into v_pending_duplicates
  from growth.duplicate_review
  where prospect_id = p_prospect_id and review_status = 'pending';

  select count(*) into v_confirmed_duplicates
  from growth.duplicate_review
  where prospect_id = p_prospect_id and review_status = 'confirmed_duplicate';

  select count(*) into v_accepted_contacts
  from growth.prospect_contact_candidate
  where prospect_id = p_prospect_id and review_status = 'accepted';

  select count(*) into v_current_scores
  from growth.prospect_score
  where prospect_id = p_prospect_id and is_current;

  select count(*) into v_evidence
  from growth.enrichment_evidence
  where prospect_id = p_prospect_id;

  if v_pending_duplicates > 0 then
    raise exception 'growth review completion: duplicate review remains pending';
  end if;
  if v_confirmed_duplicates > 0 then
    raise exception 'growth review completion: confirmed duplicate cannot complete review';
  end if;
  if v_accepted_contacts = 0 then
    raise exception 'growth review completion: accepted contact required';
  end if;
  if v_current_scores = 0 then
    raise exception 'growth review completion: current score required';
  end if;
  if v_evidence = 0 then
    raise exception 'growth review completion: enrichment evidence required';
  end if;

  update growth.prospect
  set lifecycle_status = 'review_ready'
  where id = p_prospect_id and organization_id = p_organization_id;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, actor_app_user_id, event_type, payload
  ) values (
    p_organization_id, v_bu, p_prospect_id, p_reviewer_app_user_id,
    'human_review_completed',
    jsonb_build_object('notes', nullif(p_notes,''), 'outreach_eligible', false)
  );

  return 'review_ready';
end;
$$;

revoke all on function public.growth_g1_resolve_field(uuid,uuid,text,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.growth_g1_review_duplicate(uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.growth_g1_review_contact(uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.growth_g1_complete_review(uuid,uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.growth_g1_resolve_field(uuid,uuid,text,uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g1_review_duplicate(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g1_review_contact(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g1_complete_review(uuid,uuid,uuid,text) to service_role;

comment on function public.growth_g1_resolve_field(uuid,uuid,text,uuid,text,uuid,text) is 'Service-role-only field-level enrichment provenance decision boundary.';
comment on function public.growth_g1_review_duplicate(uuid,uuid,text,uuid,text) is 'Service-role-only human duplicate review decision boundary.';
comment on function public.growth_g1_review_contact(uuid,uuid,text,uuid,text) is 'Service-role-only human contact candidate review decision boundary.';
comment on function public.growth_g1_complete_review(uuid,uuid,uuid,text) is 'Service-role-only human review completion; stops at review_ready and never activates outreach.';

commit;
