-- CONTROL-PLANE READ-ONLY SCHEMA EVIDENCE
-- Source: production-like project metadata only; no application rows copied.
-- Historical structure evidence for authoring a NEW-ENVIRONMENT baseline.
-- Do not apply this file directly to production.

-- organization
CREATE TABLE public.organization (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  legal_name text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- jurisdiction
CREATE TABLE public.jurisdiction (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  country_code text NOT NULL,
  subdivision_code text,
  currency_code text NOT NULL,
  timezone text NOT NULL,
  tax_label text,
  default_tax_rate numeric(9,6),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- app_role
CREATE TABLE public.app_role (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- app_user
CREATE TABLE public.app_user (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  auth_user_id uuid,
  email text,
  display_name text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- business_unit
CREATE TABLE public.business_unit (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  jurisdiction_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_membership
CREATE TABLE public.user_membership (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  app_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid,
  role_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- customer
CREATE TABLE public.customer (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid,
  customer_type text DEFAULT 'person'::text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  status text DEFAULT 'active'::text NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- contact
CREATE TABLE public.contact (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  contact_type text DEFAULT 'primary'::text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  is_primary boolean DEFAULT false NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- service_location
CREATE TABLE public.service_location (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  customer_id uuid NOT NULL,
  jurisdiction_id uuid,
  label text,
  address_line1 text,
  address_line2 text,
  city text,
  subdivision text,
  postal_code text,
  country_code text,
  access_notes text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- worker
CREATE TABLE public.worker (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid,
  app_user_id uuid,
  worker_type text NOT NULL,
  display_name text NOT NULL,
  email text,
  phone text,
  status text DEFAULT 'applicant'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- marketing_source
CREATE TABLE public.marketing_source (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  source_type text,
  status text DEFAULT 'active'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- campaign
CREATE TABLE public.campaign (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  marketing_source_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  status text DEFAULT 'active'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- configuration_version
CREATE TABLE public.configuration_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid,
  jurisdiction_id uuid,
  configuration_type text NOT NULL,
  version text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  effective_from timestamp with time zone,
  effective_to timestamp with time zone,
  configuration jsonb NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- external_reference
CREATE TABLE public.external_reference (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  system_name text NOT NULL,
  external_type text,
  external_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- idempotency_key
CREATE TABLE public.idempotency_key (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text,
  response_code integer,
  response_body jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone
);

-- audit_event
CREATE TABLE public.audit_event (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid,
  business_unit_id uuid,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  source_system text,
  correlation_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

-- migration_lineage
CREATE TABLE public.migration_lineage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  migration_name text NOT NULL,
  source_table text NOT NULL,
  source_id text NOT NULL,
  target_table text NOT NULL,
  target_id uuid,
  status text NOT NULL,
  source_snapshot jsonb,
  error_message text,
  migrated_at timestamp with time zone,
  reconciled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- service_request
CREATE TABLE public.service_request (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  customer_id uuid,
  contact_id uuid,
  service_location_id uuid,
  marketing_source_id uuid,
  campaign_id uuid,
  external_reference_id uuid,
  idempotency_key_id uuid,
  service_category text NOT NULL,
  lifecycle_status text DEFAULT 'intake'::text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  intake_channel text,
  title text,
  description text,
  requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  updated_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- opportunity
CREATE TABLE public.opportunity (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  service_request_id uuid NOT NULL,
  customer_id uuid,
  contact_id uuid,
  service_location_id uuid,
  marketing_source_id uuid,
  campaign_id uuid,
  external_reference_id uuid,
  idempotency_key_id uuid,
  stage text DEFAULT 'open'::text NOT NULL,
  close_reason text,
  expected_close_date date,
  probability_percent numeric(5,2),
  title text,
  summary text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  updated_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- estimate
CREATE TABLE public.estimate (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  customer_id uuid,
  contact_id uuid,
  service_location_id uuid,
  estimate_number text,
  version_no integer DEFAULT 1 NOT NULL,
  lifecycle_status text DEFAULT 'draft'::text NOT NULL,
  assumptions jsonb DEFAULT '{}'::jsonb NOT NULL,
  scope_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  updated_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- pricing_snapshot
CREATE TABLE public.pricing_snapshot (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  opportunity_id uuid,
  estimate_id uuid,
  configuration_version_id uuid,
  currency_code text NOT NULL,
  tax_name text NOT NULL,
  tax_rate numeric(9,6) NOT NULL,
  subtotal_amount numeric(14,2) NOT NULL,
  discount_amount numeric(14,2) DEFAULT 0 NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  calculator_version text NOT NULL,
  configuration_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  labor_economics jsonb DEFAULT '{}'::jsonb NOT NULL,
  calculation_inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  calculation_outputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  raw_calculation_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  frozen_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- quote
CREATE TABLE public.quote (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  estimate_id uuid,
  quote_number text,
  lifecycle_status text DEFAULT 'draft'::text NOT NULL,
  customer_id uuid,
  contact_id uuid,
  service_location_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  updated_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- quote_version
CREATE TABLE public.quote_version (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  estimate_id uuid,
  pricing_snapshot_id uuid NOT NULL,
  version_no integer DEFAULT 1 NOT NULL,
  lifecycle_status text DEFAULT 'draft'::text NOT NULL,
  valid_until timestamp with time zone,
  title text,
  terms_text text,
  line_items_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  commercial_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  sent_at timestamp with time zone,
  created_by_app_user_id uuid,
  updated_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- quote_response
CREATE TABLE public.quote_response (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  quote_version_id uuid NOT NULL,
  idempotency_key_id uuid,
  response_type text NOT NULL,
  response_channel text,
  responded_by_name text,
  responded_by_email text,
  responded_at timestamp with time zone DEFAULT now() NOT NULL,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- conversion_record
CREATE TABLE public.conversion_record (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  service_request_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  estimate_id uuid,
  quote_id uuid NOT NULL,
  quote_version_id uuid NOT NULL,
  quote_response_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  service_location_id uuid NOT NULL,
  converted_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- job_handoff
CREATE TABLE public.job_handoff (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  conversion_record_id uuid NOT NULL,
  quote_version_id uuid NOT NULL,
  pricing_snapshot_id uuid NOT NULL,
  handoff_status text DEFAULT 'ready'::text NOT NULL,
  handoff_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  handed_off_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by_app_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
