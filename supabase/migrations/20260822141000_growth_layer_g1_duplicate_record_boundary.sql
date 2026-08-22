-- Growth Layer 1.0 / controlled duplicate-review creation boundary.
-- Duplicate classification remains deterministic Growth logic; this RPC only persists a scoped result.

begin;

create or replace function public.growth_g1_record_duplicate_review(
  p_prospect_id uuid,
  p_organization_id uuid,
  p_payload jsonb
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
  v_matched uuid;
  v_classification text;
  v_confidence numeric;
  v_algorithm text;
begin
  select organization_id, business_unit_id, jurisdiction_id
    into v_org, v_bu, v_jur
  from growth.prospect
  where id = p_prospect_id and organization_id = p_organization_id;

  if v_org is null then
    raise exception 'growth duplicate record: prospect not found in organization';
  end if;

  v_classification := p_payload->>'classification';
  v_confidence := nullif(p_payload->>'confidence','')::numeric;
  v_algorithm := nullif(p_payload->>'algorithm_version','');
  v_matched := nullif(p_payload->>'matched_prospect_id','')::uuid;

  if v_classification not in ('exact_duplicate','probable_duplicate','review_required','unique') then
    raise exception 'growth duplicate record: invalid classification';
  end if;
  if v_confidence is null or v_confidence < 0 or v_confidence > 1 then
    raise exception 'growth duplicate record: confidence must be between 0 and 1';
  end if;
  if v_algorithm is null then
    raise exception 'growth duplicate record: algorithm_version required';
  end if;
  if v_classification = 'unique' and v_matched is not null then
    raise exception 'growth duplicate record: unique classification cannot have matched prospect';
  end if;
  if v_classification <> 'unique' and v_matched is null then
    raise exception 'growth duplicate record: non-unique classification requires matched prospect';
  end if;

  if exists (
    select 1 from growth.duplicate_review
    where prospect_id = p_prospect_id and review_status = 'pending'
  ) then
    raise exception 'growth duplicate record: pending review already exists';
  end if;

  insert into growth.duplicate_review (
    organization_id, business_unit_id, jurisdiction_id, prospect_id,
    matched_prospect_id, classification, confidence, algorithm_version,
    evidence, review_status
  ) values (
    v_org, v_bu, v_jur, p_prospect_id,
    v_matched, v_classification, v_confidence, v_algorithm,
    coalesce(p_payload->'evidence', '{}'::jsonb), 'pending'
  ) returning id into v_id;

  update growth.prospect
  set lifecycle_status = case
    when v_classification = 'exact_duplicate' then 'review_ready'
    when v_classification in ('probable_duplicate','review_required') then 'review_ready'
    else lifecycle_status
  end
  where id = p_prospect_id;

  insert into growth.audit_event (
    organization_id, business_unit_id, prospect_id, event_type, payload
  ) values (
    v_org, v_bu, p_prospect_id, 'duplicate_review_recorded',
    jsonb_build_object(
      'duplicate_review_id', v_id,
      'classification', v_classification,
      'confidence', v_confidence,
      'algorithm_version', v_algorithm,
      'matched_prospect_id', v_matched
    )
  );

  return v_id;
end;
$$;

revoke all on function public.growth_g1_record_duplicate_review(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.growth_g1_record_duplicate_review(uuid,uuid,jsonb) to service_role;

comment on function public.growth_g1_record_duplicate_review(uuid,uuid,jsonb)
  is 'Service-role-only Growth G1 persistence boundary for deterministic duplicate-classification results.';

commit;
