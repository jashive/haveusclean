-- Governed, territory-isolated queue for office QA review.
begin;

create or replace function public.get_qa_review_queue(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_limit integer default 100
) returns table (
  operational_job_id uuid,
  work_order_id uuid,
  customer_name text,
  service_address text,
  service_tier text,
  service_date timestamptz,
  started_at timestamptz,
  service_completed_at timestamptz,
  elapsed_minutes integer,
  cleaner_names text,
  photo_count integer,
  qa_inspection_id uuid,
  qa_inspection_status text
) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops','qa']::text[]) then
    raise exception 'QA queue access is not authorized for this territory';
  end if;
  return query
  select
    j.id,
    wo.id,
    coalesce(nullif(c.display_name,''),'Customer')::text,
    concat_ws(', ',nullif(sl.address_line1,''),nullif(sl.address_line2,''),nullif(sl.city,''),nullif(sl.subdivision,''),nullif(sl.postal_code,''))::text,
    coalesce(nullif(wo.scope_snapshot->>'service_tier',''),nullif(wo.scope_snapshot->>'packageKey',''),nullif(j.service_scope_snapshot->>'service_tier',''),nullif(j.service_scope_snapshot->>'packageKey',''),nullif(j.service_family,''),'Cleaning service')::text,
    sw.scheduled_start,
    wo.started_at,
    wo.service_completed_at,
    case when wo.started_at is not null and wo.service_completed_at is not null
      then greatest(0,round(extract(epoch from (wo.service_completed_at-wo.started_at))/60)::integer)
      else null end,
    coalesce(a.cleaner_names,'Unassigned')::text,
    coalesce(e.photo_count,0)::integer,
    qi.id,
    qi.inspection_status
  from public.operational_job j
  join public.work_order wo on wo.operational_job_id=j.id and wo.work_order_status='service_complete'
  left join public.customer c on c.id=j.customer_id
  left join public.service_location sl on sl.id=j.service_location_id
  left join public.schedule_window sw on sw.id=wo.schedule_window_id
  left join lateral (
    select string_agg(w.display_name,', ' order by w.display_name) cleaner_names
    from public.worker_assignment wa join public.worker w on w.id=wa.worker_id
    where wa.operational_job_id=j.id and wa.assignment_status in ('assigned','acknowledged','in_progress','completed')
  ) a on true
  left join lateral (
    select count(*) filter(where ce.storage_reference is not null and ce.evidence_type like 'photo_%')::integer photo_count
    from public.completion_evidence ce where ce.operational_job_id=j.id and ce.work_order_id=wo.id
  ) e on true
  left join lateral (
    select q.id,q.inspection_status from public.qa_inspection q
    where q.operational_job_id=j.id and q.work_order_id=wo.id
      and q.inspection_status in ('pending','in_progress','passed')
    order by q.created_at desc limit 1
  ) qi on true
  where j.organization_id=p_organization_id and j.business_unit_id=p_business_unit_id
    and j.operational_status='qa_pending'
  order by wo.service_completed_at asc nulls last,j.created_at asc
  limit least(greatest(coalesce(p_limit,100),1),250);
end; $$;

revoke all on function public.get_qa_review_queue(uuid,uuid,integer) from public,anon;
grant execute on function public.get_qa_review_queue(uuid,uuid,integer) to authenticated;

commit;
