-- Additive ServiceOS role/workflow hardening. This migration is intentionally unapplied.
create or replace function public.huc_enforce_serviceos_work_order_actor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_app_user public.app_user%rowtype;
  v_worker public.worker%rowtype;
  v_role text;
  v_assigned_worker uuid;
begin
  select * into strict v_app_user from public.app_user
   where auth_user_id = auth.uid() and status = 'active';
  select ar.code into strict v_role
    from public.user_membership um join public.app_role ar on ar.id = um.role_id
   where um.app_user_id = v_app_user.id and um.organization_id = new.organization_id
     and um.status = 'active' and ar.code in ('owner_admin','office_ops','worker','qa');

  if tg_table_name in ('work_order_event','completion_evidence','service_checklist_result') then
    if v_role <> 'worker' then raise exception 'worker role required'; end if;
    select * into strict v_worker from public.worker
     where app_user_id = v_app_user.id and organization_id = new.organization_id
       and business_unit_id = new.business_unit_id and status = 'active';
    select wa.worker_id into strict v_assigned_worker
      from public.work_order wo join public.worker_assignment wa on wa.operational_job_id = wo.operational_job_id
     where wo.id = new.work_order_id and wa.status = 'active';
    if v_assigned_worker <> v_worker.id then raise exception 'exact current worker assignment required'; end if;
    if tg_table_name = 'work_order_event' and new.event_type not in
      ('acknowledged','started','checklist_updated','evidence_added','completed') then
      raise exception 'worker event type not allowed';
    end if;
    if new.app_user_id is distinct from v_app_user.id or new.worker_id is distinct from v_worker.id then
      raise exception 'actor spoofing rejected';
    end if;
  elsif tg_table_name = 'qa_inspection' then
    if v_role <> 'qa' then raise exception 'qa role required'; end if;
    if new.inspector_app_user_id is distinct from v_app_user.id then raise exception 'qa attribution spoofing rejected'; end if;
    if new.inspector_worker_id is not null and not exists (
      select 1 from public.worker w where w.id = new.inspector_worker_id
       and w.organization_id = new.organization_id and w.business_unit_id = new.business_unit_id
    ) then raise exception 'inspector worker outside organization/business unit'; end if;
  elsif v_role not in ('owner_admin','office_ops') then
    raise exception 'office role required';
  elsif tg_table_name = 'work_order_event' and new.event_type not in ('scheduled','assigned','dispatched','cancelled') then
    raise exception 'office event type not allowed';
  end if;
  return new;
end $$;

revoke all on function public.huc_enforce_serviceos_work_order_actor() from public, anon, authenticated;

do $$ begin
  create trigger huc_work_order_event_actor before insert or update on public.work_order_event
    for each row execute function public.huc_enforce_serviceos_work_order_actor();
  create trigger huc_completion_evidence_actor before insert or update on public.completion_evidence
    for each row execute function public.huc_enforce_serviceos_work_order_actor();
  create trigger huc_checklist_actor before insert or update on public.service_checklist_result
    for each row execute function public.huc_enforce_serviceos_work_order_actor();
  create trigger huc_qa_inspection_actor before insert or update on public.qa_inspection
    for each row execute function public.huc_enforce_serviceos_work_order_actor();
end $$;
