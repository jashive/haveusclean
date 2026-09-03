-- Public booking intake boundary.
-- Browser users never write this table directly. /api/bookings/* uses the canonical
-- server environment guard plus the Supabase service-role key.

create table if not exists public.booking (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  jurisdiction_id uuid not null references public.jurisdiction(id),
  customer_id uuid not null references public.customer(id),
  contact_id uuid references public.contact(id),
  service_location_id uuid references public.service_location(id),
  service_request_id uuid not null unique references public.service_request(id),
  booking_status text not null default 'submitted'
    check (booking_status in ('submitted','qualified','cancelled','converted')),
  requested_service_date date,
  requested_arrival_window text,
  service_package text not null,
  frequency text not null default 'one_time',
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  tax_name text,
  tax_rate numeric(10,6) not null default 0 check (tax_rate >= 0),
  estimated_subtotal numeric(12,2) not null default 0 check (estimated_subtotal >= 0),
  estimated_tax numeric(12,2) not null default 0 check (estimated_tax >= 0),
  estimated_total numeric(12,2) not null default 0 check (estimated_total >= 0),
  pricing_configuration_version_id uuid references public.configuration_version(id),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_booking_business_unit_status
  on public.booking (business_unit_id, booking_status, created_at desc);
create index if not exists idx_booking_customer
  on public.booking (customer_id, created_at desc);
create index if not exists idx_booking_service_date
  on public.booking (business_unit_id, requested_service_date)
  where booking_status in ('submitted','qualified');

alter table public.booking enable row level security;
alter table public.booking force row level security;

revoke all on table public.booking from anon;
revoke all on table public.booking from authenticated;

comment on table public.booking is
  'Server-created public booking intake projection linked to canonical customer/service_request. No browser write boundary and no automatic operational_job creation.';

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
  v_name text := btrim(coalesce(p_display_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_customer_id uuid;
  v_contact_id uuid;
  v_location_id uuid;
  v_request_id uuid;
  v_booking_id uuid;
  v_name_parts text[];
  v_first_name text;
  v_last_name text;
begin
  if v_name = '' or v_email = '' or position('@' in v_email) < 2 then
    raise exception 'public booking: valid customer name and email are required';
  end if;
  if p_organization_id is null or p_business_unit_id is null or p_jurisdiction_id is null then
    raise exception 'public booking: canonical organization, business unit and jurisdiction are required';
  end if;
  if not exists (
    select 1
    from public.business_unit bu
    where bu.id = p_business_unit_id
      and bu.organization_id = p_organization_id
      and bu.jurisdiction_id = p_jurisdiction_id
      and bu.status = 'active'
  ) then
    raise exception 'public booking: active canonical market scope is invalid';
  end if;
  if p_pricing_configuration_version_id is null or not exists (
    select 1
    from public.configuration_version cv
    where cv.id = p_pricing_configuration_version_id
      and cv.organization_id = p_organization_id
      and cv.business_unit_id = p_business_unit_id
      and cv.jurisdiction_id = p_jurisdiction_id
      and cv.configuration_type = 'residential_pricing'
      and cv.status = 'published'
  ) then
    raise exception 'public booking: published pricing configuration lineage is invalid';
  end if;

  -- Safe identity reuse: only reuse a customer when BOTH normalized primary-contact
  -- email and normalized display name match in the same organization/business unit.
  -- An email match with a conflicting name never silently reuses the customer.
  select c.id
    into v_customer_id
  from public.customer c
  join public.contact ct on ct.customer_id = c.id
  where c.organization_id = p_organization_id
    and c.business_unit_id = p_business_unit_id
    and c.status = 'active'
    and lower(btrim(c.display_name)) = lower(v_name)
    and lower(btrim(coalesce(ct.email, ''))) = v_email
  order by ct.is_primary desc, c.created_at asc
  limit 1;

  if v_customer_id is null then
    insert into public.customer (
      organization_id, business_unit_id, customer_type, display_name, status, metadata
    ) values (
      p_organization_id, p_business_unit_id, 'person', v_name, 'active',
      jsonb_build_object('source', 'public_booking')
    ) returning id into v_customer_id;
  end if;

  v_name_parts := regexp_split_to_array(v_name, '\s+');
  v_first_name := nullif(v_name_parts[1], '');
  if coalesce(array_length(v_name_parts, 1), 0) > 1 then
    v_last_name := nullif(array_to_string(v_name_parts[2:array_length(v_name_parts, 1)], ' '), '');
  end if;

  select id into v_contact_id
  from public.contact
  where customer_id = v_customer_id
    and lower(btrim(coalesce(email, ''))) = v_email
  order by is_primary desc, created_at asc
  limit 1;

  if v_contact_id is null then
    insert into public.contact (
      customer_id, contact_type, first_name, last_name, email, phone, is_primary, metadata
    ) values (
      v_customer_id, 'primary', v_first_name, v_last_name, v_email, nullif(v_phone, ''), true,
      jsonb_build_object('source', 'public_booking')
    ) returning id into v_contact_id;
  end if;

  insert into public.service_location (
    customer_id, jurisdiction_id, label, address_line1, city, subdivision,
    postal_code, country_code, metadata
  ) values (
    v_customer_id, p_jurisdiction_id, 'Public booking service address',
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(upper(btrim(coalesce(p_subdivision, ''))), ''),
    nullif(upper(btrim(coalesce(p_postal_code, ''))), ''),
    nullif(upper(btrim(coalesce(p_country_code, ''))), ''),
    jsonb_build_object('source', 'public_booking')
  ) returning id into v_location_id;

  insert into public.service_request (
    organization_id, business_unit_id, customer_id, contact_id, service_location_id,
    service_category, lifecycle_status, requested_at, intake_channel, title,
    description, requirements, metadata
  ) values (
    p_organization_id, p_business_unit_id, v_customer_id, v_contact_id, v_location_id,
    'residential', 'intake', now(), 'public_booking',
    v_name || ' — ' || p_service_package,
    'Public booking request; customer authentication is not required for intake.',
    coalesce(p_requirements, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'public_booking',
      'pricing_configuration_version_id', p_pricing_configuration_version_id
    )
  ) returning id into v_request_id;

  insert into public.booking (
    organization_id, business_unit_id, jurisdiction_id, customer_id, contact_id,
    service_location_id, service_request_id, booking_status, requested_service_date,
    requested_arrival_window, service_package, frequency, currency_code, tax_name,
    tax_rate, estimated_subtotal, estimated_tax, estimated_total,
    pricing_configuration_version_id, pricing_snapshot, metadata
  ) values (
    p_organization_id, p_business_unit_id, p_jurisdiction_id, v_customer_id, v_contact_id,
    v_location_id, v_request_id, 'submitted', p_requested_service_date,
    nullif(btrim(coalesce(p_requested_arrival_window, '')), ''), p_service_package,
    coalesce(nullif(btrim(p_frequency), ''), 'one_time'), upper(p_currency_code), p_tax_name,
    coalesce(p_tax_rate, 0), coalesce(p_estimated_subtotal, 0),
    coalesce(p_estimated_tax, 0), coalesce(p_estimated_total, 0),
    p_pricing_configuration_version_id, coalesce(p_pricing_snapshot, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'public_booking')
  ) returning id into v_booking_id;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'service_request_id', v_request_id,
    'customer_id', v_customer_id,
    'contact_id', v_contact_id,
    'service_location_id', v_location_id
  );
end;
$$;

revoke all on function public.create_public_booking_intake(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, date, text,
  text, text, text, text, numeric, numeric, numeric, numeric, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_public_booking_intake(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, date, text,
  text, text, text, text, numeric, numeric, numeric, numeric, uuid, jsonb, jsonb, jsonb
) to service_role;

comment on function public.create_public_booking_intake(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, date, text,
  text, text, text, text, numeric, numeric, numeric, numeric, uuid, jsonb, jsonb, jsonb
) is 'Service-role-only atomic public booking intake. Creates/links customer identity, service request and booking without creating an auth user or operational job.';
