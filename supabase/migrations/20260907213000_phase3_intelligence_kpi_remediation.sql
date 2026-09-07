-- Phase 3: governed compensation, realized profitability, capacity, cadence and route-density plumbing.
begin;

create or replace function public.staff_set_worker_hourly_compensation(
  p_worker_id uuid, p_hourly_rate numeric, p_effective_from timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_worker public.worker%rowtype; v_code text; v_currency text; v_actor uuid:=public.current_app_user_id(); v_row public.contractor_compensation_version%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_hourly_rate is null or p_hourly_rate <= 0 or p_hourly_rate > 500 then raise exception 'Hourly rate must be greater than zero and no more than 500'; end if;
  select * into strict v_worker from public.worker where id=p_worker_id for update;
  if not public.has_bu_role(v_worker.organization_id,v_worker.business_unit_id,array['owner_admin']::text[]) then raise exception 'Compensation setup requires Owner/Admin access in this territory'; end if;
  select code into strict v_code from public.business_unit where id=v_worker.business_unit_id and organization_id=v_worker.organization_id;
  v_currency:=case v_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end;
  if v_currency is null then raise exception 'Unsupported worker territory'; end if;
  update public.contractor_compensation_version set effective_to=p_effective_from,compensation_status='retired'
   where worker_id=p_worker_id and compensation_status in ('approved','active') and effective_to is null;
  insert into public.contractor_compensation_version(
    organization_id,business_unit_id,worker_id,service_family,version,compensation_method,currency_code,rate_value,
    effective_from,compensation_status,approved_by_app_user_id,approved_at,governance_reference_snapshot,metadata,created_by_app_user_id
  ) values(v_worker.organization_id,v_worker.business_unit_id,v_worker.id,'residential',
    'hourly-'||to_char(p_effective_from at time zone 'UTC','YYYYMMDDHH24MISS'),'hourly',v_currency,round(p_hourly_rate,4),
    p_effective_from,'active',v_actor,now(),jsonb_build_object('authority','owner_admin','territory',v_code),jsonb_build_object('source','phase3_compensation_setup'),v_actor)
  returning * into v_row;
  return jsonb_build_object('id',v_row.id,'worker_id',v_row.worker_id,'currency_code',v_row.currency_code,'hourly_rate',v_row.rate_value,'status',v_row.compensation_status);
end; $$;
revoke all on function public.staff_set_worker_hourly_compensation(uuid,numeric,timestamptz) from public,anon;
grant execute on function public.staff_set_worker_hourly_compensation(uuid,numeric,timestamptz) to authenticated;

create or replace function public.trg_jps_before_insert_validator() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_job public.operational_job%rowtype; v_ps public.pricing_snapshot%rowtype; v_ir public.invoice_request%rowtype; v_labor numeric(12,2); v_ps_id text; v_qv_id text;
begin
  select * into strict v_job from public.operational_job where id=new.operational_job_id;
  select * into strict v_ps from public.pricing_snapshot where id=v_job.pricing_snapshot_id;
  if new.organization_id is distinct from v_job.organization_id or new.business_unit_id is distinct from v_job.business_unit_id then raise exception 'job_profitability_snapshot: job scope mismatch'; end if;
  if new.currency_code is distinct from v_ps.currency_code or new.recognized_revenue_amount is distinct from v_ps.subtotal_amount or new.tax_amount is distinct from v_ps.tax_amount then raise exception 'job_profitability_snapshot: accepted pricing snapshot mismatch'; end if;
  if new.invoice_request_id is not null then
    select * into strict v_ir from public.invoice_request where id=new.invoice_request_id;
    if v_ir.operational_job_id is distinct from new.operational_job_id or v_ir.pricing_snapshot_id is distinct from v_ps.id or v_ir.quote_version_id is distinct from v_job.quote_version_id then raise exception 'job_profitability_snapshot: invoice lineage mismatch'; end if;
  end if;
  select coalesce(sum(computed_amount),0) into v_labor from public.contractor_payable where operational_job_id=new.operational_job_id and payable_status<>'voided';
  if new.direct_labor_cost is distinct from v_labor then raise exception 'job_profitability_snapshot: direct labor must equal earned non-voided payables'; end if;
  if jsonb_typeof(new.source_lineage) is distinct from 'object' then raise exception 'job_profitability_snapshot: source_lineage must be an object'; end if;
  v_ps_id:=nullif(btrim(new.source_lineage->>'pricing_snapshot_id'),''); v_qv_id:=nullif(btrim(new.source_lineage->>'quote_version_id'),'');
  if v_ps_id is distinct from v_ps.id::text or v_qv_id is distinct from v_job.quote_version_id::text then raise exception 'job_profitability_snapshot: pricing lineage mismatch'; end if;
  if new.other_direct_cost>0 and nullif(btrim(new.source_lineage->>'direct_cost_source_reference'),'') is null then raise exception 'job_profitability_snapshot: direct cost source is required'; end if;
  return new;
end; $$;

create or replace function public.staff_finalize_qa_inspection(
  p_qa_inspection_id uuid,p_outcome text,p_score numeric default null,p_findings text default null,p_waiver_reason text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_i public.qa_inspection%rowtype; v_job public.operational_job%rowtype; v_wo public.work_order%rowtype; v_actor uuid:=public.current_app_user_id();
  v_a public.worker_assignment%rowtype; v_c public.contractor_compensation_version%rowtype; v_hours numeric; v_amount numeric; v_count int:=0; v_ir uuid; v_other numeric:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_outcome not in ('passed','waived') then raise exception 'QA outcome must be passed or waived'; end if;
  if p_outcome='passed' and (p_score is null or p_score<0 or p_score>100) then raise exception 'QA score must be between 0 and 100'; end if;
  if p_outcome='waived' and nullif(btrim(p_waiver_reason),'') is null then raise exception 'A governed QA waiver reason is required'; end if;
  select * into strict v_i from public.qa_inspection where id=p_qa_inspection_id for update;
  if not public.has_bu_role(v_i.organization_id,v_i.business_unit_id,array['owner_admin','office_ops','qa']::text[]) then raise exception 'QA finalization is not authorized for this territory'; end if;
  if v_i.inspection_status not in ('pending','in_progress') then raise exception 'QA inspection is already final'; end if;
  select * into strict v_job from public.operational_job where id=v_i.operational_job_id for update;
  select * into strict v_wo from public.work_order where id=v_i.work_order_id for update;
  if v_job.operational_status<>'qa_pending' or v_wo.work_order_status<>'service_complete' or v_wo.started_at is null or v_wo.service_completed_at is null then raise exception 'QA finalization requires governed start and completion timestamps'; end if;
  if exists(select 1 from public.corrective_action where operational_job_id=v_job.id and work_order_id=v_wo.id and action_status not in ('verified','cancelled')) then raise exception 'QA finalization is blocked by corrective action'; end if;
  v_hours:=round(greatest(extract(epoch from(v_wo.service_completed_at-v_wo.started_at))/3600,0)::numeric,4);
  update public.qa_inspection set inspection_status=p_outcome,score=case when p_outcome='passed' then p_score end,
    findings=case when nullif(btrim(p_findings),'') is null then findings else jsonb_build_object('summary',btrim(p_findings)) end,
    waiver_reason=case when p_outcome='waived' then btrim(p_waiver_reason) end,inspected_at=now(),updated_at=now() where id=v_i.id;
  update public.work_order set work_order_status='qa_complete',updated_by_app_user_id=v_actor where id=v_wo.id;
  update public.operational_job set operational_status='qa_passed',updated_by_app_user_id=v_actor where id=v_job.id;
  for v_a in select * from public.worker_assignment where operational_job_id=v_job.id and assignment_status='completed' order by id loop
    select * into v_c from public.contractor_compensation_version where worker_id=v_a.worker_id and organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id
      and compensation_method='hourly' and compensation_status in ('approved','active') and effective_from<=v_wo.service_completed_at and (effective_to is null or effective_to>=v_wo.service_completed_at)
      order by effective_from desc,id desc limit 1;
    if not found then raise exception 'Worker % has no approved hourly compensation version for the service date',v_a.worker_id; end if;
    v_amount:=round(v_c.rate_value*v_hours,2);
    insert into public.contractor_payable(organization_id,business_unit_id,worker_id,worker_assignment_id,operational_job_id,work_order_id,
      contractor_compensation_version_id,compensation_method,currency_code,basis_value,computed_amount,payable_status,eligibility_assessment,eligibility_passed,metadata,created_by_app_user_id)
    values(v_a.organization_id,v_a.business_unit_id,v_a.worker_id,v_a.id,v_job.id,v_wo.id,v_c.id,v_c.compensation_method,v_c.currency_code,
      v_hours,v_amount,'pending',jsonb_build_object('qa_outcome',p_outcome,'actual_hours',v_hours),true,
      jsonb_build_object('source','qa_finalization','actual_hours',v_hours,'hourly_rate',v_c.rate_value),v_actor)
    on conflict(worker_assignment_id,contractor_compensation_version_id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  if v_count=0 then raise exception 'QA finalization requires at least one completed worker assignment'; end if;
  select id into v_ir from public.invoice_request where operational_job_id=v_job.id and request_status<>'cancelled' order by created_at desc limit 1;
  insert into public.job_profitability_snapshot(organization_id,business_unit_id,operational_job_id,invoice_request_id,currency_code,
    recognized_revenue_amount,tax_amount,direct_labor_cost,other_direct_cost,source_lineage,metadata,created_by_app_user_id)
  select v_job.organization_id,v_job.business_unit_id,v_job.id,v_ir,ps.currency_code,ps.subtotal_amount,ps.tax_amount,
    (select coalesce(sum(computed_amount),0) from public.contractor_payable where operational_job_id=v_job.id and payable_status<>'voided'),v_other,
    jsonb_build_object('invoice_request_id',v_ir,'pricing_snapshot_id',ps.id,'quote_version_id',v_job.quote_version_id,'labor_basis','qa_earned_payables'),
    jsonb_build_object('snapshot_type','realized_at_qa','actual_hours',v_hours),v_actor from public.pricing_snapshot ps where ps.id=v_job.pricing_snapshot_id;
  insert into public.work_order_event(organization_id,business_unit_id,operational_job_id,work_order_id,event_type,event_at,actor_app_user_id,event_payload,metadata)
  values(v_job.organization_id,v_job.business_unit_id,v_job.id,v_wo.id,'qa_passed',now(),v_actor,jsonb_build_object('outcome',p_outcome,'score',p_score,'payables_created',v_count,'actual_hours',v_hours),jsonb_build_object('source','staff_finalize_qa_inspection'));
  return jsonb_build_object('inspection_id',v_i.id,'outcome',p_outcome,'operational_status','qa_passed','work_order_status','qa_complete','payables_created',v_count,'actual_hours',v_hours);
end; $$;
revoke all on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) from public,anon;
grant execute on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) to authenticated;

create or replace function public.staff_set_worker_weekly_capacity(p_worker_id uuid,p_week_start date,p_available_hours numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_w public.worker%rowtype; v_day date; v_minutes int; v_actor uuid:=public.current_app_user_id();
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_week_start is null or extract(isodow from p_week_start)<>1 then raise exception 'Week start must be a Monday'; end if;
 if p_available_hours is null or p_available_hours<0 or p_available_hours>120 then raise exception 'Weekly hours must be between 0 and 120'; end if;
 select * into strict v_w from public.worker where id=p_worker_id and status='active';
 v_minutes:=round(p_available_hours*60/5);
 for v_day in select generate_series(p_week_start,p_week_start+4,'1 day')::date loop
   insert into public.worker_capacity_calendar(organization_id,business_unit_id,worker_id,capacity_date,available_minutes,source,metadata)
   values(v_w.organization_id,v_w.business_unit_id,v_w.id,v_day,v_minutes,'staff_weekly_entry',jsonb_build_object('weekly_hours',p_available_hours,'updated_by',v_actor))
   on conflict(worker_id,capacity_date) do update set available_minutes=excluded.available_minutes,source=excluded.source,metadata=excluded.metadata,updated_at=now();
 end loop;
 return jsonb_build_object('worker_id',v_w.id,'week_start',p_week_start,'weekly_hours',p_available_hours,'days_written',5);
end; $$;
revoke all on function public.staff_set_worker_weekly_capacity(uuid,date,numeric) from public,anon;
grant execute on function public.staff_set_worker_weekly_capacity(uuid,date,numeric) to authenticated;

create or replace function public.service_role_set_location_geocode(p_service_location_id uuid,p_latitude numeric,p_longitude numeric,p_source text,p_precision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.service_location%rowtype;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Service-role geocode boundary only'; end if;
 if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 update public.service_location set latitude=round(p_latitude,7),longitude=round(p_longitude,7),
   metadata=metadata||jsonb_build_object('geocode_source',left(coalesce(p_source,'unknown'),80),'geocode_precision',left(coalesce(p_precision,'unknown'),40),'geocoded_at',now()),updated_at=now()
 where id=p_service_location_id returning * into strict v;
 return jsonb_build_object('service_location_id',v.id,'latitude',v.latitude,'longitude',v.longitude,'source',p_source,'precision',p_precision);
end; $$;
revoke all on function public.service_role_set_location_geocode(uuid,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.service_role_set_location_geocode(uuid,numeric,numeric,text,text) to service_role;

create or replace function public.sync_booking_recurring_cadence() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_cadence text:=lower(replace(coalesce(nullif(new.frequency,''),'one_time'),'-',''));
begin
 update public.service_request set requirements=coalesce(requirements,'{}'::jsonb)
   || jsonb_build_object('frequency',v_cadence,'scope',coalesce(requirements->'scope','{}'::jsonb)||jsonb_build_object('frequency',v_cadence)),updated_at=now()
 where id=new.service_request_id;
 update public.opportunity set metadata=metadata||jsonb_build_object('recurring_cadence',v_cadence),updated_at=now() where service_request_id=new.service_request_id;
 return new;
end; $$;
drop trigger if exists sync_booking_recurring_cadence on public.booking;
create trigger sync_booking_recurring_cadence after insert or update of frequency on public.booking for each row execute function public.sync_booking_recurring_cadence();

create or replace function public.ensure_work_order_recurring_cadence() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_frequency text;
begin
 v_frequency:=nullif(new.scope_snapshot->>'frequency','');
 if v_frequency is null then
   select lower(replace(coalesce(nullif(oj.service_scope_snapshot->>'frequency',''),nullif(sr.requirements#>>'{scope,frequency}',''),nullif(b.frequency,''),'one_time'),'-','')) into v_frequency
   from public.operational_job oj left join public.conversion_record cr on cr.id=oj.conversion_record_id left join public.opportunity o on o.id=cr.opportunity_id left join public.service_request sr on sr.id=o.service_request_id left join public.booking b on b.service_request_id=sr.id where oj.id=new.operational_job_id;
   new.scope_snapshot:=jsonb_set(new.scope_snapshot,'{frequency}',to_jsonb(coalesce(v_frequency,'one_time')),true);
 end if;
 return new;
end; $$;
drop trigger if exists a_ensure_work_order_recurring_cadence on public.work_order;
create trigger a_ensure_work_order_recurring_cadence before insert on public.work_order for each row execute function public.ensure_work_order_recurring_cadence();

create or replace function public.get_cleaner_payables_dashboard(p_organization_id uuid,p_business_unit_id uuid,p_limit integer default 250)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_code text; v_currency text; v_rows jsonb; v_pending numeric; v_approved numeric;
begin
 select code into strict v_code from public.business_unit where id=p_business_unit_id and organization_id=p_organization_id and status='active';
 v_currency:=case v_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end;
 if v_currency is null or not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops']::text[]) then raise exception 'Payables dashboard is not authorized for this territory'; end if;
 select coalesce(sum(computed_amount) filter(where payable_status='pending'),0),coalesce(sum(computed_amount) filter(where payable_status in('approved','paid')),0)
 into v_pending,v_approved from public.contractor_payable where organization_id=p_organization_id and business_unit_id=p_business_unit_id and currency_code=v_currency;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'worker_name',x.display_name,'work_order_number',x.work_order_number,
   'actual_hours',x.basis_value,'hourly_rate',x.rate_value,'compensation_method',x.compensation_method,'amount',x.computed_amount,
   'currency_code',x.currency_code,'status',x.payable_status,'created_at',x.created_at,'approved_at',x.approved_at) order by x.created_at desc),'[]'::jsonb)
 into v_rows from (select cp.*,w.display_name,wo.work_order_number,ccv.rate_value from public.contractor_payable cp join public.worker w on w.id=cp.worker_id
   join public.work_order wo on wo.id=cp.work_order_id join public.contractor_compensation_version ccv on ccv.id=cp.contractor_compensation_version_id
   where cp.organization_id=p_organization_id and cp.business_unit_id=p_business_unit_id and cp.currency_code=v_currency order by cp.created_at desc limit greatest(1,least(coalesce(p_limit,250),1000))) x;
 return jsonb_build_object('scope',jsonb_build_object('market_code',v_code,'currency_code',v_currency),'pending_total',v_pending,'approved_total',v_approved,'rows',v_rows);
end; $$;
revoke all on function public.get_cleaner_payables_dashboard(uuid,uuid,integer) from public,anon;
grant execute on function public.get_cleaner_payables_dashboard(uuid,uuid,integer) to authenticated;

create or replace function public.get_os10_intelligence_dashboard(p_organization_id uuid,p_business_unit_id uuid,p_date_from date default current_date,p_date_to date default(current_date+13))
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_code text; v_currency text; v_tz text; v_routes jsonb; v_capacity jsonb; v_retention jsonb; v_margin jsonb;
begin
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>92 then raise exception 'Intelligence period must be between 1 and 93 days'; end if;
 select code into strict v_code from public.business_unit where id=p_business_unit_id and organization_id=p_organization_id and status='active';
 v_currency:=case v_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end; v_tz:=case v_code when 'HUC-ON' then 'America/Toronto' else 'America/Phoenix' end;
 if v_currency is null or not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops']::text[]) then raise exception 'Intelligence dashboard is not authorized for this territory'; end if;
 with scoped as (select oj.id,(sw.scheduled_start at time zone v_tz)::date service_date,sw.scheduled_start,sl.latitude,sl.longitude
   from public.operational_job oj join public.schedule_window sw on sw.operational_job_id=oj.id join public.service_location sl on sl.id=oj.service_location_id
   where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and sw.status not in('cancelled','rescheduled')
   and (sw.scheduled_start at time zone v_tz)::date between p_date_from and p_date_to), jobs as (
   select *,lag(latitude) over(partition by service_date order by scheduled_start,id) prev_lat,lag(longitude) over(partition by service_date order by scheduled_start,id) prev_lon from scoped), d as (
   select *,case when latitude is null or longitude is null or prev_lat is null or prev_lon is null then null else 6371*2*asin(sqrt(power(sin(radians((latitude-prev_lat)/2)),2)+cos(radians(prev_lat))*cos(radians(latitude))*power(sin(radians((longitude-prev_lon)/2)),2))) end km from jobs)
 select coalesce(jsonb_agg(jsonb_build_object('date',service_date,'jobs',jobs,'geocoded_jobs',geocoded,'average_consecutive_km',avg_km,'density_score',case when geocoded<2 then null else greatest(0,least(100,round(100-coalesce(avg_km,50)*2))) end) order by service_date),'[]'::jsonb)
 into v_routes from (select service_date,count(*) jobs,count(latitude) geocoded,round(avg(km)::numeric,1) avg_km from d group by service_date) x;
 with days as(select generate_series(p_date_from,p_date_to,'1 day')::date service_day),a as(select capacity_date service_day,sum(available_minutes) available from public.worker_capacity_calendar where organization_id=p_organization_id and business_unit_id=p_business_unit_id and capacity_date between p_date_from and p_date_to group by 1),s as(
   select (sw.scheduled_start at time zone v_tz)::date service_day,sum(extract(epoch from(sw.scheduled_end-sw.scheduled_start))/60)::int booked from public.schedule_window sw join public.operational_job oj on oj.id=sw.operational_job_id where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and sw.status not in('cancelled','rescheduled') and (sw.scheduled_start at time zone v_tz)::date between p_date_from and p_date_to group by 1)
 select coalesce(jsonb_agg(jsonb_build_object('date',d.service_day,'available_minutes',a.available,'scheduled_minutes',coalesce(s.booked,0),'utilization_percent',case when a.available>0 then round(coalesce(s.booked,0)*100.0/a.available,1) end,'status',case when a.available is null then 'no_governed_data' when coalesce(s.booked,0)>a.available then 'overbooked' when coalesce(s.booked,0)>=a.available*.85 then 'warning' else 'available' end) order by d.service_day),'[]'::jsonb) into v_capacity from days d left join a using(service_day) left join s using(service_day);
 with completed as(select oj.customer_id,lower(replace(coalesce(nullif(oj.service_scope_snapshot->>'frequency',''),nullif(wo.scope_snapshot->>'frequency',''),nullif(sr.requirements#>>'{scope,frequency}',''),nullif(b.frequency,'')),'-','')) cadence,max(wo.service_completed_at)::date last_service
   from public.operational_job oj join public.work_order wo on wo.operational_job_id=oj.id left join public.conversion_record cr on cr.id=oj.conversion_record_id left join public.opportunity o on o.id=cr.opportunity_id left join public.service_request sr on sr.id=o.service_request_id left join public.booking b on b.service_request_id=sr.id
   where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and wo.service_completed_at is not null group by oj.customer_id,2), scored as(select *,case cadence when 'weekly' then 7 when 'biweekly' then 14 when 'monthly' then 30 end expected from completed)
 select coalesce(jsonb_agg(jsonb_build_object('cadence',cadence,'accounts',accounts,'at_risk',at_risk,'churn_signal',churned) order by cadence),'[]'::jsonb) into v_retention from(select cadence,count(*) accounts,count(*) filter(where current_date-last_service>expected*1.25) at_risk,count(*) filter(where current_date-last_service>expected*2) churned from scored where expected is not null group by cadence)x;
 with active as(select coalesce(qv.title,'Active service') job_label,round(greatest(extract(epoch from(now()-wo.started_at))/3600,0)::numeric,2) elapsed_hours,round(coalesce(nullif(ps.labor_economics->>'jobHours','')::numeric,extract(epoch from(sw.scheduled_end-sw.scheduled_start))/3600)::numeric,2) quoted_hours,
   round(ps.subtotal_amount-coalesce(nullif(ps.labor_economics->>'directLaborCost','')::numeric,0),2) quoted_margin,null::numeric actual_margin,null::numeric actual_margin_percent,'active_projection' record_type,
   case when extract(epoch from(now()-wo.started_at))/3600>coalesce(nullif(ps.labor_economics->>'jobHours','')::numeric,extract(epoch from(sw.scheduled_end-sw.scheduled_start))/3600)*1.15 then 'negative' when extract(epoch from(now()-wo.started_at))/3600>coalesce(nullif(ps.labor_economics->>'jobHours','')::numeric,extract(epoch from(sw.scheduled_end-sw.scheduled_start))/3600)*.9 then 'watch' else 'on_track' end drift_status
   from public.operational_job oj join public.work_order wo on wo.operational_job_id=oj.id join public.schedule_window sw on sw.operational_job_id=oj.id join public.pricing_snapshot ps on ps.id=oj.pricing_snapshot_id join public.quote_version qv on qv.id=oj.quote_version_id
   where oj.organization_id=p_organization_id and oj.business_unit_id=p_business_unit_id and wo.work_order_status='in_progress' and ps.currency_code=v_currency), completed as(
   select coalesce(qv.title,'Completed service') job_label,round((j.metadata->>'actual_hours')::numeric,2) elapsed_hours,round(coalesce(nullif(ps.labor_economics->>'jobHours','')::numeric,0),2) quoted_hours,round(ps.subtotal_amount-coalesce(nullif(ps.labor_economics->>'directLaborCost','')::numeric,0),2) quoted_margin,j.gross_contribution actual_margin,j.gross_margin_percent actual_margin_percent,'realized' record_type,
   case when j.gross_contribution<ps.subtotal_amount-coalesce(nullif(ps.labor_economics->>'directLaborCost','')::numeric,0) then 'negative' else 'on_track' end drift_status
   from(select distinct on(operational_job_id)* from public.job_profitability_snapshot where organization_id=p_organization_id and business_unit_id=p_business_unit_id and currency_code=v_currency order by operational_job_id,snapshot_taken_at desc,id desc)j join public.operational_job oj on oj.id=j.operational_job_id join public.pricing_snapshot ps on ps.id=oj.pricing_snapshot_id join public.quote_version qv on qv.id=oj.quote_version_id)
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_margin from(select * from active union all select * from completed limit 100)x;
 return jsonb_build_object('scope',jsonb_build_object('market_code',v_code,'currency_code',v_currency,'date_from',p_date_from,'date_to',p_date_to),'route_density',v_routes,'capacity',v_capacity,'retention',v_retention,'margin_drift',v_margin,'generated_at',now());
end; $$;
revoke all on function public.get_os10_intelligence_dashboard(uuid,uuid,date,date) from public,anon;
grant execute on function public.get_os10_intelligence_dashboard(uuid,uuid,date,date) to authenticated;

commit;
