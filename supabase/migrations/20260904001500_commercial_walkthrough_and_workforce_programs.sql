-- Commercial walkthrough intake + baseline Workforce applicant programs.
-- Commercial requests enter Revenue/Estimating only. No operational_job, job_handoff,
-- booking, quote_version, conversion_record or dispatch object is created here.

begin;

alter table public.service_request
  drop constraint if exists service_request_lifecycle_status_check;

alter table public.service_request
  add constraint service_request_lifecycle_status_check check (
    lifecycle_status = any (array[
      'intake'::text,
      'walkthrough_requested'::text,
      'qualified'::text,
      'disqualified'::text,
      'converted'::text,
      'cancelled'::text
    ])
  );

create or replace function public.create_commercial_walkthrough_intake(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_company_name text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_address_line1 text,
  p_city text,
  p_subdivision text,
  p_postal_code text,
  p_country_code text,
  p_facility_type text,
  p_estimated_square_feet integer,
  p_frequency text,
  p_walkthrough_date date,
  p_walkthrough_time_window text,
  p_notes text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company text := btrim(coalesce(p_company_name,''));
  v_contact text := btrim(coalesce(p_contact_name,''));
  v_email text := lower(btrim(coalesce(p_contact_email,'')));
  v_phone text := btrim(coalesce(p_contact_phone,''));
  v_facility text := lower(btrim(coalesce(p_facility_type,'')));
  v_frequency text := lower(btrim(coalesce(p_frequency,'')));
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_customer_id uuid;
  v_contact_id uuid;
  v_location_id uuid;
  v_request_id uuid;
  v_opportunity_id uuid;
  v_idempotency_id uuid;
  v_existing jsonb;
  v_parts text[];
  v_first_name text;
  v_last_name text;
begin
  if v_company='' then raise exception 'commercial walkthrough: company name is required'; end if;
  if v_contact='' then raise exception 'commercial walkthrough: primary contact name is required'; end if;
  if v_email='' or position('@' in v_email)<2 then raise exception 'commercial walkthrough: valid email is required'; end if;
  if v_phone='' then raise exception 'commercial walkthrough: phone is required'; end if;
  if v_facility not in ('office','medical','retail','industrial') then raise exception 'commercial walkthrough: invalid facility type'; end if;
  if coalesce(p_estimated_square_feet,0)<=0 then raise exception 'commercial walkthrough: positive estimated square footage is required'; end if;
  if v_frequency not in ('one_time','weekly','biweekly','three_times_weekly','five_times_weekly','monthly','custom') then raise exception 'commercial walkthrough: invalid frequency'; end if;
  if p_walkthrough_date is null or btrim(coalesce(p_walkthrough_time_window,''))='' then raise exception 'commercial walkthrough: preferred walkthrough date and time window are required'; end if;

  if not exists (
    select 1 from public.business_unit bu
    where bu.id=p_business_unit_id and bu.organization_id=p_organization_id
      and bu.jurisdiction_id=p_jurisdiction_id and bu.code in ('HUC-ON','HUC-AZ') and bu.status='active'
  ) then raise exception 'commercial walkthrough: canonical HUC market scope is invalid'; end if;

  if v_key is not null then
    select response_body into v_existing
    from public.idempotency_key
    where scope='commercial_walkthrough_intake' and key=v_key;
    if v_existing is not null then return v_existing || jsonb_build_object('idempotent_replay',true); end if;

    insert into public.idempotency_key(organization_id,scope,key,request_hash,expires_at)
    values (p_organization_id,'commercial_walkthrough_intake',v_key,
      md5(concat_ws('|',p_business_unit_id::text,v_company,v_email,p_address_line1,p_walkthrough_date::text,p_walkthrough_time_window)),
      now()+interval '30 days')
    on conflict(scope,key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
      select response_body into v_existing from public.idempotency_key
      where scope='commercial_walkthrough_intake' and key=v_key;
      if v_existing is not null then return v_existing || jsonb_build_object('idempotent_replay',true); end if;
      raise exception 'commercial walkthrough: idempotency key collision';
    end if;
  end if;

  select c.id into v_customer_id
  from public.customer c
  join public.contact ct on ct.customer_id=c.id
  where c.organization_id=p_organization_id and c.business_unit_id=p_business_unit_id
    and c.customer_type='business' and c.status in ('lead','active')
    and lower(btrim(c.display_name))=lower(v_company)
    and lower(btrim(coalesce(ct.email,'')))=v_email
  order by ct.is_primary desc,c.created_at asc limit 1;

  if v_customer_id is null then
    insert into public.customer(organization_id,business_unit_id,customer_type,display_name,status,metadata)
    values(p_organization_id,p_business_unit_id,'business',v_company,'lead',jsonb_build_object('source','commercial_walkthrough'))
    returning id into v_customer_id;
  end if;

  v_parts:=regexp_split_to_array(v_contact,'\s+');
  v_first_name:=nullif(v_parts[1],'');
  if coalesce(array_length(v_parts,1),0)>1 then
    v_last_name:=nullif(array_to_string(v_parts[2:array_length(v_parts,1)],' '),'');
  end if;

  select id into v_contact_id from public.contact
  where customer_id=v_customer_id and lower(btrim(coalesce(email,'')))=v_email
  order by is_primary desc,created_at asc limit 1;

  if v_contact_id is null then
    insert into public.contact(customer_id,contact_type,first_name,last_name,email,phone,is_primary,metadata)
    values(v_customer_id,'primary',v_first_name,v_last_name,v_email,v_phone,true,jsonb_build_object('source','commercial_walkthrough'))
    returning id into v_contact_id;
  end if;

  insert into public.service_location(customer_id,jurisdiction_id,label,address_line1,city,subdivision,postal_code,country_code,metadata)
  values(v_customer_id,p_jurisdiction_id,'Commercial facility',nullif(btrim(p_address_line1),''),nullif(btrim(p_city),''),
    nullif(upper(btrim(p_subdivision)),''),nullif(upper(btrim(p_postal_code)),''),nullif(upper(btrim(p_country_code)),''),
    jsonb_build_object('source','commercial_walkthrough','facility_type',v_facility))
  returning id into v_location_id;

  insert into public.service_request(
    organization_id,business_unit_id,customer_id,contact_id,service_location_id,idempotency_key_id,
    service_category,lifecycle_status,requested_at,intake_channel,title,description,requirements,metadata
  ) values(
    p_organization_id,p_business_unit_id,v_customer_id,v_contact_id,v_location_id,v_idempotency_id,
    'commercial','walkthrough_requested',now(),'public_commercial_walkthrough',
    v_company||' — Commercial Walkthrough',
    'Custom Commercial Proposal — On-Site Facility Walkthrough Required',
    jsonb_build_object(
      'facility_type',v_facility,
      'estimated_square_feet',p_estimated_square_feet,
      'frequency',v_frequency,
      'preferred_walkthrough_date',p_walkthrough_date,
      'preferred_walkthrough_time_window',p_walkthrough_time_window,
      'customer_notes',nullif(btrim(coalesce(p_notes,'')),'')
    ),
    jsonb_build_object(
      'source','public_commercial_walkthrough',
      'commercial_pricing_mode','custom_proposal',
      'instant_price_generated',false,
      'operational_job_created',false,
      'proposal_acceptance_required_before_job',true
    )
  ) returning id into v_request_id;

  insert into public.opportunity(
    organization_id,business_unit_id,service_request_id,customer_id,contact_id,service_location_id,idempotency_key_id,
    stage,title,summary,metadata
  ) values(
    p_organization_id,p_business_unit_id,v_request_id,v_customer_id,v_contact_id,v_location_id,v_idempotency_id,
    'open',v_company||' — Walkthrough / Commercial Proposal',
    'Walkthrough requested; estimating must inspect facility before proposal.',
    jsonb_build_object('queue','revenue_estimating','walkthrough_requested',true,'instant_price_generated',false)
  ) returning id into v_opportunity_id;

  v_existing:=jsonb_build_object(
    'service_request_id',v_request_id,'opportunity_id',v_opportunity_id,'customer_id',v_customer_id,
    'contact_id',v_contact_id,'service_location_id',v_location_id,'lifecycle_status','walkthrough_requested',
    'business_unit_id',p_business_unit_id,'idempotent_replay',false
  );

  if v_idempotency_id is not null then
    update public.idempotency_key set response_code=201,response_body=v_existing where id=v_idempotency_id;
  end if;
  return v_existing;
end;
$$;

revoke all on function public.create_commercial_walkthrough_intake(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer,text,date,text,text,text
) from public,anon,authenticated;
grant execute on function public.create_commercial_walkthrough_intake(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer,text,date,text,text,text
) to service_role;

comment on function public.create_commercial_walkthrough_intake(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer,text,date,text,text,text
) is 'Service-role-only commercial walkthrough intake. Creates business customer/contact/location + Revenue opportunity, never an operational job or instant price.';

-- Baseline HUC Workforce intake programs. Policy versions are explicit and the two
-- requested evidence documents are represented as document codes; background and
-- privacy versions remain governed version fields, not document payloads.
do $$
declare
  v_owner uuid;
  v_bu record;
begin
  select au.id into v_owner
  from public.app_user au
  join public.user_membership um on um.app_user_id=au.id and um.status='active'
  join public.app_role ar on ar.id=um.role_id and ar.code='owner_admin'
  where au.status='active'
  order by au.created_at asc,au.id asc limit 1;

  if v_owner is null then raise exception 'workforce seed: active owner_admin is required'; end if;

  for v_bu in
    select bu.id,bu.organization_id,bu.code,
      case when bu.code='HUC-ON' then 'ON' else 'AZ' end as jurisdiction_code
    from public.business_unit bu
    where bu.code in ('HUC-ON','HUC-AZ') and bu.status='active'
  loop
    insert into hems_hr.applicant_intake_program(
      organization_id,business_unit_id,public_code,jurisdiction_code,allowed_role_codes,
      required_document_codes,privacy_notice_version,background_consent_version,status,created_by_app_user_id
    ) values(
      v_bu.organization_id,v_bu.id,
      case when v_bu.code='HUC-ON' then 'HUC_ON_RESIDENTIAL_CLEANER' else 'HUC_AZ_RESIDENTIAL_CLEANER' end,
      v_bu.jurisdiction_code,array['residential_cleaner']::text[],
      array['GOV_ID','PROOF_OF_INSURANCE_BONDING']::text[],'1.0','1.0','active',v_owner
    )
    on conflict(public_code) do update set
      organization_id=excluded.organization_id,
      business_unit_id=excluded.business_unit_id,
      jurisdiction_code=excluded.jurisdiction_code,
      allowed_role_codes=excluded.allowed_role_codes,
      required_document_codes=excluded.required_document_codes,
      privacy_notice_version=excluded.privacy_notice_version,
      background_consent_version=excluded.background_consent_version,
      status='active',
      updated_at=now();
  end loop;
end $$;

commit;
