-- Governed QA completion, private photo evidence, and durable operations alerts.
begin;

-- Office Operations may perform the same scoped inspection review that the UI
-- exposes. Lifecycle transitions remain guarded by the atomic RPC below.
drop policy if exists pol_qi_office_ops_select on public.qa_inspection;
create policy pol_qi_office_ops_all on public.qa_inspection
for all to authenticated
using (public.has_bu_role(organization_id, business_unit_id, array['office_ops']::text[]))
with check (public.has_bu_role(organization_id, business_unit_id, array['office_ops']::text[]));

create or replace function public.staff_finalize_qa_inspection(
  p_qa_inspection_id uuid,
  p_outcome text,
  p_score numeric default null,
  p_findings text default null,
  p_waiver_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inspection public.qa_inspection%rowtype;
  v_job public.operational_job%rowtype;
  v_work_order public.work_order%rowtype;
  v_actor uuid := public.current_app_user_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_outcome not in ('passed','waived') then raise exception 'QA outcome must be passed or waived'; end if;
  if p_outcome='passed' and (p_score is null or p_score < 0 or p_score > 100) then
    raise exception 'QA score must be between 0 and 100';
  end if;
  if p_outcome='waived' and nullif(btrim(p_waiver_reason),'') is null then
    raise exception 'A governed QA waiver reason is required';
  end if;

  select * into strict v_inspection from public.qa_inspection where id=p_qa_inspection_id for update;
  if not public.has_bu_role(v_inspection.organization_id,v_inspection.business_unit_id,array['owner_admin','office_ops','qa']::text[]) then
    raise exception 'QA finalization is not authorized for this territory';
  end if;
  if v_inspection.inspection_status not in ('pending','in_progress') then
    raise exception 'QA inspection is already final';
  end if;
  select * into strict v_job from public.operational_job where id=v_inspection.operational_job_id for update;
  select * into strict v_work_order from public.work_order where id=v_inspection.work_order_id for update;
  if v_job.operational_status <> 'qa_pending' or v_work_order.work_order_status <> 'service_complete' then
    raise exception 'QA finalization requires qa_pending / service_complete';
  end if;

  update public.qa_inspection set
    inspection_status=p_outcome,
    score=case when p_outcome='passed' then p_score else null end,
    findings=case when nullif(btrim(p_findings),'') is null then findings else jsonb_build_object('summary',btrim(p_findings)) end,
    waiver_reason=case when p_outcome='waived' then btrim(p_waiver_reason) else null end,
    inspected_at=now(), updated_at=now()
  where id=v_inspection.id;

  update public.work_order set work_order_status='qa_complete', updated_by_app_user_id=v_actor where id=v_work_order.id;
  update public.operational_job set operational_status='qa_passed', updated_by_app_user_id=v_actor where id=v_job.id;
  insert into public.work_order_event (
    organization_id,business_unit_id,operational_job_id,work_order_id,event_type,event_at,
    actor_app_user_id,event_payload,metadata
  ) values (
    v_job.organization_id,v_job.business_unit_id,v_job.id,v_work_order.id,'qa_passed',now(),v_actor,
    jsonb_build_object('outcome',p_outcome,'score',p_score,'waiver_reason',case when p_outcome='waived' then btrim(p_waiver_reason) else null end),
    jsonb_build_object('source','staff_finalize_qa_inspection')
  );
  return jsonb_build_object('inspection_id',v_inspection.id,'outcome',p_outcome,'operational_status','qa_passed','work_order_status','qa_complete');
end;
$$;
revoke all on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) from public, anon;
grant execute on function public.staff_finalize_qa_inspection(uuid,text,numeric,text,text) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('serviceos-completion-evidence','serviceos-completion-evidence',false,12582912,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.worker_can_write_completion_object(p_name text)
returns boolean language plpgsql stable security definer set search_path=public,storage,pg_temp as $$
declare p text[] := storage.foldername(p_name); v_assignment public.worker_assignment%rowtype; v_job public.operational_job%rowtype;
begin
  if auth.uid() is null or array_length(p,1) <> 4 then return false; end if;
  select * into v_assignment from public.worker_assignment where id=p[4]::uuid;
  if not found or v_assignment.assignment_status not in ('assigned','acknowledged') then return false; end if;
  select * into strict v_job from public.operational_job where id=v_assignment.operational_job_id;
  return p[1]::uuid=v_assignment.organization_id and p[2]::uuid=v_assignment.business_unit_id
    and p[3]::uuid=v_job.id and v_assignment.worker_id=public.current_worker_id(v_assignment.organization_id);
exception when invalid_text_representation or no_data_found then return false;
end; $$;

create or replace function public.can_read_completion_object(p_name text)
returns boolean language plpgsql stable security definer set search_path=public,storage,pg_temp as $$
declare p text[] := storage.foldername(p_name); v_assignment public.worker_assignment%rowtype;
begin
  if auth.uid() is null or array_length(p,1) <> 4 then return false; end if;
  select * into strict v_assignment from public.worker_assignment where id=p[4]::uuid;
  return (p[1]::uuid=v_assignment.organization_id and p[2]::uuid=v_assignment.business_unit_id and p[3]::uuid=v_assignment.operational_job_id)
    and (v_assignment.worker_id=public.current_worker_id(v_assignment.organization_id)
      or public.has_bu_role(v_assignment.organization_id,v_assignment.business_unit_id,array['owner_admin','office_ops','qa']::text[]));
exception when invalid_text_representation or no_data_found then return false;
end; $$;
revoke all on function public.worker_can_write_completion_object(text) from public, anon;
revoke all on function public.can_read_completion_object(text) from public, anon;
grant execute on function public.worker_can_write_completion_object(text), public.can_read_completion_object(text) to authenticated;

drop policy if exists serviceos_completion_worker_insert on storage.objects;
create policy serviceos_completion_worker_insert on storage.objects for insert to authenticated
with check (bucket_id='serviceos-completion-evidence' and public.worker_can_write_completion_object(name));
drop policy if exists serviceos_completion_scoped_read on storage.objects;
create policy serviceos_completion_scoped_read on storage.objects for select to authenticated
using (bucket_id='serviceos-completion-evidence' and public.can_read_completion_object(name));

create table if not exists public.operations_completion_delivery (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null, operational_job_id uuid not null references public.operational_job(id),
  work_order_id uuid not null references public.work_order(id), provider text not null default 'microsoft_graph',
  provider_message_id text, delivery_status text not null default 'requested' check (delivery_status in ('requested','sent','failed')),
  idempotency_key text not null unique, requested_at timestamptz not null default now(), sent_at timestamptz,
  failed_at timestamptz, failure_reason text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(work_order_id)
);
alter table public.operations_completion_delivery enable row level security;
alter table public.operations_completion_delivery force row level security;
revoke all on public.operations_completion_delivery from public,anon;
grant select on public.operations_completion_delivery to authenticated;
create policy operations_completion_delivery_staff_read on public.operations_completion_delivery for select to authenticated
using (public.has_bu_role(organization_id,business_unit_id,array['owner_admin','office_ops']::text[]));
create index if not exists idx_operations_completion_delivery_scope on public.operations_completion_delivery(organization_id,business_unit_id,requested_at desc);

create or replace function public.enqueue_operations_completion_alert() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.operational_job%rowtype;
begin
  if new.work_order_status='service_complete' and old.work_order_status is distinct from new.work_order_status then
    select * into strict v_job from public.operational_job where id=new.operational_job_id;
    insert into public.operations_completion_delivery(organization_id,business_unit_id,operational_job_id,work_order_id,idempotency_key,metadata)
    values (new.organization_id,new.business_unit_id,new.operational_job_id,new.id,
      encode(extensions.digest('operations-completion:'||new.id::text||':v1','sha256'),'hex'),
      jsonb_build_object('source','governed_service_complete','service_completed_at',new.service_completed_at))
    on conflict(work_order_id) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists enqueue_operations_completion_alert on public.work_order;
create trigger enqueue_operations_completion_alert after update of work_order_status on public.work_order
for each row execute function public.enqueue_operations_completion_alert();

create or replace function public.reserve_operations_completion_alert(p_work_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_wo public.work_order%rowtype; v_job public.operational_job%rowtype; v_contact public.contact%rowtype;
  v_location public.service_location%rowtype; v_quote public.quote_version%rowtype; v_delivery public.operations_completion_delivery%rowtype; v_allowed boolean:=false; v_photo_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into strict v_wo from public.work_order where id=p_work_order_id;
  if v_wo.work_order_status<>'service_complete' or v_wo.service_completed_at is null then raise exception 'Operations alert requires service_complete'; end if;
  select * into strict v_job from public.operational_job where id=v_wo.operational_job_id;
  v_allowed:=public.has_bu_role(v_job.organization_id,v_job.business_unit_id,array['owner_admin','office_ops']::text[])
    or exists(select 1 from public.worker_assignment wa join public.worker w on w.id=wa.worker_id where wa.operational_job_id=v_job.id and wa.assignment_status='completed' and w.app_user_id=public.current_app_user_id() and w.status='active');
  if not v_allowed then raise exception 'Operations completion alert is not authorized'; end if;
  select * into strict v_delivery from public.operations_completion_delivery where work_order_id=v_wo.id;
  select * into strict v_contact from public.contact where id=v_job.contact_id;
  select * into strict v_location from public.service_location where id=v_job.service_location_id;
  select * into strict v_quote from public.quote_version where id=v_job.quote_version_id;
  select count(*) into v_photo_count from public.completion_evidence where work_order_id=v_wo.id and evidence_type like 'photo_%';
  return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'idempotency_key',v_delivery.idempotency_key,
    'customer_name',coalesce(nullif(v_contact.first_name||' '||v_contact.last_name,' '),'Customer'),'service_title',coalesce(nullif(v_quote.title,''),'Cleaning service'),
    'territory',(select code from public.business_unit where id=v_job.business_unit_id),'completed_at',v_wo.service_completed_at,'photo_count',v_photo_count,
    'address',concat_ws(', ',v_location.address_line1,v_location.address_line2,v_location.city,v_location.subdivision,v_location.postal_code));
end; $$;

create or replace function public.record_operations_completion_alert_result(p_delivery_id uuid,p_status text,p_provider_message_id text default null,p_failure_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.operations_completion_delivery%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('sent','failed') then raise exception 'Invalid operations delivery status'; end if;
  select * into strict v_row from public.operations_completion_delivery where id=p_delivery_id for update;
  if not (public.has_bu_role(v_row.organization_id,v_row.business_unit_id,array['owner_admin','office_ops']::text[]) or exists(
    select 1 from public.worker_assignment wa join public.worker w on w.id=wa.worker_id where wa.operational_job_id=v_row.operational_job_id
    and wa.assignment_status='completed' and w.app_user_id=public.current_app_user_id() and w.status='active')) then raise exception 'Operations delivery update is not authorized'; end if;
  if v_row.delivery_status='sent' then return to_jsonb(v_row); end if;
  update public.operations_completion_delivery set delivery_status=p_status,provider_message_id=case when p_status='sent' then p_provider_message_id else provider_message_id end,
    sent_at=case when p_status='sent' then now() else sent_at end,failed_at=case when p_status='failed' then now() else null end,
    failure_reason=case when p_status='failed' then left(p_failure_reason,1000) else null end,updated_at=now() where id=p_delivery_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.reserve_operations_completion_alert(uuid) from public,anon;
revoke all on function public.record_operations_completion_alert_result(uuid,text,text,text) from public,anon;
grant execute on function public.reserve_operations_completion_alert(uuid), public.record_operations_completion_alert_result(uuid,text,text,text) to authenticated;

commit;
