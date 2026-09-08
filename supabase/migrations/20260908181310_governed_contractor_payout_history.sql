-- Governed contractor payout approval, settlement, and immutable history.

create table public.contractor_payable_settlement_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  contractor_payable_id uuid not null references public.contractor_payable(id),
  worker_id uuid not null references public.worker(id),
  event_type text not null check (event_type in ('approved','paid')),
  amount numeric(12,2) not null check (amount >= 0),
  currency_code text not null check (currency_code <> ''),
  payment_method text,
  payment_reference text,
  effective_at timestamptz not null default now(),
  actor_app_user_id uuid not null references public.app_user(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint uq_contractor_payable_settlement_event unique (contractor_payable_id,event_type),
  constraint ck_paid_event_payment_details check (
    event_type <> 'paid' or (
      payment_method in ('ach','zelle','etransfer','check','cash','payroll_provider','other')
      and nullif(btrim(payment_reference),'') is not null
    )
  )
);

comment on table public.contractor_payable_settlement_event is
  'Append-only approval and payment evidence for contractor payables. Rows are never updated or deleted.';

create index contractor_payable_settlement_event_worker_idx
  on public.contractor_payable_settlement_event (organization_id,business_unit_id,worker_id,effective_at desc);

alter table public.contractor_payable_settlement_event enable row level security;
revoke all on table public.contractor_payable_settlement_event from public,anon,authenticated;
grant select,insert on table public.contractor_payable_settlement_event to authenticated;

create policy contractor_payable_settlement_event_owner_select
on public.contractor_payable_settlement_event for select to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['owner_admin']::text[]));

create policy contractor_payable_settlement_event_office_select
on public.contractor_payable_settlement_event for select to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['office_ops']::text[]));

create policy contractor_payable_settlement_event_worker_select
on public.contractor_payable_settlement_event for select to authenticated
using (worker_id=public.current_worker_id(organization_id));

create policy contractor_payable_settlement_event_owner_insert
on public.contractor_payable_settlement_event for insert to authenticated
with check (public.has_bu_role(organization_id,business_unit_id,array['owner_admin']::text[]));

create or replace function public.validate_contractor_payable_settlement_event()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_payable public.contractor_payable%rowtype; v_actor uuid:=public.current_app_user_id();
begin
  select * into strict v_payable from public.contractor_payable where id=new.contractor_payable_id for key share;
  if new.organization_id<>v_payable.organization_id or new.business_unit_id<>v_payable.business_unit_id
     or new.worker_id<>v_payable.worker_id or new.amount<>v_payable.computed_amount or new.currency_code<>v_payable.currency_code then
    raise exception 'Settlement evidence must match its governed contractor payable';
  end if;
  if v_actor is null or new.actor_app_user_id<>v_actor then raise exception 'Settlement actor must be the authenticated app user'; end if;
  if new.effective_at>now()+interval '5 minutes' then raise exception 'Settlement effective date cannot be in the future'; end if;
  if new.event_type='approved' and (v_payable.payable_status not in ('approved','paid') or v_payable.approved_by_app_user_id<>v_actor or new.effective_at<>v_payable.approved_at) then
    raise exception 'Approval evidence requires the matching governed approval transition';
  end if;
  if new.event_type='paid' and (v_payable.payable_status<>'paid' or not exists(
    select 1 from public.contractor_payable_settlement_event e where e.contractor_payable_id=v_payable.id and e.event_type='approved'
  )) then raise exception 'Payment evidence requires a governed approved-to-paid transition'; end if;
  return new;
end; $$;

create trigger contractor_payable_settlement_event_validation
before insert on public.contractor_payable_settlement_event
for each row execute function public.validate_contractor_payable_settlement_event();

create or replace function public.prevent_contractor_payable_settlement_event_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'contractor_payable_settlement_event is append-only';
end; $$;

create trigger contractor_payable_settlement_event_append_only
before update or delete on public.contractor_payable_settlement_event
for each row execute function public.prevent_contractor_payable_settlement_event_mutation();

create or replace function public.staff_approve_contractor_payables(
  p_organization_id uuid,p_business_unit_id uuid,p_payable_ids uuid[],p_note text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_actor uuid:=public.current_app_user_id(); v_count integer:=0; v_total numeric:=0; v_currency text; v_ids uuid[];
begin
  if v_actor is null or not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin']::text[]) then
    raise exception 'Only an Owner/Admin may approve contractor payables';
  end if;
  if coalesce(array_length(p_payable_ids,1),0)=0 then raise exception 'Select at least one pending payable'; end if;

  select count(distinct currency_code),min(currency_code) into v_count,v_currency
  from public.contractor_payable
  where id=any(p_payable_ids) and organization_id=p_organization_id and business_unit_id=p_business_unit_id and payable_status='pending';
  if v_count<>1 then raise exception 'Selected payables must all be pending and use one territory currency'; end if;

  with changed as (
    update public.contractor_payable
    set payable_status='approved',approved_by_app_user_id=v_actor,approved_at=now()
    where id=any(p_payable_ids) and organization_id=p_organization_id and business_unit_id=p_business_unit_id and payable_status='pending'
    returning *
  ), events as (
    insert into public.contractor_payable_settlement_event(
      organization_id,business_unit_id,contractor_payable_id,worker_id,event_type,amount,currency_code,effective_at,actor_app_user_id,metadata
    ) select organization_id,business_unit_id,id,worker_id,'approved',computed_amount,currency_code,approved_at,v_actor,
      jsonb_build_object('note',nullif(btrim(coalesce(p_note,'')),''),'source','cleaner_payables_workspace') from changed
    returning contractor_payable_id,amount
  ) select coalesce(array_agg(contractor_payable_id),'{}'::uuid[]),count(*)::integer,coalesce(sum(amount),0)
    into v_ids,v_count,v_total from events;

  if v_count<>cardinality(p_payable_ids) then raise exception 'One or more selected payables could not be approved'; end if;
  return jsonb_build_object('status','approved','count',v_count,'amount',v_total,'currency_code',v_currency,'payable_ids',v_ids);
end; $$;

create or replace function public.staff_mark_contractor_payables_paid(
  p_organization_id uuid,p_business_unit_id uuid,p_payable_ids uuid[],p_payment_method text,p_payment_reference text,
  p_paid_at timestamptz default now(),p_note text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_actor uuid:=public.current_app_user_id(); v_count integer:=0; v_total numeric:=0; v_currency text; v_ids uuid[]; v_method text:=lower(btrim(coalesce(p_payment_method,''))); v_reference text:=btrim(coalesce(p_payment_reference,''));
begin
  if v_actor is null or not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin']::text[]) then
    raise exception 'Only an Owner/Admin may mark contractor payables paid';
  end if;
  if coalesce(array_length(p_payable_ids,1),0)=0 then raise exception 'Select at least one approved payable'; end if;
  if v_method not in ('ach','zelle','etransfer','check','cash','payroll_provider','other') then raise exception 'Select a governed payment method'; end if;
  if v_reference='' then raise exception 'Payment confirmation or reference is required'; end if;
  if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then raise exception 'Paid date cannot be in the future'; end if;

  select count(distinct currency_code),min(currency_code) into v_count,v_currency
  from public.contractor_payable
  where id=any(p_payable_ids) and organization_id=p_organization_id and business_unit_id=p_business_unit_id
    and payable_status='approved' and approved_at<=p_paid_at;
  if v_count<>1 then raise exception 'Selected payables must all be approved, predate payment, and use one territory currency'; end if;

  with changed as (
    update public.contractor_payable set payable_status='paid'
    where id=any(p_payable_ids) and organization_id=p_organization_id and business_unit_id=p_business_unit_id and payable_status='approved'
    returning *
  ), events as (
    insert into public.contractor_payable_settlement_event(
      organization_id,business_unit_id,contractor_payable_id,worker_id,event_type,amount,currency_code,payment_method,payment_reference,effective_at,actor_app_user_id,metadata
    ) select organization_id,business_unit_id,id,worker_id,'paid',computed_amount,currency_code,v_method,v_reference,p_paid_at,v_actor,
      jsonb_build_object('note',nullif(btrim(coalesce(p_note,'')),''),'source','cleaner_payables_workspace') from changed
    returning contractor_payable_id,amount
  ) select coalesce(array_agg(contractor_payable_id),'{}'::uuid[]),count(*)::integer,coalesce(sum(amount),0)
    into v_ids,v_count,v_total from events;

  if v_count<>cardinality(p_payable_ids) then raise exception 'One or more selected payables could not be marked paid'; end if;
  return jsonb_build_object('status','paid','count',v_count,'amount',v_total,'currency_code',v_currency,'payment_method',v_method,'payment_reference',v_reference,'paid_at',p_paid_at,'payable_ids',v_ids);
end; $$;

create or replace function public.get_cleaner_payables_dashboard(p_organization_id uuid,p_business_unit_id uuid,p_limit integer default 1000)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_code text; v_currency text; v_rows jsonb; v_pending numeric; v_approved numeric; v_paid numeric;
begin
 select code into strict v_code from public.business_unit where id=p_business_unit_id and organization_id=p_organization_id and status='active';
 v_currency:=case v_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end;
 if v_currency is null or not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops']::text[]) then raise exception 'Payables dashboard is not authorized for this territory'; end if;
 select coalesce(sum(computed_amount) filter(where payable_status='pending'),0),
        coalesce(sum(computed_amount) filter(where payable_status='approved'),0),
        coalesce(sum(computed_amount) filter(where payable_status='paid'),0)
 into v_pending,v_approved,v_paid from public.contractor_payable where organization_id=p_organization_id and business_unit_id=p_business_unit_id and currency_code=v_currency;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'worker_id',x.worker_id,'worker_name',x.display_name,'work_order_number',x.work_order_number,
   'actual_hours',x.basis_value,'hourly_rate',x.rate_value,'compensation_method',x.compensation_method,'amount',x.computed_amount,
   'currency_code',x.currency_code,'status',x.payable_status,'created_at',x.created_at,'approved_at',x.approved_at,
   'paid_at',x.paid_at,'payment_method',x.payment_method,'payment_reference',x.payment_reference) order by x.created_at desc),'[]'::jsonb)
 into v_rows from (select cp.*,w.display_name,wo.work_order_number,ccv.rate_value,paid.effective_at paid_at,paid.payment_method,paid.payment_reference
   from public.contractor_payable cp join public.worker w on w.id=cp.worker_id join public.work_order wo on wo.id=cp.work_order_id
   join public.contractor_compensation_version ccv on ccv.id=cp.contractor_compensation_version_id
   left join lateral(select e.effective_at,e.payment_method,e.payment_reference from public.contractor_payable_settlement_event e
     where e.contractor_payable_id=cp.id and e.event_type='paid' order by e.created_at desc limit 1) paid on true
   where cp.organization_id=p_organization_id and cp.business_unit_id=p_business_unit_id and cp.currency_code=v_currency
   order by cp.created_at desc limit greatest(1,least(coalesce(p_limit,1000),2500))) x;
 return jsonb_build_object('scope',jsonb_build_object('market_code',v_code,'currency_code',v_currency),
   'pending_total',v_pending,'approved_total',v_approved,'paid_total',v_paid,'rows',v_rows);
end; $$;

revoke all on function public.staff_approve_contractor_payables(uuid,uuid,uuid[],text) from public,anon;
revoke all on function public.staff_mark_contractor_payables_paid(uuid,uuid,uuid[],text,text,timestamptz,text) from public,anon;
revoke all on function public.get_cleaner_payables_dashboard(uuid,uuid,integer) from public,anon;
grant execute on function public.staff_approve_contractor_payables(uuid,uuid,uuid[],text) to authenticated;
grant execute on function public.staff_mark_contractor_payables_paid(uuid,uuid,uuid[],text,text,timestamptz,text) to authenticated;
grant execute on function public.get_cleaner_payables_dashboard(uuid,uuid,integer) to authenticated;
