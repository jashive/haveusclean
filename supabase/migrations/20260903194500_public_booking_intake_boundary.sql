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
