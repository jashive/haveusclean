create or replace function public.growth_g2_record_event(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_prospect_id uuid,
  p_contact_candidate_id uuid,
  p_outreach_attempt_id uuid,
  p_channel text,
  p_event_type text,
  p_provider_event_id text default null,
  p_occurred_at timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_suppression_reason text;
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_event_type not in ('submitted','delivered','bounce','complaint','unsubscribe','reply','failed','blocked','suppressed') then
    raise exception 'growth_g2: unsupported event type';
  end if;

  insert into growth.outreach_event(
    organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_attempt_id,channel,event_type,provider_event_id,occurred_at,payload
  ) values (
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,
    p_outreach_attempt_id,p_channel,p_event_type,p_provider_event_id,p_occurred_at,coalesce(p_payload,'{}'::jsonb)
  ) returning id into v_id;

  v_suppression_reason := case p_event_type
    when 'unsubscribe' then 'opt_out'
    when 'bounce' then 'hard_bounce'
    when 'complaint' then 'complaint'
    else null
  end;

  if v_suppression_reason is not null and p_contact_candidate_id is not null then
    insert into growth.suppression(
      organization_id,jurisdiction_id,prospect_id,channel,identity_type,
      identity_value_normalized,reason,source,active,metadata
    )
    select
      p_organization_id,p_jurisdiction_id,p_prospect_id,p_channel,
      case when p_channel='email' then 'email' else 'phone' end,
      case when p_channel='email' then lower(trim(c.email)) else regexp_replace(coalesce(c.phone,''),'[^0-9+]','','g') end,
      v_suppression_reason,'growth_g2_event',true,
      jsonb_build_object('outreach_event_id',v_id,'event_type',p_event_type)
    from growth.prospect_contact_candidate c
    where c.id=p_contact_candidate_id
      and ((p_channel='email' and c.email is not null) or (p_channel in ('sms','phone') and c.phone is not null));
  end if;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(
    p_organization_id,p_business_unit_id,p_prospect_id,'g2_outreach_event_recorded','growth_g2',
    jsonb_build_object('outreach_event_id',v_id,'event_type',p_event_type,'channel',p_channel)
  );
  return v_id;
end;
$$;

revoke execute on function public.growth_g2_record_event(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.growth_g2_record_event(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb) to service_role;
