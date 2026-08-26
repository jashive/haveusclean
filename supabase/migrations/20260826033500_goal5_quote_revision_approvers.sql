create or replace function public.list_quote_revision_approvers(p_organization_id uuid,p_business_unit_id uuid)
returns table(app_user_id uuid, display_name text, email text)
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_bu_role(p_organization_id,p_business_unit_id,array['owner_admin','office_ops']::text[]) then
    raise exception 'Not authorized for this business unit';
  end if;
  return query
  select distinct au.id,au.display_name,au.email
  from public.user_membership um
  join public.app_role ar on ar.id=um.role_id
  join public.app_user au on au.id=um.app_user_id
  where um.organization_id=p_organization_id
    and (um.business_unit_id is null or um.business_unit_id=p_business_unit_id)
    and um.status='active'
    and au.status='active'
    and ar.code='owner_admin'
  order by au.display_name nulls last,au.email;
end;
$$;
revoke all on function public.list_quote_revision_approvers(uuid,uuid) from public;
revoke all on function public.list_quote_revision_approvers(uuid,uuid) from anon;
grant execute on function public.list_quote_revision_approvers(uuid,uuid) to authenticated;
