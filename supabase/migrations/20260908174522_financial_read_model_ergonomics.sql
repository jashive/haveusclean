begin;

create or replace function public.get_financial_performance(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_market_code text; v_currency text; v_gross_bookings numeric:=0;
  v_cleaner_labor_accrued numeric:=0; v_payroll_pending numeric:=0;
  v_payroll_approved numeric:=0; v_payroll_paid numeric:=0;
  v_recognized_revenue numeric:=0; v_net_contribution numeric:=0;
  v_jobs_count integer:=0; v_jobs jsonb:='[]'::jsonb;
begin
  if p_period_start is null or p_period_end is null or p_period_end<=p_period_start
     or p_period_end-p_period_start>interval '370 days' then
    raise exception 'Financial performance period must be greater than zero and no longer than 370 days';
  end if;
  select code into v_market_code from public.business_unit
   where id=p_business_unit_id and organization_id=p_organization_id and status='active';
  v_currency:=case v_market_code when 'HUC-ON' then 'CAD' when 'HUC-AZ' then 'USD' end;
  if v_currency is null then raise exception 'Unsupported financial performance business unit'; end if;
  if not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin']::text[]) then
    raise exception 'Financial performance requires Owner/Admin access';
  end if;

  if exists(
    select 1 from public.quote_response qr
    join public.quote_version qv on qv.id=qr.quote_version_id and qv.organization_id=qr.organization_id and qv.business_unit_id=qr.business_unit_id
    join public.pricing_snapshot ps on ps.id=qv.pricing_snapshot_id
    where qr.organization_id=p_organization_id and qr.business_unit_id=p_business_unit_id
      and qr.response_type='accepted' and qr.responded_at>=p_period_start and qr.responded_at<p_period_end
      and ps.currency_code<>v_currency
  ) or exists(
    select 1 from public.contractor_payable cp join public.work_order wo on wo.id=cp.work_order_id
    where cp.organization_id=p_organization_id and cp.business_unit_id=p_business_unit_id
      and cp.payable_status<>'voided' and wo.service_completed_at>=p_period_start and wo.service_completed_at<p_period_end
      and cp.currency_code<>v_currency
  ) or exists(
    select 1 from public.job_profitability_snapshot jps
    join public.work_order wo on wo.operational_job_id=jps.operational_job_id
    where jps.organization_id=p_organization_id and jps.business_unit_id=p_business_unit_id
      and wo.service_completed_at>=p_period_start and wo.service_completed_at<p_period_end
      and jps.currency_code<>v_currency
  ) then raise exception 'Financial ledger currency does not match the selected territory'; end if;

  with accepted_quotes as (
    select distinct on(qv.quote_id) qv.quote_id,ps.subtotal_amount
    from public.quote_response qr
    join public.quote_version qv on qv.id=qr.quote_version_id and qv.organization_id=qr.organization_id and qv.business_unit_id=qr.business_unit_id
    join public.pricing_snapshot ps on ps.id=qv.pricing_snapshot_id
    where qr.organization_id=p_organization_id and qr.business_unit_id=p_business_unit_id
      and qr.response_type='accepted' and qr.responded_at>=p_period_start and qr.responded_at<p_period_end
    order by qv.quote_id,qr.responded_at desc,qr.id desc
  ) select coalesce(sum(subtotal_amount),0) into v_gross_bookings from accepted_quotes;

  select
    coalesce(sum(cp.computed_amount) filter(where cp.payable_status='pending'),0),
    coalesce(sum(cp.computed_amount) filter(where cp.payable_status='approved'),0),
    coalesce(sum(cp.computed_amount) filter(where cp.payable_status='paid'),0)
  into v_payroll_pending,v_payroll_approved,v_payroll_paid
  from public.contractor_payable cp join public.work_order wo on wo.id=cp.work_order_id
  where cp.organization_id=p_organization_id and cp.business_unit_id=p_business_unit_id
    and wo.service_completed_at>=p_period_start and wo.service_completed_at<p_period_end;

  with latest as (
    select distinct on(jps.operational_job_id)
      jps.id,jps.operational_job_id,jps.snapshot_taken_at,wo.service_completed_at,
      jps.recognized_revenue_amount,jps.direct_labor_cost,jps.other_direct_cost,
      jps.gross_contribution,jps.gross_margin_percent,qv.title
    from public.job_profitability_snapshot jps
    join public.operational_job oj on oj.id=jps.operational_job_id
    join public.work_order wo on wo.operational_job_id=oj.id and wo.service_completed_at is not null
    left join public.quote_version qv on qv.id=oj.quote_version_id
    where jps.organization_id=p_organization_id and jps.business_unit_id=p_business_unit_id
    order by jps.operational_job_id,jps.snapshot_taken_at desc,jps.id desc
  ), period_latest as (
    select * from latest where service_completed_at>=p_period_start and service_completed_at<p_period_end
  ), totals as (
    select count(*)::integer jobs_count,coalesce(sum(recognized_revenue_amount),0) recognized_revenue,
      coalesce(sum(direct_labor_cost),0) cleaner_labor_accrued,coalesce(sum(gross_contribution),0) net_contribution
    from period_latest
  ), job_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'snapshot_id',id,'operational_job_id',operational_job_id,'job_label',coalesce(nullif(title,''),'Completed service'),
      'service_completed_at',service_completed_at,'snapshot_taken_at',snapshot_taken_at,
      'recognized_revenue',recognized_revenue_amount,'cleaner_cost',direct_labor_cost,
      'other_direct_cost',other_direct_cost,'net_contribution',gross_contribution,
      'contribution_margin_percent',gross_margin_percent
    ) order by service_completed_at desc),'[]'::jsonb) jobs
    from(select * from period_latest order by service_completed_at desc limit 100) compact
  ) select totals.jobs_count,totals.recognized_revenue,totals.cleaner_labor_accrued,totals.net_contribution,job_rows.jobs
    into v_jobs_count,v_recognized_revenue,v_cleaner_labor_accrued,v_net_contribution,v_jobs
    from totals cross join job_rows;

  return jsonb_build_object(
    'scope',jsonb_build_object('market_code',v_market_code,'currency_code',v_currency,'period_start',p_period_start,'period_end',p_period_end),
    'kpis',jsonb_build_object(
      'gross_bookings',v_gross_bookings,'recognized_revenue',v_recognized_revenue,
      'cleaner_labor_accrued',v_cleaner_labor_accrued,'payroll_pending',v_payroll_pending,
      'payroll_approved',v_payroll_approved,'payroll_paid',v_payroll_paid,
      'net_contribution',v_net_contribution,
      'contribution_margin_percent',case when v_recognized_revenue=0 then null else round((v_net_contribution/v_recognized_revenue)*100,2) end,
      'jobs_count',v_jobs_count
    ),
    'unit_economics',jsonb_build_object(
      'jobs_count',v_jobs_count,
      'recognized_revenue_per_job',case when v_jobs_count=0 then null else round(v_recognized_revenue/v_jobs_count,2) end,
      'net_contribution_per_job',case when v_jobs_count=0 then null else round(v_net_contribution/v_jobs_count,2) end
    ),
    'jobs',v_jobs,'generated_at',now()
  );
end; $$;

revoke all on function public.get_financial_performance(uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_financial_performance(uuid,uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.staff_finalize_qa_inspection(
  p_qa_inspection_id uuid,p_outcome text,p_score numeric default null,p_findings text default null,p_waiver_reason text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_i public.qa_inspection%rowtype; v_job public.operational_job%rowtype; v_wo public.work_order%rowtype; v_actor uuid:=public.current_app_user_id();
  v_a public.worker_assignment%rowtype; v_c public.contractor_compensation_version%rowtype; v_hours numeric; v_amount numeric; v_count int:=0; v_ir uuid; v_other numeric:=0;
  v_snapshot public.job_profitability_snapshot%rowtype;
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
  if exists(select 1 from public.corrective_action where operational_job_id=v_job.id and work_order_id=v_wo.id and action_status not in('verified','cancelled')) then raise exception 'QA finalization is blocked by corrective action'; end if;
  v_hours:=round(greatest(extract(epoch from(v_wo.service_completed_at-v_wo.started_at))/3600,0)::numeric,4);
  update public.qa_inspection set inspection_status=p_outcome,score=case when p_outcome='passed' then p_score end,
    findings=case when nullif(btrim(p_findings),'') is null then findings else jsonb_build_object('summary',btrim(p_findings)) end,
    waiver_reason=case when p_outcome='waived' then btrim(p_waiver_reason) end,inspected_at=now(),updated_at=now() where id=v_i.id;
  update public.work_order set work_order_status='qa_complete',updated_by_app_user_id=v_actor where id=v_wo.id;
  update public.operational_job set operational_status='qa_passed',updated_by_app_user_id=v_actor where id=v_job.id;
  for v_a in select * from public.worker_assignment where operational_job_id=v_job.id and assignment_status='completed' order by id loop
    select * into v_c from public.contractor_compensation_version where worker_id=v_a.worker_id and organization_id=v_a.organization_id and business_unit_id=v_a.business_unit_id
      and compensation_method='hourly' and compensation_status in('approved','active','retired') and effective_from<=v_wo.service_completed_at and(effective_to is null or effective_to>=v_wo.service_completed_at)
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
    jsonb_build_object('snapshot_type','realized_at_qa','actual_hours',v_hours),v_actor from public.pricing_snapshot ps where ps.id=v_job.pricing_snapshot_id
  returning * into v_snapshot;
  insert into public.work_order_event(organization_id,business_unit_id,operational_job_id,work_order_id,event_type,event_at,actor_app_user_id,event_payload,metadata)
  values(v_job.organization_id,v_job.business_unit_id,v_job.id,v_wo.id,'qa_passed',now(),v_actor,jsonb_build_object('outcome',p_outcome,'score',p_score,'payables_created',v_count,'actual_hours',v_hours),jsonb_build_object('source','staff_finalize_qa_inspection'));
  return jsonb_build_object(
    'inspection_id',v_i.id,'outcome',p_outcome,'operational_status','qa_passed','work_order_status','qa_complete','payables_created',v_count,'actual_hours',v_hours,
    'financial_summary',jsonb_build_object(
      'snapshot_id',v_snapshot.id,'currency_code',v_snapshot.currency_code,
      'recognized_revenue_amount',v_snapshot.recognized_revenue_amount,
      'direct_labor_cost',v_snapshot.direct_labor_cost,'other_direct_cost',v_snapshot.other_direct_cost,
      'net_contribution',v_snapshot.gross_contribution,'gross_margin_percent',v_snapshot.gross_margin_percent,
      'payroll_status','pending','snapshot_taken_at',v_snapshot.snapshot_taken_at
    )
  );
end; $$;

revoke all on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) from public, anon;
grant execute on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) to authenticated;

commit;
