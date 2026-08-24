-- Growth Layer 1.0 / G1 contact candidate + review queue boundary.
-- Additive only. Growth remains private and service-role-only.

begin;

create unique index if not exists growth_contact_one_primary_idx
  on growth.prospect_contact_candidate (prospect_id)
  where is_primary_candidate;

create unique index if not exists growth_contact_email_per_prospect_idx
  on growth.prospect_contact_candidate (prospect_id, lower(email))
  where email is not null;

create unique index if not exists growth_contact_phone_per_prospect_idx
  on growth.prospect_contact_candidate (prospect_id, phone)
  where phone is not null;

create unique index if not exists growth_contact_linkedin_per_prospect_idx
  on growth.prospect_contact_candidate (prospect_id, lower(linkedin_url))
  where linkedin_url is not null;

create or replace function public.growth_g1_add_contact_candidate(
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_prospect_org uuid;
  v_prospect_bu uuid;
  v_prospect_jur uuid;
begin
  select organization_id, business_unit_id, jurisdiction_id
    into v_prospect_org, v_prospect_bu, v_prospect_jur
  from growth.prospect
  where id = (p_payload->>'prospect_id')::uuid;

  if v_prospect_org is null then
    raise exception 'growth contact candidate: unknown prospect_id';
  end if;

  if v_prospect_org <> (p_payload->>'organization_id')::uuid
     or v_prospect_bu <> (p_payload->>'business_unit_id')::uuid
     or v_prospect_jur <> (p_payload->>'jurisdiction_id')::uuid then
    raise exception 'growth contact candidate: prospect scope mismatch';
  end if;

  if coalesce((p_payload->>'is_primary_candidate')::boolean, false) then
    update growth.prospect_contact_candidate
    set is_primary_candidate = false
    where prospect_id = (p_payload->>'prospect_id')::uuid
      and is_primary_candidate;
  end if;

  insert into growth.prospect_contact_candidate (
    prospect_id, organization_id, business_unit_id, jurisdiction_id,
    first_name, last_name, buyer_title, email, phone, linkedin_url,
    contact_source, source_url, verification_status, is_primary_candidate,
    metadata
  ) values (
    (p_payload->>'prospect_id')::uuid,
    (p_payload->>'organization_id')::uuid,
    (p_payload->>'business_unit_id')::uuid,
    (p_payload->>'jurisdiction_id')::uuid,
    nullif(p_payload->>'first_name',''),
    nullif(p_payload->>'last_name',''),
    nullif(p_payload->>'buyer_title',''),
    lower(nullif(p_payload->>'email','')),
    nullif(regexp_replace(coalesce(p_payload->>'phone',''), '\D', '', 'g'), ''),
    nullif(p_payload->>'linkedin_url',''),
    nullif(p_payload->>'contact_source',''),
    nullif(p_payload->>'source_url',''),
    coalesce(nullif(p_payload->>'verification_status',''), 'unverified'),
    coalesce((p_payload->>'is_primary_candidate')::boolean, false),
    coalesce(p_payload->'metadata', '{}'::jsonb)
  ) returning id into v_id;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, event_type, payload
  ) values (
    v_prospect_org, v_prospect_bu, (p_payload->>'prospect_id')::uuid,
    'contact_candidate_added',
    jsonb_build_object(
      'contact_candidate_id', v_id,
      'verification_status', coalesce(nullif(p_payload->>'verification_status',''), 'unverified'),
      'has_email', nullif(p_payload->>'email','') is not null,
      'has_phone', nullif(p_payload->>'phone','') is not null,
      'has_linkedin', nullif(p_payload->>'linkedin_url','') is not null
    )
  );

  return v_id;
end;
$$;

create or replace function public.growth_g1_list_review_queue(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_limit integer default 100
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at asc), '[]'::jsonb)
  from (
    select
      p.id as prospect_id,
      p.organization_id,
      p.business_unit_id,
      p.jurisdiction_id,
      p.lifecycle_status,
      p.company_name,
      p.city,
      p.segment,
      p.normalized_domain,
      p.phone as company_phone,
      p.missing_fields,
      p.risk_flags,
      p.verification_status,
      p.created_at,
      s.total_score,
      s.score_version,
      c.id as primary_contact_candidate_id,
      c.first_name,
      c.last_name,
      c.buyer_title,
      c.email,
      c.phone as contact_phone,
      c.linkedin_url,
      c.verification_status as contact_verification_status,
      dr.id as duplicate_review_id,
      dr.classification as duplicate_classification,
      dr.confidence as duplicate_confidence,
      dr.review_status as duplicate_review_status,
      case
        when p.lifecycle_status = 'review_ready' then true
        when dr.review_status = 'pending' then true
        else false
      end as requires_human_review
    from growth.prospect p
    left join growth.prospect_score s
      on s.prospect_id = p.id and s.is_current
    left join growth.prospect_contact_candidate c
      on c.prospect_id = p.id and c.is_primary_candidate
    left join growth.duplicate_review dr
      on dr.prospect_id = p.id and dr.review_status = 'pending'
    where p.organization_id = p_organization_id
      and p.business_unit_id = p_business_unit_id
      and (
        p.lifecycle_status = 'review_ready'
        or dr.review_status = 'pending'
      )
    order by p.created_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) q;
$$;

revoke all on function public.growth_g1_add_contact_candidate(jsonb) from public, anon, authenticated;
revoke all on function public.growth_g1_list_review_queue(uuid,uuid,integer) from public, anon, authenticated;

grant execute on function public.growth_g1_add_contact_candidate(jsonb) to service_role;
grant execute on function public.growth_g1_list_review_queue(uuid,uuid,integer) to service_role;

comment on function public.growth_g1_add_contact_candidate(jsonb) is 'Service-role-only Growth G1 contact candidate boundary.';
comment on function public.growth_g1_list_review_queue(uuid,uuid,integer) is 'Service-role-only Growth G1 human review queue boundary.';

commit;
