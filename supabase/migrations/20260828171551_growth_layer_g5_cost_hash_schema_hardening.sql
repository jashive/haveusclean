create or replace function public.growth_g5_record_acquisition_cost_evidence(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_source_lane text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_currency_code text,
  p_amount numeric,
  p_evidence_reference text,
  p_approved_by_app_user_id uuid,
  p_approval_reason text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_hash text;
  v_existing growth.acquisition_cost_evidence%rowtype;
  v_id uuid;
begin
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null then
    raise exception 'G5 cost evidence requires organization, business unit, and jurisdiction';
  end if;
  if not exists (
    select 1 from public.business_unit b
    where b.id=p_business_unit_id and b.organization_id=p_organization_id
      and b.jurisdiction_id=p_jurisdiction_id and b.status='active'
  ) then
    raise exception 'G5 cost evidence scope is invalid or inactive';
  end if;
  if not exists (select 1 from public.app_user u where u.id=p_approved_by_app_user_id and u.status='active') then
    raise exception 'G5 cost evidence requires an active human approver';
  end if;
  if btrim(coalesce(p_source_lane,''))='' then raise exception 'source_lane is required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then raise exception 'cost evidence period is invalid'; end if;
  if upper(coalesce(p_currency_code,'')) !~ '^[A-Z]{3}$' then raise exception 'currency_code must be ISO-style three-letter uppercase'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'cost amount must be positive'; end if;
  if btrim(coalesce(p_evidence_reference,''))='' then raise exception 'evidence_reference is required'; end if;
  if btrim(coalesce(p_approval_reason,''))='' then raise exception 'approval_reason is required'; end if;
  if btrim(coalesce(p_idempotency_key,''))='' then raise exception 'idempotency_key is required'; end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
    'source_lane',btrim(p_source_lane),'period_start',p_period_start,'period_end',p_period_end,
    'currency_code',upper(p_currency_code),'amount',round(p_amount,2),'evidence_reference',btrim(p_evidence_reference),
    'approved_by_app_user_id',p_approved_by_app_user_id,'approval_reason',btrim(p_approval_reason),
    'metadata',coalesce(p_metadata,'{}'::jsonb)
  )::text,'UTF8'),'sha256'::text),'hex');

  select * into v_existing
  from growth.acquisition_cost_evidence
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;

  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'G5 cost evidence idempotency collision';
    end if;
    return jsonb_build_object('status','RECORDED','cost_evidence_id',v_existing.id,'idempotent_replay',true,'request_hash',v_hash);
  end if;

  insert into growth.acquisition_cost_evidence(
    organization_id,business_unit_id,jurisdiction_id,source_lane,period_start,period_end,currency_code,
    amount,evidence_reference,approved_by_app_user_id,approval_reason,idempotency_key,request_hash,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,btrim(p_source_lane),p_period_start,p_period_end,upper(p_currency_code),
    round(p_amount,2),btrim(p_evidence_reference),p_approved_by_app_user_id,btrim(p_approval_reason),p_idempotency_key,v_hash,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('status','RECORDED','cost_evidence_id',v_id,'idempotent_replay',false,'request_hash',v_hash);
end;
$$;

revoke all on function public.growth_g5_record_acquisition_cost_evidence(uuid,uuid,uuid,text,timestamptz,timestamptz,text,numeric,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.growth_g5_record_acquisition_cost_evidence(uuid,uuid,uuid,text,timestamptz,timestamptz,text,numeric,text,uuid,text,text,jsonb) to service_role;
