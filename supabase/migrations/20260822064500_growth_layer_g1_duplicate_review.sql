-- Growth Layer 1.0 / G1 duplicate review persistence.
-- Additive only. Duplicate classification remains Growth-owned pre-qualification metadata.

begin;

create table growth.duplicate_review (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  prospect_id uuid not null references growth.prospect(id) on delete cascade,
  matched_prospect_id uuid references growth.prospect(id) on delete set null,
  classification text not null,
  confidence numeric(5,4) not null,
  algorithm_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending',
  reviewer_app_user_id uuid references public.app_user(id),
  reviewed_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_duplicate_review_classification_ck check (classification in ('exact_duplicate','probable_duplicate','review_required','unique')),
  constraint growth_duplicate_review_confidence_ck check (confidence >= 0 and confidence <= 1),
  constraint growth_duplicate_review_status_ck check (review_status in ('pending','confirmed_duplicate','confirmed_unique','dismissed')),
  constraint growth_duplicate_review_no_self_match_ck check (matched_prospect_id is null or matched_prospect_id <> prospect_id),
  constraint growth_duplicate_review_match_ck check ((classification = 'unique' and matched_prospect_id is null) or classification <> 'unique')
);

create unique index growth_duplicate_review_one_pending_idx
  on growth.duplicate_review (prospect_id)
  where review_status = 'pending';

create index growth_duplicate_review_queue_idx
  on growth.duplicate_review (organization_id, business_unit_id, jurisdiction_id, review_status, classification, created_at);

create or replace function growth.assert_duplicate_review_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p_org uuid;
  p_bu uuid;
  p_jur uuid;
  m_org uuid;
  m_bu uuid;
  m_jur uuid;
begin
  select p.organization_id, p.business_unit_id, p.jurisdiction_id
    into p_org, p_bu, p_jur
  from growth.prospect p
  where p.id = new.prospect_id;

  if p_org is null then
    raise exception 'growth duplicate review: unknown prospect_id';
  end if;

  if new.organization_id <> p_org or new.business_unit_id <> p_bu or new.jurisdiction_id <> p_jur then
    raise exception 'growth duplicate review: prospect scope mismatch';
  end if;

  if new.matched_prospect_id is not null then
    select p.organization_id, p.business_unit_id, p.jurisdiction_id
      into m_org, m_bu, m_jur
    from growth.prospect p
    where p.id = new.matched_prospect_id;

    if m_org is null then
      raise exception 'growth duplicate review: unknown matched_prospect_id';
    end if;

    if m_org <> p_org or m_bu <> p_bu or m_jur <> p_jur then
      raise exception 'growth duplicate review: matched prospect scope mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function growth.assert_duplicate_review_scope() from public, anon, authenticated;
grant execute on function growth.assert_duplicate_review_scope() to service_role;

create trigger growth_duplicate_review_scope_guard
before insert or update of organization_id, business_unit_id, jurisdiction_id, prospect_id, matched_prospect_id
on growth.duplicate_review
for each row execute function growth.assert_duplicate_review_scope();

create trigger growth_duplicate_review_set_updated_at
before update on growth.duplicate_review
for each row execute function growth.set_updated_at();

alter table growth.duplicate_review enable row level security;
revoke all on growth.duplicate_review from public, anon, authenticated;
grant select, insert, update, delete on growth.duplicate_review to service_role;

commit;
