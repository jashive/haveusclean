create table growth.acquisition_cost_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id) on delete restrict,
  business_unit_id uuid not null references public.business_unit(id) on delete restrict,
  jurisdiction_id uuid not null references public.jurisdiction(id) on delete restrict,
  source_lane text not null check (btrim(source_lane) <> ''),
  period_start timestamptz not null,
  period_end timestamptz not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  amount numeric(18,2) not null check (amount > 0),
  evidence_reference text not null check (btrim(evidence_reference) <> ''),
  approved_by_app_user_id uuid not null references public.app_user(id) on delete restrict,
  approval_reason text not null check (btrim(approval_reason) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint growth_acquisition_cost_period_ck check (period_end > period_start),
  constraint growth_acquisition_cost_idempotency_uq unique (organization_id,idempotency_key)
);

alter table growth.acquisition_cost_evidence enable row level security;
revoke all on growth.acquisition_cost_evidence from public, anon, authenticated;
grant select on growth.acquisition_cost_evidence to service_role;

create or replace function growth.acquisition_cost_evidence_immutable_guard()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'growth.acquisition_cost_evidence is immutable';
end;
$$;
revoke all on function growth.acquisition_cost_evidence_immutable_guard() from public, anon, authenticated;

create trigger acquisition_cost_evidence_immutable
before update or delete on growth.acquisition_cost_evidence
for each row execute function growth.acquisition_cost_evidence_immutable_guard();

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

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'business_unit_id',p_business_unit_id,'jurisdiction_id',p_jurisdiction_id,
    'source_lane',btrim(p_source_lane),'period_start',p_period_start,'period_end',p_period_end,
    'currency_code',upper(p_currency_code),'amount',round(p_amount,2),'evidence_reference',btrim(p_evidence_reference),
    'approved_by_app_user_id',p_approved_by_app_user_id,'approval_reason',btrim(p_approval_reason),
    'metadata',coalesce(p_metadata,'{}'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');

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

create or replace function public.growth_g5_unit_economics_summary(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_captured_from timestamptz,
  p_captured_to timestamptz
)
returns table (
  source_lane text,
  country_code text,
  subdivision_code text,
  currency_code text,
  spend_amount numeric,
  prospects bigint,
  qualified bigint,
  converted bigint,
  invoiced_prospects bigint,
  recognized_revenue numeric,
  gross_contribution numeric,
  cost_per_prospect numeric,
  cost_per_qualified_lead numeric,
  customer_acquisition_cost numeric,
  return_on_ad_spend numeric,
  contribution_roi numeric
)
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if p_captured_from is null or p_captured_to is null or p_captured_to <= p_captured_from then
    raise exception 'G5 unit economics requires a valid exact cohort period';
  end if;

  return query
  with cost as (
    select c.source_lane,c.currency_code,sum(c.amount)::numeric as spend_amount
    from growth.acquisition_cost_evidence c
    where c.organization_id=p_organization_id
      and c.business_unit_id=p_business_unit_id
      and c.jurisdiction_id=p_jurisdiction_id
      and c.period_start=p_captured_from
      and c.period_end=p_captured_to
    group by c.source_lane,c.currency_code
  ), funnel as (
    select f.source_lane,max(f.country_code) as country_code,max(f.subdivision_code) as subdivision_code,
      count(*)::bigint as prospects,
      count(*) filter(where f.first_qualified_at is not null)::bigint as qualified,
      count(*) filter(where f.conversion_record_id is not null)::bigint as converted
    from growth.prospect_funnel_analytics_v1 f
    where f.organization_id=p_organization_id and f.business_unit_id=p_business_unit_id and f.jurisdiction_id=p_jurisdiction_id
      and f.captured_at>=p_captured_from and f.captured_at<p_captured_to
    group by f.source_lane
  ), fin as (
    select f.source_lane,f.invoice_currency_code as currency_code,
      count(*) filter(where f.invoice_request_id is not null)::bigint as invoiced_prospects,
      coalesce(sum(f.recognized_revenue_amount) filter(where f.currency_lineage_matches is true),0)::numeric as recognized_revenue,
      coalesce(sum(f.gross_contribution) filter(where f.currency_lineage_matches is true),0)::numeric as gross_contribution
    from growth.prospect_financial_analytics_v1 f
    where f.organization_id=p_organization_id and f.business_unit_id=p_business_unit_id and f.jurisdiction_id=p_jurisdiction_id
      and f.captured_at>=p_captured_from and f.captured_at<p_captured_to and f.invoice_currency_code is not null
    group by f.source_lane,f.invoice_currency_code
  )
  select
    c.source_lane,
    fu.country_code,
    fu.subdivision_code,
    c.currency_code,
    c.spend_amount,
    coalesce(fu.prospects,0),
    coalesce(fu.qualified,0),
    coalesce(fu.converted,0),
    coalesce(fi.invoiced_prospects,0),
    coalesce(fi.recognized_revenue,0),
    coalesce(fi.gross_contribution,0),
    case when coalesce(fu.prospects,0)>0 then round(c.spend_amount/fu.prospects,2) end,
    case when coalesce(fu.qualified,0)>0 then round(c.spend_amount/fu.qualified,2) end,
    case when coalesce(fu.converted,0)>0 then round(c.spend_amount/fu.converted,2) end,
    case when c.spend_amount>0 and coalesce(fi.recognized_revenue,0)>0 then round(fi.recognized_revenue/c.spend_amount,4) end,
    case when c.spend_amount>0 and fi.gross_contribution is not null then round((fi.gross_contribution-c.spend_amount)/c.spend_amount,4) end
  from cost c
  left join funnel fu on fu.source_lane=c.source_lane
  left join fin fi on fi.source_lane=c.source_lane and fi.currency_code=c.currency_code
  order by c.source_lane,c.currency_code;
end;
$$;
revoke all on function public.growth_g5_unit_economics_summary(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.growth_g5_unit_economics_summary(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
