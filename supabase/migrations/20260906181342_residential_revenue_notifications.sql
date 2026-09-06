begin;

create table if not exists public.intake_notification_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  service_request_id uuid not null references public.service_request(id) on delete restrict,
  opportunity_id uuid not null references public.opportunity(id) on delete restrict,
  audience text not null check (audience in ('customer','operations')),
  channel text not null default 'email' check (channel = 'email'),
  recipient_email text not null,
  template_key text not null,
  template_version text not null,
  delivery_status text not null default 'requested' check (delivery_status in ('requested','sent','failed')),
  provider text,
  provider_message_id text,
  idempotency_key text not null unique,
  requested_at timestamptz not null default now(),
  provider_accepted_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_intake_notification_audience_template unique(service_request_id,audience,template_key,template_version)
);

create unique index if not exists uq_intake_notification_provider_message
  on public.intake_notification_delivery(provider,provider_message_id)
  where provider_message_id is not null;
create index if not exists idx_intake_notification_scope_status
  on public.intake_notification_delivery(business_unit_id,delivery_status,created_at desc);
create index if not exists idx_intake_notification_service_request
  on public.intake_notification_delivery(service_request_id,created_at desc);

alter table public.intake_notification_delivery enable row level security;
alter table public.intake_notification_delivery force row level security;
revoke all on table public.intake_notification_delivery from public,anon,authenticated;
grant select,insert,update on table public.intake_notification_delivery to service_role;

comment on table public.intake_notification_delivery is
  'Service-role-only delivery evidence for public booking and commercial walkthrough receipts and internal alerts.';

create or replace function public.create_public_booking_intake(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_address_line1 text,
  p_city text,
  p_subdivision text,
  p_postal_code text,
  p_country_code text,
  p_requested_service_date date,
  p_requested_arrival_window text,
  p_service_package text,
  p_frequency text,
  p_currency_code text,
  p_tax_name text,
  p_tax_rate numeric,
  p_estimated_subtotal numeric,
  p_estimated_tax numeric,
  p_estimated_total numeric,
  p_pricing_configuration_version_id uuid,
  p_requirements jsonb default '{}'::jsonb,
  p_pricing_snapshot jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_display_name,''));
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_phone text := btrim(coalesce(p_phone,''));
  v_key text := nullif(btrim(coalesce(p_metadata->>'submission_idempotency_key','')),'');
  v_request_hash text;
  v_existing jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_customer_id uuid;
  v_contact_id uuid;
  v_location_id uuid;
  v_request_id uuid;
  v_opportunity_id uuid;
  v_booking_id uuid;
  v_name_parts text[];
  v_first_name text;
  v_last_name text;
begin
  if v_name='' or v_email='' or position('@' in v_email)<2 then
    raise exception 'public booking: valid customer name and email are required';
  end if;
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null then
    raise exception 'public booking: canonical organization, business unit and jurisdiction are required';
  end if;
  if not exists (
    select 1 from public.business_unit bu
    where bu.id=p_business_unit_id and bu.organization_id=p_organization_id
      and bu.jurisdiction_id=p_jurisdiction_id and bu.status='active'
  ) then raise exception 'public booking: active canonical market scope is invalid'; end if;
  if p_pricing_configuration_version_id is null or not exists (
    select 1 from public.configuration_version cv
    where cv.id=p_pricing_configuration_version_id and cv.organization_id=p_organization_id
      and cv.business_unit_id=p_business_unit_id and cv.jurisdiction_id=p_jurisdiction_id
      and cv.configuration_type='residential_pricing' and cv.status='published'
  ) then raise exception 'public booking: published pricing configuration lineage is invalid'; end if;

  v_request_hash:=md5(concat_ws('|',p_business_unit_id::text,v_name,v_email,p_address_line1,p_requested_service_date::text,p_requested_arrival_window,p_service_package,p_frequency,p_estimated_total::text));
  if v_key is not null then
    select response_body,request_hash into v_existing,v_existing_hash from public.idempotency_key
    where scope='public_booking_intake' and key=v_key;
    if v_existing is not null then
      if v_existing_hash is distinct from v_request_hash then raise exception 'public booking: idempotency key collision'; end if;
      return v_existing||jsonb_build_object('idempotent_replay',true);
    end if;

    insert into public.idempotency_key(organization_id,scope,key,request_hash,expires_at)
    values(p_organization_id,'public_booking_intake',v_key,v_request_hash,now()+interval '30 days')
    on conflict(scope,key) do nothing returning id into v_idempotency_id;
    if v_idempotency_id is null then
      select response_body into v_existing from public.idempotency_key
      where scope='public_booking_intake' and key=v_key and request_hash=v_request_hash;
      if v_existing is not null then return v_existing||jsonb_build_object('idempotent_replay',true); end if;
      raise exception 'public booking: idempotency key collision';
    end if;
  end if;

  select c.id into v_customer_id
  from public.customer c join public.contact ct on ct.customer_id=c.id
  where c.organization_id=p_organization_id and c.business_unit_id=p_business_unit_id
    and c.status='active' and lower(btrim(c.display_name))=lower(v_name)
    and lower(btrim(coalesce(ct.email,'')))=v_email
  order by ct.is_primary desc,c.created_at asc limit 1;

  if v_customer_id is null then
    insert into public.customer(organization_id,business_unit_id,customer_type,display_name,status,metadata)
    values(p_organization_id,p_business_unit_id,'person',v_name,'active',jsonb_build_object('source','public_booking'))
    returning id into v_customer_id;
  end if;

  v_name_parts:=regexp_split_to_array(v_name,'\s+');
  v_first_name:=nullif(v_name_parts[1],'');
  if coalesce(array_length(v_name_parts,1),0)>1 then
    v_last_name:=nullif(array_to_string(v_name_parts[2:array_length(v_name_parts,1)],' '),'');
  end if;

  select id into v_contact_id from public.contact
  where customer_id=v_customer_id and lower(btrim(coalesce(email,'')))=v_email
  order by is_primary desc,created_at asc limit 1;
  if v_contact_id is null then
    insert into public.contact(customer_id,contact_type,first_name,last_name,email,phone,is_primary,metadata)
    values(v_customer_id,'primary',v_first_name,v_last_name,v_email,nullif(v_phone,''),true,jsonb_build_object('source','public_booking'))
    returning id into v_contact_id;
  end if;

  insert into public.service_location(customer_id,jurisdiction_id,label,address_line1,city,subdivision,postal_code,country_code,metadata)
  values(v_customer_id,p_jurisdiction_id,'Public booking service address',nullif(btrim(coalesce(p_address_line1,'')),''),
    nullif(btrim(coalesce(p_city,'')),''),nullif(upper(btrim(coalesce(p_subdivision,''))),''),
    nullif(upper(btrim(coalesce(p_postal_code,''))),''),nullif(upper(btrim(coalesce(p_country_code,''))),''),
    jsonb_build_object('source','public_booking')) returning id into v_location_id;

  insert into public.service_request(
    organization_id,business_unit_id,customer_id,contact_id,service_location_id,idempotency_key_id,
    service_category,lifecycle_status,requested_at,intake_channel,title,description,requirements,metadata
  ) values(
    p_organization_id,p_business_unit_id,v_customer_id,v_contact_id,v_location_id,v_idempotency_id,
    'residential','intake',now(),'public_booking',v_name||' — '||p_service_package,
    'Public booking request; customer authentication is not required for intake.',coalesce(p_requirements,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('source','public_booking','pricing_configuration_version_id',p_pricing_configuration_version_id)
  ) returning id into v_request_id;

  insert into public.opportunity(
    organization_id,business_unit_id,service_request_id,customer_id,contact_id,service_location_id,idempotency_key_id,
    stage,title,summary,metadata
  ) values(
    p_organization_id,p_business_unit_id,v_request_id,v_customer_id,v_contact_id,v_location_id,v_idempotency_id,
    'open',v_name||' — Residential Booking Follow-Up',
    'Public residential booking received; confirm availability and continue in Revenue.',
    jsonb_build_object('queue','revenue_follow_up','public_booking',true,'booking_status','submitted')
  ) returning id into v_opportunity_id;

  insert into public.booking(
    organization_id,business_unit_id,jurisdiction_id,customer_id,contact_id,service_location_id,service_request_id,
    booking_status,requested_service_date,requested_arrival_window,service_package,frequency,currency_code,tax_name,
    tax_rate,estimated_subtotal,estimated_tax,estimated_total,pricing_configuration_version_id,pricing_snapshot,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,v_customer_id,v_contact_id,v_location_id,v_request_id,
    'submitted',p_requested_service_date,nullif(btrim(coalesce(p_requested_arrival_window,'')),''),p_service_package,
    coalesce(nullif(btrim(p_frequency),''),'one_time'),upper(p_currency_code),p_tax_name,coalesce(p_tax_rate,0),
    coalesce(p_estimated_subtotal,0),coalesce(p_estimated_tax,0),coalesce(p_estimated_total,0),
    p_pricing_configuration_version_id,coalesce(p_pricing_snapshot,'{}'::jsonb),
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('source','public_booking')
  ) returning id into v_booking_id;

  v_existing:=jsonb_build_object(
    'booking_id',v_booking_id,'service_request_id',v_request_id,'opportunity_id',v_opportunity_id,
    'customer_id',v_customer_id,'contact_id',v_contact_id,'service_location_id',v_location_id,
    'lifecycle_status','intake','opportunity_stage','open','idempotent_replay',false
  );
  if v_idempotency_id is not null then
    update public.idempotency_key set response_code=201,response_body=v_existing where id=v_idempotency_id;
  end if;
  return v_existing;
end;
$$;

revoke all on function public.create_public_booking_intake(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,date,text,text,text,text,text,numeric,numeric,numeric,numeric,uuid,jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.create_public_booking_intake(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,date,text,text,text,text,text,numeric,numeric,numeric,numeric,uuid,jsonb,jsonb,jsonb
) to service_role;

create or replace function public.reserve_intake_notification_delivery(
  p_service_request_id uuid,
  p_audience text,
  p_recipient_email text,
  p_template_key text,
  p_template_version text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_request public.service_request%rowtype;
  v_opportunity public.opportunity%rowtype;
  v_delivery public.intake_notification_delivery%rowtype;
begin
  if p_audience not in ('customer','operations') then raise exception 'intake notification: invalid audience'; end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)<2 then
    raise exception 'intake notification: valid recipient email is required';
  end if;
  select * into v_request from public.service_request where id=p_service_request_id;
  if not found then raise exception 'intake notification: service request not found'; end if;
  select * into v_opportunity from public.opportunity where service_request_id=v_request.id;
  if not found or v_opportunity.organization_id<>v_request.organization_id or v_opportunity.business_unit_id<>v_request.business_unit_id then
    raise exception 'intake notification: opportunity lineage is invalid';
  end if;

  select * into v_delivery from public.intake_notification_delivery
  where idempotency_key=p_idempotency_key for update;
  if found then
    if v_delivery.service_request_id<>v_request.id or v_delivery.audience<>p_audience
      or v_delivery.recipient_email<>lower(btrim(p_recipient_email)) or v_delivery.template_key<>p_template_key
      or v_delivery.template_version<>p_template_version then
      raise exception 'intake notification: idempotency key collision';
    end if;
    if v_delivery.delivery_status in ('sent','requested') then
      return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'should_send',false);
    end if;
    update public.intake_notification_delivery set delivery_status='requested',failed_at=null,failure_reason=null,updated_at=now()
    where id=v_delivery.id returning * into v_delivery;
    return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'should_send',true);
  end if;

  insert into public.intake_notification_delivery(
    organization_id,business_unit_id,service_request_id,opportunity_id,audience,recipient_email,
    template_key,template_version,idempotency_key
  ) values(
    v_request.organization_id,v_request.business_unit_id,v_request.id,v_opportunity.id,p_audience,lower(btrim(p_recipient_email)),
    btrim(p_template_key),btrim(p_template_version),btrim(p_idempotency_key)
  ) returning * into v_delivery;
  return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'should_send',true);
end;
$$;

create or replace function public.complete_intake_notification_delivery(
  p_delivery_id uuid,
  p_delivery_status text,
  p_provider text,
  p_provider_message_id text,
  p_failure_reason text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_delivery public.intake_notification_delivery%rowtype;
begin
  if p_delivery_status not in ('sent','failed') then raise exception 'intake notification: invalid completion status'; end if;
  select * into v_delivery from public.intake_notification_delivery where id=p_delivery_id for update;
  if not found then raise exception 'intake notification: delivery not found'; end if;
  if v_delivery.delivery_status='sent' then
    return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'idempotent_replay',true);
  end if;
  if p_delivery_status='sent' and (nullif(btrim(coalesce(p_provider,'')),'') is null or nullif(btrim(coalesce(p_provider_message_id,'')),'') is null) then
    raise exception 'intake notification: sent delivery requires provider evidence';
  end if;
  if p_delivery_status='failed' and nullif(btrim(coalesce(p_failure_reason,'')),'') is null then
    raise exception 'intake notification: failed delivery requires a reason';
  end if;
  update public.intake_notification_delivery set
    delivery_status=p_delivery_status,
    provider=nullif(btrim(coalesce(p_provider,'')),''),
    provider_message_id=case when p_delivery_status='sent' then nullif(btrim(p_provider_message_id),'') else provider_message_id end,
    provider_accepted_at=case when p_delivery_status='sent' then now() else provider_accepted_at end,
    failed_at=case when p_delivery_status='failed' then now() else null end,
    failure_reason=case when p_delivery_status='failed' then left(btrim(p_failure_reason),1000) else null end,
    metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),updated_at=now()
  where id=v_delivery.id returning * into v_delivery;
  return jsonb_build_object('delivery_id',v_delivery.id,'delivery_status',v_delivery.delivery_status,'idempotent_replay',false);
end;
$$;

revoke all on function public.reserve_intake_notification_delivery(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_intake_notification_delivery(uuid,text,text,text,text,text) to service_role;
revoke all on function public.complete_intake_notification_delivery(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_intake_notification_delivery(uuid,text,text,text,text,jsonb) to service_role;

commit;
