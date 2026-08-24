create or replace function public.growth_g2_register_sender_identity(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,
  p_email_address text,p_display_name text,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(coalesce(p_email_address,''))); v_domain text; v_id uuid; begin
  if v_email='' or position('@' in v_email)<=1 then raise exception 'growth_g2: valid sender email required'; end if;
  v_domain:=split_part(v_email,'@',2);
  if v_domain='' then raise exception 'growth_g2: sender domain required'; end if;
  if nullif(btrim(coalesce(p_display_name,'')),'') is null then raise exception 'growth_g2: sender display name required'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id and b.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: sender scope mismatch'; end if;
  insert into growth.sender_identity(organization_id,business_unit_id,jurisdiction_id,email_address,sender_domain,display_name,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_email,v_domain,btrim(p_display_name),coalesce(p_metadata,'{}'::jsonb))
  on conflict(organization_id,business_unit_id,jurisdiction_id,email_address) do update set display_name=excluded.display_name,metadata=growth.sender_identity.metadata||excluded.metadata,updated_at=now()
  returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,null,'g2_sender_identity_registered','growth_g2',jsonb_build_object('sender_identity_id',v_id,'email_address',v_email));
  return v_id;
end; $$;
revoke execute on function public.growth_g2_register_sender_identity(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.growth_g2_register_sender_identity(uuid,uuid,uuid,text,text,jsonb) to service_role;
