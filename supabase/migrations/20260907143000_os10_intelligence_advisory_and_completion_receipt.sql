-- OS 1.0 advisory intelligence and idempotent customer completion receipts.
-- All intelligence is read-only. Missing governed evidence remains missing.

begin;

create table if not exists public.customer_completion_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null,
  operational_job_id uuid not null references public.operational_job(id),
  work_order_id uuid not null references public.work_order(id),
  recipient_email text not null,
  provider text not null default 'microsoft_graph',
  provider_message_id text,
  delivery_status text not null default 'requested' check (delivery_status in ('requested','sent','failed')),
  idempotency_key text not null unique,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_order_id)
);

alter table public.customer_completion_delivery enable row level security;
alter table public.customer_completion_delivery force row level security;
revoke all on public.customer_completion_delivery from public, anon;
grant select on public.customer_completion_delivery to authenticated;

create policy customer_completion_delivery_staff_read on public.customer_completion_delivery
for select to authenticated using (
  public.has_bu_role(organization_id, business_unit_id, array['owner_admin','office_ops']::text[])
);

create index if not exists idx_customer_completion_delivery_scope
  on public.customer_completion_delivery (organization_id, business_unit_id, requested_at desc);

-- This narrowly scoped definer is the email outbox boundary. It does not accept a
-- recipient or status from the caller, and it validates the current user against
-- the canonical assignment or privileged BU membership before reading PII.
create or replace function public.reserve_customer_completion_receipt(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_wo public.work_order%rowtype;
  v_job public.operational_job%rowtype;
  v_contact public.contact%rowtype;
  v_location public.service_location%rowtype;
  v_schedule public.schedule_window%rowtype;
  v_quote public.quote_version%rowtype;
  v_delivery public.customer_completion_delivery%rowtype;
  v_allowed boolean := false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_wo from public.work_order where id = p_work_order_id;
  if not found or v_wo.work_order_status <> 'service_complete' or v_wo.service_completed_at is null then
    raise exception 'Completion receipt requires a governed service_complete work order';
  end if;
  select * into strict v_job from public.operational_job where id = v_wo.operational_job_id;
  v_allowed := public.has_bu_role(v_job.organization_id, v_job.business_unit_id, array['owner_admin','office_ops']::text[])
    or exists (
      select 1 from public.worker_assignment wa
      join public.worker w on w.id = wa.worker_id
      where wa.operational_job_id = v_job.id and wa.assignment_status = 'completed'
        and w.app_user_id = public.current_app_user_id() and w.status = 'active'
    );
  if not v_allowed then raise exception 'Completion receipt is not authorized for this work order'; end if;

  select * into strict v_contact from public.contact where id = v_job.contact_id;
  if nullif(btrim(v_contact.email),'') is null then raise exception 'Customer email is unavailable'; end if;
  select * into strict v_location from public.service_location where id = v_job.service_location_id;
  select * into v_schedule from public.schedule_window where operational_job_id = v_job.id order by scheduled_start desc limit 1;
  select * into strict v_quote from public.quote_version where id = v_job.quote_version_id;

  insert into public.customer_completion_delivery (
    organization_id,business_unit_id,operational_job_id,work_order_id,recipient_email,idempotency_key,metadata
  ) values (
    v_job.organization_id,v_job.business_unit_id,v_job.id,v_wo.id,lower(btrim(v_contact.email)),
    encode(extensions.digest('customer-completion:' || v_wo.id::text || ':v1','sha256'),'hex'),
    jsonb_build_object('source','governed_service_complete','service_completed_at',v_wo.service_completed_at)
  ) on conflict (work_order_id) do nothing;
  select * into strict v_delivery from public.customer_completion_delivery where work_order_id = v_wo.id;

  return jsonb_build_object(
    'delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,
    'idempotency_key',v_delivery.idempotency_key,'recipient_email',v_delivery.recipient_email,
    'customer_name',coalesce(nullif(v_contact.first_name || ' ' || v_contact.last_name,' '),'Customer'),
    'service_title',coalesce(nullif(v_quote.title,''),'Cleaning service'),
    'completed_at',v_wo.service_completed_at,
    'scheduled_start',v_schedule.scheduled_start,
    'address',concat_ws(', ',v_location.address_line1,v_location.address_line2,v_location.city,v_location.subdivision,v_location.postal_code)
  );
end;
$$;

create or replace function public.record_customer_completion_receipt_result(
  p_delivery_id uuid, p_status text, p_provider_message_id text default null, p_failure_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.customer_completion_delivery%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('sent','failed') then raise exception 'Invalid completion delivery status'; end if;
  select * into strict v_row from public.customer_completion_delivery where id=p_delivery_id for update;
  if not (public.has_bu_role(v_row.organization_id,v_row.business_unit_id,array['owner_admin','office_ops']::text[])
    or exists (select 1 from public.worker_assignment wa join public.worker w on w.id=wa.worker_id
      where wa.operational_job_id=v_row.operational_job_id and wa.assignment_status='completed'
        and w.app_user_id=public.current_app_user_id() and w.status='active')) then
    raise exception 'Completion delivery update is not authorized';
  end if;
  if v_row.delivery_status='sent' then return to_jsonb(v_row) - 'recipient_email'; end if;
  update public.customer_completion_delivery set delivery_status=p_status,
    provider_message_id=case when p_status='sent' then p_provider_message_id else provider_message_id end,
    sent_at=case when p_status='sent' then now() else sent_at end,
    failed_at=case when p_status='failed' then now() else null end,
    failure_reason=case when p_status='failed' then left(p_failure_reason,1000) else null end,
    updated_at=now() where id=p_delivery_id returning * into v_row;
  return to_jsonb(v_row) - 'recipient_email';
end;
$$;

revoke all on function public.reserve_customer_completion_receipt(uuid) from public, anon;
revoke all on function public.record_customer_completion_receipt_result(uuid,text,text,text) from public, anon;
grant execute on function public.reserve_customer_completion_receipt(uuid) to authenticated;
grant execute on function public.record_customer_completion_receipt_result(uuid,text,text,text) to authenticated;

create table if not exists public.worker_capacity_calendar (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null, worker_id uuid not null references public.worker(id), capacity_date date not null,
  available_minutes integer not null check (available_minutes between 0 and 1440),
  source text not null default 'declared', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (worker_id, capacity_date)
);
alter table public.worker_capacity_calendar enable row level security;
alter table public.worker_capacity_calendar force row level security;
revoke all on public.worker_capacity_calendar from public, anon;
grant select,insert,update on public.worker_capacity_calendar to authenticated;
create policy capacity_staff on public.worker_capacity_calendar for all to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['owner_admin','office_ops']::text[]))
with check (public.has_bu_role(organization_id,business_unit_id,array['owner_admin','office_ops']::text[]));
create index if not exists idx_capacity_scope_date on public.worker_capacity_calendar(organization_id,business_unit_id,capacity_date);

create or replace function public.get_os10_intelligence_dashboard(
  p_organization_id uuid, p_business_unit_id uuid, p_date_from date default current_date,
  p_date_to date default (current_date + 13)
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_code text; v_currency text; v_routes jsonb; v_capacity jsonb; v_retention jsonb; v_margin jsonb;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to-p_date_from > 92 then
    raise exception 'Intelligence period must be between 1 and 93 days';
  end if;
  select code into v_code from public.business_unit where id=p_business_unit_id and organization_id=p_organization_id and status='active';
  v_currency := case v_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end;
  if v_currency is null then raise exception 'Unsupported intelligence business unit'; end if;
  if not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops']::text[]) then
    raise exception 'Intelligence dashboard requires Owner/Admin or Office Operations access';
  end if;

  with jobs as (
    select oj.id,sw.scheduled_start,sl.latitude,sl.longitude,
      lag(sl.latitude) over(order by sw.scheduled_start,oj.id) prev_lat,
      lag(sl.longitude) over(order by sw.scheduled_start,oj.id) prev_lon
    from public.operational_job oj join public.schedule_window sw on sw.operational_job_id=oj.id
    join public.service_location sl on sl.id=oj.service_location_id
    where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id
      and sw.status not in ('cancelled','rescheduled') and sw.scheduled_start::date between p_date_from and p_date_to
  ), distances as (
    select *, case when latitude is null or longitude is null or prev_lat is null or prev_lon is null then null else
      6371 * 2 * asin(sqrt(power(sin(radians((latitude-prev_lat)/2)),2)+cos(radians(prev_lat))*cos(radians(latitude))*power(sin(radians((longitude-prev_lon)/2)),2))) end km
    from jobs
  ) select coalesce(jsonb_agg(jsonb_build_object('date',day,'jobs',jobs,'geocoded_jobs',geocoded,'average_consecutive_km',avg_km,
      'density_score',case when geocoded<2 then null else greatest(0,least(100,round(100-(coalesce(avg_km,50)*2)))) end) order by day),'[]'::jsonb)
    into v_routes from (select scheduled_start::date day,count(*) jobs,count(latitude) geocoded,round(avg(km)::numeric,1) avg_km from distances group by 1) d;

  with days as (select generate_series(p_date_from,p_date_to,'1 day')::date day), declared as (
    select capacity_date day,sum(available_minutes) available from public.worker_capacity_calendar
    where organization_id=p_organization_id and business_unit_id=p_business_unit_id and capacity_date between p_date_from and p_date_to group by 1
  ), scheduled as (
    select sw.scheduled_start::date day,sum(extract(epoch from(sw.scheduled_end-sw.scheduled_start))/60)::integer booked
    from public.schedule_window sw join public.operational_job oj on oj.id=sw.operational_job_id
    where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and sw.status not in('cancelled','rescheduled')
      and sw.scheduled_start::date between p_date_from and p_date_to group by 1
  ) select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'available_minutes',a.available,'scheduled_minutes',coalesce(s.booked,0),
    'utilization_percent',case when a.available>0 then round(coalesce(s.booked,0)*100.0/a.available,1) end,
    'status',case when a.available is null then 'no_governed_data' when coalesce(s.booked,0)>a.available then 'overbooked' when coalesce(s.booked,0)>=a.available*.85 then 'warning' else 'available' end) order by d.day),'[]'::jsonb)
    into v_capacity from days d left join declared a using(day) left join scheduled s using(day);

  with completed as (
    select oj.customer_id,coalesce(nullif(oj.service_scope_snapshot->>'frequency',''),nullif(sr.requirements->>'frequency','')) cadence,
      max(wo.service_completed_at)::date last_service
    from public.operational_job oj join public.work_order wo on wo.operational_job_id=oj.id
    left join public.conversion_record cr on cr.id=oj.conversion_record_id left join public.opportunity o on o.id=cr.opportunity_id
    left join public.service_request sr on sr.id=o.service_request_id
    where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and wo.service_completed_at is not null
    group by oj.customer_id,coalesce(nullif(oj.service_scope_snapshot->>'frequency',''),nullif(sr.requirements->>'frequency',''))
  ), scored as (
    select *,case cadence when 'weekly' then 7 when 'biweekly' then 14 when 'monthly' then 30 end expected_days from completed
  ) select coalesce(jsonb_agg(jsonb_build_object('cadence',cadence,'accounts',accounts,'at_risk',at_risk,'churn_signal',churned) order by cadence),'[]'::jsonb)
    into v_retention from (select cadence,count(*) accounts,count(*) filter(where current_date-last_service>expected_days*1.25) at_risk,
      count(*) filter(where current_date-last_service>expected_days*2) churned from scored where expected_days is not null group by cadence) r;

  with active as (
    select oj.id,coalesce(qv.title,'Active service') label,ps.currency_code,
      coalesce(nullif(ps.labor_economics->>'jobHours','')::numeric,extract(epoch from(sw.scheduled_end-sw.scheduled_start))/3600) quoted_hours,
      greatest(extract(epoch from(now()-wo.started_at))/3600,0) elapsed_hours,
      ps.subtotal_amount quoted_revenue,coalesce(nullif(ps.labor_economics->>'directLaborCost','')::numeric,0) quoted_labor
    from public.operational_job oj join public.work_order wo on wo.operational_job_id=oj.id
    join public.schedule_window sw on sw.operational_job_id=oj.id join public.pricing_snapshot ps on ps.id=oj.pricing_snapshot_id
    join public.quote_version qv on qv.id=oj.quote_version_id
    where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and wo.work_order_status='in_progress' and wo.started_at is not null
  ) select coalesce(jsonb_agg(jsonb_build_object('job_label',label,'elapsed_hours',round(elapsed_hours,2),'quoted_hours',round(quoted_hours,2),
    'projected_labor_cost',case when quoted_hours>0 then round(quoted_labor*greatest(1,elapsed_hours/quoted_hours),2) end,
    'projected_contribution',case when quoted_hours>0 then round(quoted_revenue-quoted_labor*greatest(1,elapsed_hours/quoted_hours),2) end,
    'drift_status',case when quoted_hours is null or quoted_hours=0 then 'no_governed_data' when elapsed_hours>quoted_hours*1.15 then 'negative' when elapsed_hours>quoted_hours*.9 then 'watch' else 'on_track' end) order by elapsed_hours desc),'[]'::jsonb)
    into v_margin from active where currency_code=v_currency;

  return jsonb_build_object('scope',jsonb_build_object('market_code',v_code,'currency_code',v_currency,'date_from',p_date_from,'date_to',p_date_to),
    'route_density',v_routes,'capacity',v_capacity,'retention',v_retention,'margin_drift',v_margin,'generated_at',now());
end;
$$;

revoke all on function public.get_os10_intelligence_dashboard(uuid,uuid,date,date) from public,anon;
grant execute on function public.get_os10_intelligence_dashboard(uuid,uuid,date,date) to authenticated;

commit;
