-- Growth Layer 1.0 / G1 review hardening.
-- Additive correction only. Keeps Growth private, acceptance-safe, and downstream gates unchanged.

begin;

create or replace function public.growth_g1_assert_target_scope(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_prospect_id uuid default null,
  p_duplicate_review_id uuid default null,
  p_contact_candidate_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_organization_id is null or p_business_unit_id is null then
    raise exception 'growth target scope: organization and business unit are required';
  end if;

  if p_prospect_id is not null then
    select count(*) into v_count
    from growth.prospect
    where id = p_prospect_id
      and organization_id = p_organization_id
      and business_unit_id = p_business_unit_id;
    if v_count <> 1 then
      raise exception 'growth target scope: prospect is outside authorized business unit';
    end if;
  end if;

  if p_duplicate_review_id is not null then
    select count(*) into v_count
    from growth.duplicate_review
    where id = p_duplicate_review_id
      and organization_id = p_organization_id
      and business_unit_id = p_business_unit_id;
    if v_count <> 1 then
      raise exception 'growth target scope: duplicate review is outside authorized business unit';
    end if;
  end if;

  if p_contact_candidate_id is not null then
    select count(*) into v_count
    from growth.prospect_contact_candidate
    where id = p_contact_candidate_id
      and organization_id = p_organization_id
      and business_unit_id = p_business_unit_id;
    if v_count <> 1 then
      raise exception 'growth target scope: contact candidate is outside authorized business unit';
    end if;
  end if;

  if p_prospect_id is null and p_duplicate_review_id is null and p_contact_candidate_id is null then
    raise exception 'growth target scope: target identifier is required';
  end if;

  return true;
end;
$$;

revoke all on function public.growth_g1_assert_target_scope(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.growth_g1_assert_target_scope(uuid,uuid,uuid,uuid,uuid) to service_role;

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
  v_previous_applied_value jsonb;
  v_replacement_value jsonb;
  v_is_inferred boolean;
  v_evidence_type text;
  v_evidence_field text;
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

  select field_name, field_value, is_inferred, evidence_type, source_label, source_url
    into v_evidence_field, v_value, v_is_inferred, v_evidence_type, v_source_label, v_source_url
  from growth.enrichment_evidence
  where id = p_evidence_id
    and prospect_id = p_prospect_id
    and organization_id = p_organization_id;

  if v_evidence_type is null then
    raise exception 'growth field resolution: evidence not found for prospect';
  end if;

  if v_evidence_field <> p_field_name then
    raise exception 'growth field resolution: evidence field does not match requested field';
  end if;

  if v_evidence_type <> 'manual_note' and v_source_label is null and v_source_url is null then
    raise exception 'growth field resolution: source provenance required';
  end if;

  if v_is_inferred and p_field_name not in ('facility_type','buyer_title_guess','service_need_summary') then
    raise exception 'growth field resolution: inferred evidence cannot update identity field';
  end if;

  select applied_value
    into v_previous_applied_value
  from growth.field_resolution
  where prospect_id = p_prospect_id
    and evidence_id = p_evidence_id
    and field_name = p_field_name;

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
    v_replacement_value := v_value;
  else
    select applied_value into v_replacement_value
    from growth.field_resolution
    where prospect_id = p_prospect_id
      and field_name = p_field_name
      and decision = 'accepted'
      and evidence_id <> p_evidence_id
      and applied_value is not null
    order by decided_at desc, created_at desc
    limit 1;
  end if;

  if p_decision = 'accept' or v_previous_applied_value is not null then
    case p_field_name
      when 'website' then update growth.prospect set website = v_replacement_value #>> '{}' where id = p_prospect_id;
      when 'normalized_domain' then update growth.prospect set normalized_domain = case when v_replacement_value is null then null else lower(v_replacement_value #>> '{}') end where id = p_prospect_id;
      when 'phone' then update growth.prospect set phone = case when v_replacement_value is null then null else regexp_replace(v_replacement_value #>> '{}', '\D', '', 'g') end where id = p_prospect_id;
      when 'address_line1' then update growth.prospect set address_line1 = v_replacement_value #>> '{}' where id = p_prospect_id;
      when 'postal_code' then update growth.prospect set postal_code = v_replacement_value #>> '{}' where id = p_prospect_id;
      when 'facility_type' then update growth.prospect set facility_type = v_replacement_value #>> '{}' where id = p_prospect_id;
      when 'buyer_title_guess' then update growth.prospect set buyer_title_guess = v_replacement_value #>> '{}' where id = p_prospect_id;
      when 'service_need_summary' then update growth.prospect set service_need_summary = v_replacement_value #>> '{}' where id = p_prospect_id;
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
      'is_inferred', v_is_inferred,
      'replacement_applied', v_replacement_value is not null
    )
  );

  return v_id;
end;
$$;

revoke all on function public.growth_g1_resolve_field(uuid,uuid,text,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.growth_g1_resolve_field(uuid,uuid,text,uuid,text,uuid,text) to service_role;

commit;
