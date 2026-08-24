-- Growth Layer 1.0 / Milestone G1 server boundary.
-- Narrow RPC surface for server-side automation/UI. Growth schema remains private.
-- Every function is revoked from PUBLIC/anon/authenticated and granted only to service_role.

begin;

create or replace function public.growth_g1_list_prospects(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
  from (
    select
      p.id, p.organization_id, p.business_unit_id, p.jurisdiction_id,
      p.external_prospect_key, p.lifecycle_status, p.source_lane, p.source_url,
      p.city, p.subdivision_code, p.country_code, p.company_name,
      p.normalized_company_name, p.website, p.normalized_domain, p.phone,
      p.segment, p.facility_type, p.verification_status, p.buyer_title_guess,
      p.service_need_summary, p.risk_flags, p.missing_fields,
      s.total_score, s.icp_fit_score, s.data_quality_score,
      s.contactability_score, s.intent_score, s.score_version,
      p.captured_at, p.last_enriched_at, p.created_at, p.updated_at
    from growth.prospect p
    left join growth.prospect_score s
      on s.prospect_id = p.id and s.is_current
    where p.organization_id = p_organization_id
      and p.business_unit_id = p_business_unit_id
      and (p_status is null or p.lifecycle_status = p_status)
    order by p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) q;
$$;

create or replace function public.growth_g1_create_prospect(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into growth.prospect (
    organization_id, business_unit_id, jurisdiction_id, external_prospect_key,
    lifecycle_status, source_lane, source_url, source_record_id,
    city, subdivision_code, country_code, company_name, normalized_company_name,
    website, normalized_domain, phone, address_line1, address_line2, postal_code,
    segment, facility_type, raw_notes, verification_status, owner_app_user_id,
    buyer_title_guess, service_need_summary, risk_flags, missing_fields, metadata,
    captured_at, last_enriched_at
  ) values (
    (p_payload->>'organization_id')::uuid,
    (p_payload->>'business_unit_id')::uuid,
    (p_payload->>'jurisdiction_id')::uuid,
    p_payload->>'external_prospect_key',
    coalesce(nullif(p_payload->>'lifecycle_status',''), 'discovered'),
    p_payload->>'source_lane',
    nullif(p_payload->>'source_url',''),
    nullif(p_payload->>'source_record_id',''),
    p_payload->>'city',
    nullif(p_payload->>'subdivision_code',''),
    upper(p_payload->>'country_code'),
    p_payload->>'company_name',
    nullif(p_payload->>'normalized_company_name',''),
    nullif(p_payload->>'website',''),
    lower(nullif(p_payload->>'normalized_domain','')),
    nullif(p_payload->>'phone',''),
    nullif(p_payload->>'address_line1',''),
    nullif(p_payload->>'address_line2',''),
    nullif(p_payload->>'postal_code',''),
    p_payload->>'segment',
    nullif(p_payload->>'facility_type',''),
    nullif(p_payload->>'raw_notes',''),
    coalesce(nullif(p_payload->>'verification_status',''), 'unverified'),
    nullif(p_payload->>'owner_app_user_id','')::uuid,
    nullif(p_payload->>'buyer_title_guess',''),
    nullif(p_payload->>'service_need_summary',''),
    coalesce(p_payload->'risk_flags', '[]'::jsonb),
    coalesce(p_payload->'missing_fields', '[]'::jsonb),
    coalesce(p_payload->'metadata', '{}'::jsonb),
    coalesce(nullif(p_payload->>'captured_at','')::timestamptz, now()),
    nullif(p_payload->>'last_enriched_at','')::timestamptz
  )
  returning id into v_id;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, actor_app_user_id,
    event_type, payload
  ) values (
    (p_payload->>'organization_id')::uuid,
    (p_payload->>'business_unit_id')::uuid,
    v_id,
    nullif(p_payload->>'owner_app_user_id','')::uuid,
    'prospect_created',
    jsonb_build_object('source_lane', p_payload->>'source_lane')
  );

  return v_id;
end;
$$;

create or replace function public.growth_g1_add_enrichment(
  p_prospect_id uuid,
  p_organization_id uuid,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into growth.enrichment_evidence (
    prospect_id, organization_id, evidence_type, field_name, field_value,
    source_label, source_url, observed_at, confidence, is_inferred,
    model_or_agent, metadata
  ) values (
    p_prospect_id, p_organization_id,
    p_evidence->>'evidence_type',
    p_evidence->>'field_name',
    coalesce(p_evidence->'field_value', 'null'::jsonb),
    nullif(p_evidence->>'source_label',''),
    nullif(p_evidence->>'source_url',''),
    nullif(p_evidence->>'observed_at','')::timestamptz,
    nullif(p_evidence->>'confidence','')::numeric,
    coalesce((p_evidence->>'is_inferred')::boolean, false),
    nullif(p_evidence->>'model_or_agent',''),
    coalesce(p_evidence->'metadata', '{}'::jsonb)
  ) returning id into v_id;

  update growth.prospect
  set last_enriched_at = now(),
      lifecycle_status = case
        when lifecycle_status in ('discovered','normalized') then 'enriched'
        else lifecycle_status
      end
  where id = p_prospect_id and organization_id = p_organization_id;

  insert into growth.audit_event (organization_id, prospect_id, event_type, payload)
  values (p_organization_id, p_prospect_id, 'enrichment_recorded', jsonb_build_object('evidence_id', v_id));

  return v_id;
end;
$$;

create or replace function public.growth_g1_record_score(
  p_prospect_id uuid,
  p_organization_id uuid,
  p_score jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update growth.prospect_score
  set is_current = false
  where prospect_id = p_prospect_id and organization_id = p_organization_id and is_current;

  insert into growth.prospect_score (
    prospect_id, organization_id, score_version, icp_fit_score,
    data_quality_score, contactability_score, intent_score, total_score,
    segment_fit, rationale, scored_by, is_current
  ) values (
    p_prospect_id, p_organization_id,
    p_score->>'score_version',
    coalesce((p_score->>'icp_fit_score')::numeric, 0),
    coalesce((p_score->>'data_quality_score')::numeric, 0),
    coalesce((p_score->>'contactability_score')::numeric, 0),
    coalesce((p_score->>'intent_score')::numeric, 0),
    (p_score->>'total_score')::numeric,
    nullif(p_score->>'segment_fit',''),
    coalesce(p_score->'rationale', '{}'::jsonb),
    p_score->>'scored_by',
    true
  ) returning id into v_id;

  update growth.prospect
  set lifecycle_status = case
        when lifecycle_status in ('discovered','normalized','enriched') then 'scored'
        else lifecycle_status
      end
  where id = p_prospect_id and organization_id = p_organization_id;

  insert into growth.audit_event (organization_id, prospect_id, event_type, payload)
  values (p_organization_id, p_prospect_id, 'prospect_scored', jsonb_build_object('score_id', v_id, 'score_version', p_score->>'score_version'));

  return v_id;
end;
$$;

revoke all on function public.growth_g1_list_prospects(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.growth_g1_create_prospect(jsonb) from public, anon, authenticated;
revoke all on function public.growth_g1_add_enrichment(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.growth_g1_record_score(uuid,uuid,jsonb) from public, anon, authenticated;

grant execute on function public.growth_g1_list_prospects(uuid,uuid,text,integer) to service_role;
grant execute on function public.growth_g1_create_prospect(jsonb) to service_role;
grant execute on function public.growth_g1_add_enrichment(uuid,uuid,jsonb) to service_role;
grant execute on function public.growth_g1_record_score(uuid,uuid,jsonb) to service_role;

comment on function public.growth_g1_list_prospects(uuid,uuid,text,integer) is 'Service-role-only Growth G1 prospect queue boundary.';
comment on function public.growth_g1_create_prospect(jsonb) is 'Service-role-only Growth G1 lead-mining ingest boundary.';
comment on function public.growth_g1_add_enrichment(uuid,uuid,jsonb) is 'Service-role-only Growth G1 enrichment evidence boundary.';
comment on function public.growth_g1_record_score(uuid,uuid,jsonb) is 'Service-role-only Growth G1 scoring boundary.';

commit;
