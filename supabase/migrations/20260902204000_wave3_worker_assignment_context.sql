create or replace function public.worker_get_assignment_context(p_worker_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.worker_assignment%rowtype;
  v_job public.operational_job%rowtype;
  v_work_order public.work_order%rowtype;
  v_schedule public.schedule_window%rowtype;
  v_worker_id uuid;
  v_customer_name text;
  v_address text;
  v_city text;
  v_subdivision text;
  v_quote_title text;
  v_requirements jsonb := '{}'::jsonb;
  v_scope jsonb := '{}'::jsonb;
  v_customer_instructions jsonb := '{}'::jsonb;
  v_checklist jsonb := '{}'::jsonb;
begin
  select * into v_assignment
  from public.worker_assignment
  where id = p_worker_assignment_id;

  if not found then
    raise exception 'worker context: assignment not found';
  end if;

  v_worker_id := public.current_worker_id(v_assignment.organization_id);
  if v_worker_id is null or v_worker_id <> v_assignment.worker_id then
    raise exception 'worker context: assignment is not owned by current worker';
  end if;

  if v_assignment.assignment_status in ('declined','released','cancelled') then
    raise exception 'worker context: assignment is not active';
  end if;

  select * into v_job from public.operational_job where id = v_assignment.operational_job_id;
  select * into v_work_order from public.work_order where operational_job_id = v_job.id;
  select * into v_schedule from public.schedule_window where id = v_assignment.schedule_window_id;

  select c.display_name, sl.address_line1, sl.city, sl.subdivision, qv.title,
         coalesce(sr.requirements,'{}'::jsonb)
  into v_customer_name, v_address, v_city, v_subdivision, v_quote_title, v_requirements
  from public.operational_job oj
  join public.customer c on c.id = oj.customer_id
  join public.service_location sl on sl.id = oj.service_location_id
  join public.quote_version qv on qv.id = oj.quote_version_id
  left join public.job_handoff jh on jh.id = oj.job_handoff_id
  left join public.conversion_record cr on cr.id = jh.conversion_record_id
  left join public.opportunity o on o.id = cr.opportunity_id
  left join public.service_request sr on sr.id = o.service_request_id
  where oj.id = v_job.id;

  v_scope := case
    when v_work_order.scope_snapshot is not null and v_work_order.scope_snapshot <> '{}'::jsonb
      then v_work_order.scope_snapshot
    else coalesce(v_requirements->'scope','{}'::jsonb)
  end;

  v_customer_instructions := case
    when v_work_order.customer_instruction_snapshot is not null and v_work_order.customer_instruction_snapshot <> '{}'::jsonb
      then v_work_order.customer_instruction_snapshot
    else jsonb_build_object('notes', coalesce(v_scope->>'notes',''))
  end;

  v_checklist := case
    when v_work_order.checklist_template_snapshot is not null and v_work_order.checklist_template_snapshot <> '{}'::jsonb
      then v_work_order.checklist_template_snapshot
    else jsonb_build_object('package', coalesce(v_scope->>'packageKey',''), 'service_family', v_job.service_family)
  end;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'assignment_status', v_assignment.assignment_status,
    'operational_job_id', v_job.id,
    'operational_status', v_job.operational_status,
    'work_order_id', v_work_order.id,
    'work_order_status', v_work_order.work_order_status,
    'customer_name', coalesce(v_customer_name, v_requirements->'customer'->>'name','Customer'),
    'service_title', coalesce(v_quote_title,'Cleaning service'),
    'address_line1', v_address,
    'city', v_city,
    'subdivision', v_subdivision,
    'scheduled_start', v_schedule.scheduled_start,
    'scheduled_end', v_schedule.scheduled_end,
    'timezone', v_schedule.timezone,
    'scope', v_scope,
    'customer_instructions', v_customer_instructions,
    'access_instructions', coalesce(v_work_order.access_instruction_snapshot,'{}'::jsonb),
    'checklist', v_checklist
  );
end;
$$;

revoke all on function public.worker_get_assignment_context(uuid) from public;
grant execute on function public.worker_get_assignment_context(uuid) to authenticated;
