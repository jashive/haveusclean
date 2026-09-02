create or replace function public.worker_start_assigned_job(p_worker_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.worker_assignment%rowtype;
  v_job public.operational_job%rowtype;
  v_work_order public.work_order%rowtype;
  v_worker_id uuid;
  v_now timestamptz := now();
begin
  select * into v_assignment
  from public.worker_assignment
  where id = p_worker_assignment_id
  for update;

  if not found then
    raise exception 'worker execution: assignment not found';
  end if;

  v_worker_id := public.current_worker_id(v_assignment.organization_id);
  if v_worker_id is null or v_worker_id <> v_assignment.worker_id then
    raise exception 'worker execution: assignment is not owned by current worker';
  end if;

  if v_assignment.assignment_status <> 'acknowledged' then
    raise exception 'worker execution: assignment must be acknowledged before start';
  end if;

  select * into v_job
  from public.operational_job
  where id = v_assignment.operational_job_id
  for update;

  select * into v_work_order
  from public.work_order
  where operational_job_id = v_assignment.operational_job_id
  for update;

  if v_job.business_unit_id <> v_assignment.business_unit_id
     or v_work_order.business_unit_id <> v_assignment.business_unit_id then
    raise exception 'worker execution: business unit mismatch';
  end if;

  if v_job.operational_status not in ('dispatched','in_progress') then
    raise exception 'worker execution: job must be dispatched before start';
  end if;

  if v_work_order.work_order_status not in ('published','in_progress') then
    raise exception 'worker execution: work order must be published before start';
  end if;

  if not exists (
    select 1 from public.work_order_event
    where work_order_id = v_work_order.id
      and worker_assignment_id = v_assignment.id
      and event_type = 'arrived'
  ) then
    insert into public.work_order_event (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      worker_assignment_id,event_type,event_at,actor_app_user_id,actor_worker_id,
      event_payload,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      v_assignment.id,'arrived',v_now,public.current_app_user_id(),v_worker_id,
      '{}'::jsonb,jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if not exists (
    select 1 from public.work_order_event
    where work_order_id = v_work_order.id
      and worker_assignment_id = v_assignment.id
      and event_type = 'work_started'
  ) then
    insert into public.work_order_event (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      worker_assignment_id,event_type,event_at,actor_app_user_id,actor_worker_id,
      event_payload,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      v_assignment.id,'work_started',v_now,public.current_app_user_id(),v_worker_id,
      '{}'::jsonb,jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if v_work_order.work_order_status = 'published' then
    update public.work_order
    set work_order_status = 'in_progress', started_at = coalesce(started_at,v_now), updated_by_app_user_id = public.current_app_user_id()
    where id = v_work_order.id;
  end if;

  if v_job.operational_status = 'dispatched' then
    update public.operational_job
    set operational_status = 'in_progress', updated_by_app_user_id = public.current_app_user_id()
    where id = v_job.id;
  end if;

  return jsonb_build_object(
    'assignment_id',v_assignment.id,
    'operational_job_id',v_job.id,
    'work_order_id',v_work_order.id,
    'assignment_status','acknowledged',
    'operational_status','in_progress',
    'work_order_status','in_progress'
  );
end;
$$;

create or replace function public.worker_submit_completion_to_qa(
  p_worker_assignment_id uuid,
  p_completion_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.worker_assignment%rowtype;
  v_job public.operational_job%rowtype;
  v_work_order public.work_order%rowtype;
  v_worker_id uuid;
  v_now timestamptz := now();
  v_note text := nullif(btrim(p_completion_note),'');
begin
  if v_note is null then
    raise exception 'worker execution: completion note is required';
  end if;

  select * into v_assignment
  from public.worker_assignment
  where id = p_worker_assignment_id
  for update;

  if not found then
    raise exception 'worker execution: assignment not found';
  end if;

  v_worker_id := public.current_worker_id(v_assignment.organization_id);
  if v_worker_id is null or v_worker_id <> v_assignment.worker_id then
    raise exception 'worker execution: assignment is not owned by current worker';
  end if;

  if v_assignment.assignment_status not in ('acknowledged','completed') then
    raise exception 'worker execution: assignment must be acknowledged before completion';
  end if;

  select * into v_job
  from public.operational_job
  where id = v_assignment.operational_job_id
  for update;

  select * into v_work_order
  from public.work_order
  where operational_job_id = v_assignment.operational_job_id
  for update;

  if v_job.business_unit_id <> v_assignment.business_unit_id
     or v_work_order.business_unit_id <> v_assignment.business_unit_id then
    raise exception 'worker execution: business unit mismatch';
  end if;

  if v_job.operational_status not in ('in_progress','service_complete','qa_pending') then
    raise exception 'worker execution: job is not in a completable state';
  end if;

  if v_work_order.work_order_status not in ('in_progress','service_complete') then
    raise exception 'worker execution: work order is not in a completable state';
  end if;

  if not exists (
    select 1 from public.completion_evidence
    where work_order_id = v_work_order.id
      and worker_assignment_id = v_assignment.id
      and evidence_type = 'note'
      and evidence_payload->>'note' = v_note
  ) then
    insert into public.completion_evidence (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      worker_assignment_id,evidence_type,evidence_payload,captured_at,
      captured_by_worker_id,captured_by_app_user_id,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      v_assignment.id,'note',jsonb_build_object('note',v_note),v_now,
      v_worker_id,public.current_app_user_id(),jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if not exists (
    select 1 from public.service_checklist_result
    where work_order_id = v_work_order.id
      and checklist_item_key = 'worker_completion_confirmation'
  ) then
    insert into public.service_checklist_result (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      checklist_item_key,checklist_item_label,result_status,result_payload,
      completed_by_worker_id,completed_by_app_user_id,completed_at,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      'worker_completion_confirmation','Worker completion confirmation','pass',jsonb_build_object('note',v_note),
      v_worker_id,public.current_app_user_id(),v_now,jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if not exists (
    select 1 from public.work_order_event
    where work_order_id = v_work_order.id
      and worker_assignment_id = v_assignment.id
      and event_type = 'work_completed'
  ) then
    insert into public.work_order_event (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      worker_assignment_id,event_type,event_at,actor_app_user_id,actor_worker_id,event_payload,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      v_assignment.id,'work_completed',v_now,public.current_app_user_id(),v_worker_id,
      '{}'::jsonb,jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if not exists (
    select 1 from public.work_order_event
    where work_order_id = v_work_order.id
      and worker_assignment_id = v_assignment.id
      and event_type = 'completion_submitted'
  ) then
    insert into public.work_order_event (
      organization_id,business_unit_id,operational_job_id,work_order_id,
      worker_assignment_id,event_type,event_at,actor_app_user_id,actor_worker_id,event_payload,metadata
    ) values (
      v_assignment.organization_id,v_assignment.business_unit_id,v_job.id,v_work_order.id,
      v_assignment.id,'completion_submitted',v_now,public.current_app_user_id(),v_worker_id,
      '{}'::jsonb,jsonb_build_object('source','worker_execution_rpc')
    );
  end if;

  if v_work_order.work_order_status = 'in_progress' then
    update public.work_order
    set work_order_status = 'service_complete', service_completed_at = coalesce(service_completed_at,v_now), updated_by_app_user_id = public.current_app_user_id()
    where id = v_work_order.id;
  end if;

  if v_job.operational_status = 'in_progress' then
    update public.operational_job
    set operational_status = 'service_complete', updated_by_app_user_id = public.current_app_user_id()
    where id = v_job.id;
    v_job.operational_status := 'service_complete';
  end if;

  if v_job.operational_status = 'service_complete' then
    update public.operational_job
    set operational_status = 'qa_pending', updated_by_app_user_id = public.current_app_user_id()
    where id = v_job.id;
  end if;

  if v_assignment.assignment_status = 'acknowledged' then
    update public.worker_assignment
    set assignment_status = 'completed', updated_by_app_user_id = public.current_app_user_id()
    where id = v_assignment.id;
  end if;

  return jsonb_build_object(
    'assignment_id',v_assignment.id,
    'operational_job_id',v_job.id,
    'work_order_id',v_work_order.id,
    'assignment_status','completed',
    'operational_status','qa_pending',
    'work_order_status','service_complete'
  );
end;
$$;

revoke all on function public.worker_start_assigned_job(uuid) from public;
revoke all on function public.worker_submit_completion_to_qa(uuid,text) from public;
grant execute on function public.worker_start_assigned_job(uuid) to authenticated;
grant execute on function public.worker_submit_completion_to_qa(uuid,text) to authenticated;
