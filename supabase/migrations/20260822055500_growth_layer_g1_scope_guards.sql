-- Growth Layer 1.0 / Milestone G1 scope hardening.
-- Prevents cross-organization, cross-business-unit, and cross-jurisdiction prospect contamination.

begin;

create or replace function growth.assert_prospect_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bu_org uuid;
  v_bu_jur uuid;
  v_country text;
  v_subdivision text;
begin
  select bu.organization_id, bu.jurisdiction_id
    into v_bu_org, v_bu_jur
  from public.business_unit bu
  where bu.id = new.business_unit_id;

  if v_bu_org is null then
    raise exception 'growth prospect: unknown business_unit_id';
  end if;
  if v_bu_org <> new.organization_id then
    raise exception 'growth prospect: business unit organization mismatch';
  end if;
  if v_bu_jur is distinct from new.jurisdiction_id then
    raise exception 'growth prospect: business unit jurisdiction mismatch';
  end if;

  select j.country_code, j.subdivision_code
    into v_country, v_subdivision
  from public.jurisdiction j
  where j.id = new.jurisdiction_id;

  if v_country is null then
    raise exception 'growth prospect: unknown jurisdiction_id';
  end if;
  if upper(v_country) <> upper(new.country_code) then
    raise exception 'growth prospect: country does not match jurisdiction';
  end if;
  if new.subdivision_code is not null and v_subdivision is not null
     and upper(v_subdivision) <> upper(new.subdivision_code) then
    raise exception 'growth prospect: subdivision does not match jurisdiction';
  end if;

  return new;
end;
$$;

create or replace function growth.assert_child_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p_org uuid;
  p_bu uuid;
  p_jur uuid;
begin
  select p.organization_id, p.business_unit_id, p.jurisdiction_id
    into p_org, p_bu, p_jur
  from growth.prospect p
  where p.id = new.prospect_id;

  if p_org is null then
    raise exception 'growth child: unknown prospect_id';
  end if;
  if new.organization_id <> p_org then
    raise exception 'growth child: organization mismatch';
  end if;

  if tg_table_name in ('prospect_contact_candidate', 'handoff_candidate') then
    if new.business_unit_id <> p_bu then
      raise exception 'growth child: business unit mismatch';
    end if;
    if new.jurisdiction_id <> p_jur then
      raise exception 'growth child: jurisdiction mismatch';
    end if;
  end if;

  return new;
end;
$$;

create or replace function growth.assert_suppression_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p_org uuid;
  p_jur uuid;
begin
  if new.prospect_id is not null then
    select p.organization_id, p.jurisdiction_id into p_org, p_jur
    from growth.prospect p where p.id = new.prospect_id;
    if p_org is null then
      raise exception 'growth suppression: unknown prospect_id';
    end if;
    if new.organization_id <> p_org or new.jurisdiction_id <> p_jur then
      raise exception 'growth suppression: prospect scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function growth.assert_prospect_scope() from public, anon, authenticated;
revoke all on function growth.assert_child_scope() from public, anon, authenticated;
revoke all on function growth.assert_suppression_scope() from public, anon, authenticated;
grant execute on function growth.assert_prospect_scope() to service_role;
grant execute on function growth.assert_child_scope() to service_role;
grant execute on function growth.assert_suppression_scope() to service_role;

drop trigger if exists growth_prospect_scope_guard on growth.prospect;
create trigger growth_prospect_scope_guard
before insert or update of organization_id, business_unit_id, jurisdiction_id, country_code, subdivision_code
on growth.prospect
for each row execute function growth.assert_prospect_scope();

drop trigger if exists growth_contact_scope_guard on growth.prospect_contact_candidate;
create trigger growth_contact_scope_guard
before insert or update of prospect_id, organization_id, business_unit_id, jurisdiction_id
on growth.prospect_contact_candidate
for each row execute function growth.assert_child_scope();

drop trigger if exists growth_score_scope_guard on growth.prospect_score;
create trigger growth_score_scope_guard
before insert or update of prospect_id, organization_id
on growth.prospect_score
for each row execute function growth.assert_child_scope();

drop trigger if exists growth_evidence_scope_guard on growth.enrichment_evidence;
create trigger growth_evidence_scope_guard
before insert or update of prospect_id, organization_id
on growth.enrichment_evidence
for each row execute function growth.assert_child_scope();

drop trigger if exists growth_handoff_scope_guard on growth.handoff_candidate;
create trigger growth_handoff_scope_guard
before insert or update of prospect_id, organization_id, business_unit_id, jurisdiction_id
on growth.handoff_candidate
for each row execute function growth.assert_child_scope();

drop trigger if exists growth_suppression_scope_guard on growth.suppression;
create trigger growth_suppression_scope_guard
before insert or update of prospect_id, organization_id, jurisdiction_id
on growth.suppression
for each row execute function growth.assert_suppression_scope();

commit;
