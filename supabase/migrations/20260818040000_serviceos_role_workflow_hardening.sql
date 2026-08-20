-- Additive ServiceOS role/workflow hardening. Never applied to production by source recovery.
create or replace function public.huc_enforce_serviceos_work_order_actor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_app_user public.app_user%rowtype;
  v_worker public.worker%rowtype;
  v_roles text[];
  v_assignment public.worker_assignment%rowtype;
  v_actor_app_user uuid := nullif(to_jsonb(new)->>'actor_app_user_id','')::uuid;
  v_actor_worker uuid := nullif(to_jsonb(new)->>'actor_worker_id','')::uuid;
begin
  select * into strict v_app_user from public.app_user
   where auth_user_id=auth.uid() and status='active';
  select array_agg(distinct ar.code order by ar.code) into v_roles
    from public.user_membership um join public.app_role ar on ar.id=um.role_id
   where um.app_user_id=v_app_user.id and um.organization_id=new.organization_id
     and um.status='active';
  if coalesce(cardinality(v_roles),0) <> 1 or v_roles[1] not in ('owner_admin','office_ops','worker','qa') then
    raise exception 'exactly one canonical role is required';
  end if;

  if tg_table_name in ('work_order_event','completion_evidence','service_checklist_result') then
    if v_roles[1] <> 'worker' then raise exception 'worker role required'; end if;
    select * into strict v_worker from public.worker
     where app_user_id=v_app_user.id and organization_id=new.organization_id
       and business_unit_id=new.business_unit_id and status='active';
    select * into strict v_assignment from public.worker_assignment
     where operational_job_id=new.operational_job_id and worker_id=v_worker.id
       and assignment_status in ('assigned','acknowledged');
    if tg_table_name <> 'service_checklist_result'
       and nullif(to_jsonb(new)->>'worker_assignment_id','')::uuid is distinct from v_assignment.id then
      raise exception 'exact current worker assignment required';
    end if;
    if tg_table_name='work_order_event' then
      if new.event_type not in ('assignment_acknowledged','arrived','work_started','paused','resumed','work_completed','completion_submitted') then
        raise exception 'worker event type not allowed';
      end if;
      if v_actor_app_user is distinct from v_app_user.id or v_actor_worker is distinct from v_worker.id then
        raise exception 'actor spoofing rejected';
      end if;
    elsif tg_table_name='completion_evidence' then
      if nullif(to_jsonb(new)->>'captured_by_app_user_id','')::uuid is distinct from v_app_user.id
         or nullif(to_jsonb(new)->>'captured_by_worker_id','')::uuid is distinct from v_worker.id then
        raise exception 'evidence actor spoofing rejected';
      end if;
    else
      if nullif(to_jsonb(new)->>'completed_by_app_user_id','')::uuid is distinct from v_app_user.id
         or nullif(to_jsonb(new)->>'completed_by_worker_id','')::uuid is distinct from v_worker.id then
        raise exception 'checklist actor spoofing rejected';
      end if;
    end if;
  elsif tg_table_name='qa_inspection' then
    if v_roles[1] <> 'qa' then raise exception 'qa role required'; end if;
    if new.inspector_app_user_id is distinct from v_app_user.id then raise exception 'qa attribution spoofing rejected'; end if;
    if new.inspector_worker_id is not null and not exists (
      select 1 from public.worker w where w.id=new.inspector_worker_id
       and w.organization_id=new.organization_id and w.business_unit_id=new.business_unit_id
    ) then raise exception 'inspector worker outside organization/business unit'; end if;
  end if;
  return new;
end $$;

revoke all on function public.huc_enforce_serviceos_work_order_actor() from public,anon,authenticated;
grant execute on function public.huc_enforce_serviceos_work_order_actor() to service_role;

create trigger huc_work_order_event_actor before insert or update on public.work_order_event
 for each row execute function public.huc_enforce_serviceos_work_order_actor();
create trigger huc_completion_evidence_actor before insert or update on public.completion_evidence
 for each row execute function public.huc_enforce_serviceos_work_order_actor();
create trigger huc_checklist_actor before insert or update on public.service_checklist_result
 for each row execute function public.huc_enforce_serviceos_work_order_actor();
create trigger huc_qa_inspection_actor before insert or update on public.qa_inspection
 for each row execute function public.huc_enforce_serviceos_work_order_actor();

-- Corrective-action scope validation must be able to validate an assigned worker
-- without widening QA's direct SELECT visibility on public.worker. The validator is
-- trigger-only, reads only canonical scope records, and rejects cross-org/BU workers.
create or replace function public.wave3_validate_ca_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oj public.operational_job%rowtype;
  v_wo public.work_order%rowtype;
  v_qi public.qa_inspection%rowtype;
  v_aw public.worker%rowtype;
begin
  select * into v_oj from public.operational_job where id = new.operational_job_id;
  if not found then raise exception 'corrective_action: operational_job % not found', new.operational_job_id; end if;
  if v_oj.organization_id is distinct from new.organization_id then raise exception 'corrective_action: organization_id mismatch'; end if;
  if v_oj.business_unit_id is distinct from new.business_unit_id then raise exception 'corrective_action: business_unit_id mismatch'; end if;

  if new.work_order_id is not null then
    select * into v_wo from public.work_order where id = new.work_order_id;
    if not found then raise exception 'corrective_action: work_order % not found', new.work_order_id; end if;
    if v_wo.operational_job_id is distinct from new.operational_job_id then
      raise exception 'corrective_action: work_order does not belong to declared operational_job';
    end if;
  end if;

  if new.qa_inspection_id is not null then
    select * into v_qi from public.qa_inspection where id = new.qa_inspection_id;
    if not found then raise exception 'corrective_action: qa_inspection % not found', new.qa_inspection_id; end if;
    if v_qi.operational_job_id is distinct from new.operational_job_id then
      raise exception 'corrective_action: qa_inspection does not belong to declared operational_job';
    end if;
    if new.work_order_id is not null and v_qi.work_order_id is not null
       and v_qi.work_order_id is distinct from new.work_order_id then
      raise exception 'corrective_action: qa_inspection does not belong to declared work_order';
    end if;
  end if;

  if new.assigned_worker_id is not null then
    select * into v_aw from public.worker where id = new.assigned_worker_id;
    if not found then raise exception 'corrective_action: assigned_worker % not found', new.assigned_worker_id; end if;
    if v_aw.organization_id is distinct from new.organization_id then
      raise exception 'corrective_action: assigned_worker does not belong to same organization';
    end if;
    if v_aw.business_unit_id is distinct from new.business_unit_id then
      raise exception 'corrective_action: assigned_worker does not belong to same business unit';
    end if;
  end if;

  return new;
end $$;

revoke all on function public.wave3_validate_ca_scope() from public,anon,authenticated;
grant execute on function public.wave3_validate_ca_scope() to service_role;
