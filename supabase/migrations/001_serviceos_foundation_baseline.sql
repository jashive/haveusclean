-- ServiceOS 1.0 canonical foundation — NEW ENVIRONMENT BASELINE ONLY.
-- NEVER apply retroactively to an existing production database.
-- Schema-only: contains no application rows, Auth identities, credentials, or environment IDs.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
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


-- Keys precede dependent foreign keys for clean replay.
ALTER TABLE public.app_role ADD CONSTRAINT app_role_code_key UNIQUE (code);
-- Intentional security hardening: fresh environments support canonical roles only.
ALTER TABLE public.app_role ADD CONSTRAINT app_role_canonical_code_check CHECK (code IN ('owner_admin','office_ops','worker','qa'));
ALTER TABLE public.app_role ADD CONSTRAINT app_role_pkey PRIMARY KEY (id);
ALTER TABLE public.app_user ADD CONSTRAINT app_user_auth_user_id_key UNIQUE (auth_user_id);
ALTER TABLE public.app_user ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);
ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_organization_id_code_key UNIQUE (organization_id, code);
ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_pkey PRIMARY KEY (id);
ALTER TABLE public.campaign ADD CONSTRAINT campaign_organization_id_code_key UNIQUE (organization_id, code);
ALTER TABLE public.campaign ADD CONSTRAINT campaign_pkey PRIMARY KEY (id);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_organization_id_configuration_type_ve_key UNIQUE (organization_id, configuration_type, version);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_pkey PRIMARY KEY (id);
ALTER TABLE public.contact ADD CONSTRAINT contact_pkey PRIMARY KEY (id);
ALTER TABLE public.customer ADD CONSTRAINT customer_pkey PRIMARY KEY (id);
ALTER TABLE public.external_reference ADD CONSTRAINT external_reference_pkey PRIMARY KEY (id);
ALTER TABLE public.external_reference ADD CONSTRAINT external_reference_system_name_external_id_entity_type_key UNIQUE (system_name, external_id, entity_type);
ALTER TABLE public.idempotency_key ADD CONSTRAINT idempotency_key_pkey PRIMARY KEY (id);
ALTER TABLE public.idempotency_key ADD CONSTRAINT idempotency_key_scope_key_key UNIQUE (scope, key);
ALTER TABLE public.jurisdiction ADD CONSTRAINT jurisdiction_code_key UNIQUE (code);
ALTER TABLE public.jurisdiction ADD CONSTRAINT jurisdiction_pkey PRIMARY KEY (id);
ALTER TABLE public.marketing_source ADD CONSTRAINT marketing_source_organization_id_code_key UNIQUE (organization_id, code);
ALTER TABLE public.marketing_source ADD CONSTRAINT marketing_source_pkey PRIMARY KEY (id);
ALTER TABLE public.migration_lineage ADD CONSTRAINT migration_lineage_migration_name_source_table_source_id_tar_key UNIQUE (migration_name, source_table, source_id, target_table);
ALTER TABLE public.migration_lineage ADD CONSTRAINT migration_lineage_pkey PRIMARY KEY (id);
ALTER TABLE public.organization ADD CONSTRAINT organization_code_key UNIQUE (code);
ALTER TABLE public.organization ADD CONSTRAINT organization_pkey PRIMARY KEY (id);
ALTER TABLE public.service_location ADD CONSTRAINT service_location_pkey PRIMARY KEY (id);
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_app_user_id_organization_id_business_unit_i_key UNIQUE (app_user_id, organization_id, business_unit_id, role_id);
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_pkey PRIMARY KEY (id);
ALTER TABLE public.worker ADD CONSTRAINT worker_pkey PRIMARY KEY (id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_pkey PRIMARY KEY (id);
ALTER TABLE public.service_request ADD CONSTRAINT uq_service_request_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_pkey PRIMARY KEY (id);
ALTER TABLE public.opportunity ADD CONSTRAINT uq_opportunity_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.opportunity ADD CONSTRAINT uq_opportunity_service_request UNIQUE (service_request_id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_pkey PRIMARY KEY (id);
ALTER TABLE public.estimate ADD CONSTRAINT uq_estimate_opportunity_version UNIQUE (opportunity_id, version_no);
ALTER TABLE public.estimate ADD CONSTRAINT uq_estimate_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_pkey PRIMARY KEY (id);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT uq_pricing_snapshot_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.quote ADD CONSTRAINT quote_pkey PRIMARY KEY (id);
ALTER TABLE public.quote ADD CONSTRAINT uq_quote_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_version ADD CONSTRAINT uq_quote_version_number UNIQUE (quote_id, version_no);
ALTER TABLE public.quote_version ADD CONSTRAINT uq_quote_version_pricing_snapshot UNIQUE (pricing_snapshot_id);
ALTER TABLE public.quote_version ADD CONSTRAINT uq_quote_version_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_response ADD CONSTRAINT uq_quote_response_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_pkey PRIMARY KEY (id);
ALTER TABLE public.conversion_record ADD CONSTRAINT uq_conversion_quote_response UNIQUE (quote_response_id);
ALTER TABLE public.conversion_record ADD CONSTRAINT uq_conversion_quote_version UNIQUE (quote_version_id);
ALTER TABLE public.conversion_record ADD CONSTRAINT uq_conversion_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.job_handoff ADD CONSTRAINT job_handoff_pkey PRIMARY KEY (id);
ALTER TABLE public.job_handoff ADD CONSTRAINT uq_job_handoff_conversion UNIQUE (conversion_record_id);
ALTER TABLE public.job_handoff ADD CONSTRAINT uq_job_handoff_scope UNIQUE (id, organization_id, business_unit_id);
ALTER TABLE public.app_user ADD CONSTRAINT app_user_status_check CHECK (status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'inactive'::text]));
ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text]));
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_status_check CHECK (status = ANY (ARRAY['draft'::text, 'approved'::text, 'published'::text, 'retired'::text]));
ALTER TABLE public.customer ADD CONSTRAINT customer_customer_type_check CHECK (customer_type = ANY (ARRAY['person'::text, 'business'::text]));
ALTER TABLE public.customer ADD CONSTRAINT customer_status_check CHECK (status = ANY (ARRAY['lead'::text, 'active'::text, 'inactive'::text, 'archived'::text]));
ALTER TABLE public.migration_lineage ADD CONSTRAINT migration_lineage_status_check CHECK (status = ANY (ARRAY['pending'::text, 'migrated'::text, 'skipped'::text, 'error'::text, 'reconciled'::text]));
ALTER TABLE public.organization ADD CONSTRAINT organization_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text]));
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]));
ALTER TABLE public.worker ADD CONSTRAINT worker_status_check CHECK (status = ANY (ARRAY['applicant'::text, 'onboarding'::text, 'active'::text, 'suspended'::text, 'inactive'::text, 'archived'::text]));
ALTER TABLE public.worker ADD CONSTRAINT worker_worker_type_check CHECK (worker_type = ANY (ARRAY['employee'::text, 'contractor'::text, 'vendor'::text]));
ALTER TABLE public.service_request ADD CONSTRAINT service_request_lifecycle_status_check CHECK (lifecycle_status = ANY (ARRAY['intake'::text, 'qualified'::text, 'disqualified'::text, 'converted'::text, 'cancelled'::text]));
ALTER TABLE public.service_request ADD CONSTRAINT service_request_service_category_check CHECK (btrim(service_category) <> ''::text);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_probability_percent_check CHECK (probability_percent IS NULL OR probability_percent >= 0::numeric AND probability_percent <= 100::numeric);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_stage_check CHECK (stage = ANY (ARRAY['open'::text, 'qualified'::text, 'proposal'::text, 'won'::text, 'lost'::text, 'cancelled'::text]));
ALTER TABLE public.estimate ADD CONSTRAINT estimate_lifecycle_status_check CHECK (lifecycle_status = ANY (ARRAY['draft'::text, 'prepared'::text, 'sent'::text, 'accepted'::text, 'superseded'::text, 'rejected'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE public.estimate ADD CONSTRAINT estimate_version_no_check CHECK (version_no >= 1);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_currency_code_check CHECK (currency_code ~ '^[A-Z]{3}$'::text);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_discount_amount_check CHECK (discount_amount >= 0::numeric);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_subtotal_amount_check CHECK (subtotal_amount >= 0::numeric);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_tax_amount_check CHECK (tax_amount >= 0::numeric);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_tax_rate_check CHECK (tax_rate >= 0::numeric AND tax_rate <= 1::numeric);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_total_amount_check CHECK (total_amount >= 0::numeric);
ALTER TABLE public.quote ADD CONSTRAINT quote_lifecycle_status_check CHECK (lifecycle_status = ANY (ARRAY['draft'::text, 'active'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_lifecycle_status_check CHECK (lifecycle_status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'cancelled'::text]));
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_version_no_check CHECK (version_no >= 1);
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_response_type_check CHECK (response_type = ANY (ARRAY['viewed'::text, 'requested_changes'::text, 'accepted'::text, 'declined'::text, 'expired'::text]));
ALTER TABLE public.job_handoff ADD CONSTRAINT job_handoff_handoff_status_check CHECK (handoff_status = ANY (ARRAY['ready'::text, 'dispatched_to_wave3'::text, 'cancelled'::text]));
ALTER TABLE public.app_user ADD CONSTRAINT app_user_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES app_user(id);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES jurisdiction(id);
ALTER TABLE public.business_unit ADD CONSTRAINT business_unit_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.campaign ADD CONSTRAINT campaign_marketing_source_id_fkey FOREIGN KEY (marketing_source_id) REFERENCES marketing_source(id);
ALTER TABLE public.campaign ADD CONSTRAINT campaign_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES app_user(id);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES jurisdiction(id);
ALTER TABLE public.configuration_version ADD CONSTRAINT configuration_version_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.contact ADD CONSTRAINT contact_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE;
ALTER TABLE public.customer ADD CONSTRAINT customer_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.customer ADD CONSTRAINT customer_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.external_reference ADD CONSTRAINT external_reference_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.idempotency_key ADD CONSTRAINT idempotency_key_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.marketing_source ADD CONSTRAINT marketing_source_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.service_location ADD CONSTRAINT service_location_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE;
ALTER TABLE public.service_location ADD CONSTRAINT service_location_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES jurisdiction(id);
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES app_user(id) ON DELETE CASCADE;
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id) ON DELETE CASCADE;
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE public.user_membership ADD CONSTRAINT user_membership_role_id_fkey FOREIGN KEY (role_id) REFERENCES app_role(id);
ALTER TABLE public.worker ADD CONSTRAINT worker_app_user_id_fkey FOREIGN KEY (app_user_id) REFERENCES app_user(id);
ALTER TABLE public.worker ADD CONSTRAINT worker_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.worker ADD CONSTRAINT worker_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaign(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_external_reference_id_fkey FOREIGN KEY (external_reference_id) REFERENCES external_reference(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_idempotency_key_id_fkey FOREIGN KEY (idempotency_key_id) REFERENCES idempotency_key(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_marketing_source_id_fkey FOREIGN KEY (marketing_source_id) REFERENCES marketing_source(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_service_location_id_fkey FOREIGN KEY (service_location_id) REFERENCES service_location(id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_updated_by_app_user_id_fkey FOREIGN KEY (updated_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.opportunity ADD CONSTRAINT fk_opportunity_service_request_scope FOREIGN KEY (service_request_id, organization_id, business_unit_id) REFERENCES service_request(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaign(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_external_reference_id_fkey FOREIGN KEY (external_reference_id) REFERENCES external_reference(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_idempotency_key_id_fkey FOREIGN KEY (idempotency_key_id) REFERENCES idempotency_key(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_marketing_source_id_fkey FOREIGN KEY (marketing_source_id) REFERENCES marketing_source(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_service_location_id_fkey FOREIGN KEY (service_location_id) REFERENCES service_location(id);
ALTER TABLE public.opportunity ADD CONSTRAINT opportunity_updated_by_app_user_id_fkey FOREIGN KEY (updated_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_service_location_id_fkey FOREIGN KEY (service_location_id) REFERENCES service_location(id);
ALTER TABLE public.estimate ADD CONSTRAINT estimate_updated_by_app_user_id_fkey FOREIGN KEY (updated_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.estimate ADD CONSTRAINT fk_estimate_opportunity_scope FOREIGN KEY (opportunity_id, organization_id, business_unit_id) REFERENCES opportunity(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT fk_pricing_snapshot_estimate_scope FOREIGN KEY (estimate_id, organization_id, business_unit_id) REFERENCES estimate(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT fk_pricing_snapshot_opportunity_scope FOREIGN KEY (opportunity_id, organization_id, business_unit_id) REFERENCES opportunity(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_configuration_version_id_fkey FOREIGN KEY (configuration_version_id) REFERENCES configuration_version(id);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.pricing_snapshot ADD CONSTRAINT pricing_snapshot_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.quote ADD CONSTRAINT fk_quote_estimate_scope FOREIGN KEY (estimate_id, organization_id, business_unit_id) REFERENCES estimate(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote ADD CONSTRAINT fk_quote_opportunity_scope FOREIGN KEY (opportunity_id, organization_id, business_unit_id) REFERENCES opportunity(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote ADD CONSTRAINT quote_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_service_location_id_fkey FOREIGN KEY (service_location_id) REFERENCES service_location(id);
ALTER TABLE public.quote ADD CONSTRAINT quote_updated_by_app_user_id_fkey FOREIGN KEY (updated_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.quote_version ADD CONSTRAINT fk_quote_version_estimate_scope FOREIGN KEY (estimate_id, organization_id, business_unit_id) REFERENCES estimate(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote_version ADD CONSTRAINT fk_quote_version_pricing_scope FOREIGN KEY (pricing_snapshot_id, organization_id, business_unit_id) REFERENCES pricing_snapshot(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote_version ADD CONSTRAINT fk_quote_version_quote_scope FOREIGN KEY (quote_id, organization_id, business_unit_id) REFERENCES quote(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.quote_version ADD CONSTRAINT quote_version_updated_by_app_user_id_fkey FOREIGN KEY (updated_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.quote_response ADD CONSTRAINT fk_quote_response_quote_version_scope FOREIGN KEY (quote_version_id, organization_id, business_unit_id) REFERENCES quote_version(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_idempotency_key_id_fkey FOREIGN KEY (idempotency_key_id) REFERENCES idempotency_key(id);
ALTER TABLE public.quote_response ADD CONSTRAINT quote_response_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contact(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customer(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT conversion_record_service_location_id_fkey FOREIGN KEY (service_location_id) REFERENCES service_location(id);
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_estimate_scope FOREIGN KEY (estimate_id, organization_id, business_unit_id) REFERENCES estimate(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_opportunity_scope FOREIGN KEY (opportunity_id, organization_id, business_unit_id) REFERENCES opportunity(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_quote_response_scope FOREIGN KEY (quote_response_id, organization_id, business_unit_id) REFERENCES quote_response(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_quote_scope FOREIGN KEY (quote_id, organization_id, business_unit_id) REFERENCES quote(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_quote_version_scope FOREIGN KEY (quote_version_id, organization_id, business_unit_id) REFERENCES quote_version(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.conversion_record ADD CONSTRAINT fk_conversion_service_request_scope FOREIGN KEY (service_request_id, organization_id, business_unit_id) REFERENCES service_request(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.job_handoff ADD CONSTRAINT fk_job_handoff_conversion_scope FOREIGN KEY (conversion_record_id, organization_id, business_unit_id) REFERENCES conversion_record(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.job_handoff ADD CONSTRAINT fk_job_handoff_pricing_scope FOREIGN KEY (pricing_snapshot_id, organization_id, business_unit_id) REFERENCES pricing_snapshot(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.job_handoff ADD CONSTRAINT fk_job_handoff_quote_version_scope FOREIGN KEY (quote_version_id, organization_id, business_unit_id) REFERENCES quote_version(id, organization_id, business_unit_id) ON DELETE RESTRICT;
ALTER TABLE public.job_handoff ADD CONSTRAINT job_handoff_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES business_unit(id);
ALTER TABLE public.job_handoff ADD CONSTRAINT job_handoff_created_by_app_user_id_fkey FOREIGN KEY (created_by_app_user_id) REFERENCES app_user(id);
ALTER TABLE public.job_handoff ADD CONSTRAINT job_handoff_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organization(id);

CREATE INDEX idx_audit_entity ON public.audit_event USING btree (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_business_unit_org ON public.business_unit USING btree (organization_id);
CREATE INDEX idx_config_lookup ON public.configuration_version USING btree (organization_id, configuration_type, status);
CREATE INDEX idx_contact_customer ON public.contact USING btree (customer_id);
CREATE INDEX idx_conversion_record_core ON public.conversion_record USING btree (organization_id, business_unit_id, quote_version_id);
CREATE INDEX idx_customer_bu ON public.customer USING btree (business_unit_id);
CREATE INDEX idx_customer_org ON public.customer USING btree (organization_id);
CREATE INDEX idx_estimate_org_bu_status ON public.estimate USING btree (organization_id, business_unit_id, lifecycle_status);
CREATE INDEX idx_external_entity ON public.external_reference USING btree (entity_type, entity_id);
CREATE INDEX idx_job_handoff_core ON public.job_handoff USING btree (organization_id, business_unit_id, conversion_record_id);
CREATE INDEX idx_lineage_source ON public.migration_lineage USING btree (source_table, source_id);
CREATE INDEX idx_opportunity_org_bu_stage ON public.opportunity USING btree (organization_id, business_unit_id, stage);
CREATE INDEX idx_pricing_snapshot_configuration ON public.pricing_snapshot USING btree (configuration_version_id);
CREATE INDEX idx_pricing_snapshot_estimate ON public.pricing_snapshot USING btree (estimate_id);
CREATE INDEX idx_pricing_snapshot_org_bu ON public.pricing_snapshot USING btree (organization_id, business_unit_id);
CREATE INDEX idx_quote_org_bu_status ON public.quote USING btree (organization_id, business_unit_id, lifecycle_status);
CREATE INDEX idx_quote_response_version ON public.quote_response USING btree (quote_version_id, response_type);
CREATE UNIQUE INDEX uq_quote_response_single_final ON public.quote_response USING btree (quote_version_id) WHERE (response_type = ANY (ARRAY['accepted'::text, 'declined'::text, 'expired'::text]));
CREATE INDEX idx_quote_version_org_bu_status ON public.quote_version USING btree (organization_id, business_unit_id, lifecycle_status);
CREATE INDEX idx_location_customer ON public.service_location USING btree (customer_id);
CREATE INDEX idx_service_request_attribution ON public.service_request USING btree (marketing_source_id, campaign_id);
CREATE INDEX idx_service_request_org_bu_status ON public.service_request USING btree (organization_id, business_unit_id, lifecycle_status);
CREATE INDEX idx_membership_org ON public.user_membership USING btree (organization_id);
CREATE INDEX idx_membership_user ON public.user_membership USING btree (app_user_id);
CREATE INDEX idx_worker_org ON public.worker USING btree (organization_id);

-- CONTROL-PLANE READ-ONLY SCHEMA EVIDENCE
-- Source: production-like pg_catalog metadata. No application rows copied.
-- Historical function/trigger evidence; canonical baseline must apply current security hardening.

CREATE OR REPLACE FUNCTION public.current_app_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select au.id
  from public.app_user au
  where au.auth_user_id = auth.uid()
    and au.status = 'active'
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_member(target_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_membership um
    where um.app_user_id = public.current_app_user_id()
      and um.organization_id = target_org
      and um.status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_business_unit_member(target_bu uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_membership um
    where um.app_user_id = public.current_app_user_id()
      and um.status = 'active'
      and (um.business_unit_id is null or um.business_unit_id = target_bu)
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_org_role(target_org uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_membership um
    join public.app_role ar on ar.id = um.role_id
    where um.app_user_id = public.current_app_user_id()
      and um.organization_id = target_org
      and um.status = 'active'
      and ar.code = any(allowed_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_bu_role(target_org uuid, target_bu uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_membership um
    join public.app_role ar on ar.id = um.role_id
    where um.app_user_id = public.current_app_user_id()
      and um.organization_id = target_org
      and um.status = 'active'
      and (um.business_unit_id is null or um.business_unit_id = target_bu)
      and ar.code = any(allowed_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.wave2_org_bu_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_unit b
        WHERE b.id = NEW.business_unit_id
          AND b.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'Wave 2 scope violation: business_unit_id does not belong to organization_id';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pricing_snapshot_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE expected_currency text;
BEGIN
    SELECT j.currency_code INTO expected_currency
    FROM public.business_unit b
    LEFT JOIN public.jurisdiction j ON j.id = b.jurisdiction_id
    WHERE b.id = NEW.business_unit_id
      AND b.organization_id = NEW.organization_id;
    IF expected_currency IS NULL THEN
        RAISE EXCEPTION 'Pricing snapshot blocked: business-unit jurisdiction/currency is not configured';
    END IF;
    IF upper(NEW.currency_code) <> upper(expected_currency) THEN
        RAISE EXCEPTION 'Pricing snapshot currency % does not match business-unit currency %', NEW.currency_code, expected_currency;
    END IF;
    NEW.currency_code := upper(NEW.currency_code);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pricing_snapshot_immutable_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'pricing_snapshot is immutable after creation; create a new snapshot';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM public.quote_version qv WHERE qv.pricing_snapshot_id = OLD.id) THEN
            RAISE EXCEPTION 'pricing_snapshot cannot be deleted while referenced by quote_version';
        END IF;
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_version_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE commercial_changed boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.lifecycle_status <> 'draft' THEN
            RAISE EXCEPTION 'New quote_version must begin in draft status';
        END IF;
        RETURN NEW;
    END IF;
    commercial_changed :=
           NEW.pricing_snapshot_id IS DISTINCT FROM OLD.pricing_snapshot_id
        OR NEW.line_items_snapshot IS DISTINCT FROM OLD.line_items_snapshot
        OR NEW.commercial_snapshot IS DISTINCT FROM OLD.commercial_snapshot
        OR NEW.terms_text IS DISTINCT FROM OLD.terms_text
        OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
        OR NEW.version_no IS DISTINCT FROM OLD.version_no
        OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.business_unit_id IS DISTINCT FROM OLD.business_unit_id
        OR NEW.estimate_id IS DISTINCT FROM OLD.estimate_id;
    IF OLD.lifecycle_status <> 'draft' AND commercial_changed THEN
        RAISE EXCEPTION 'Quote version commercial fields are immutable after draft';
    END IF;
    IF OLD.lifecycle_status = 'draft' AND NEW.lifecycle_status = 'sent' AND commercial_changed THEN
        RAISE EXCEPTION 'Persist commercial edits before the separate draft -> sent transition';
    END IF;
    IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
        IF OLD.lifecycle_status = 'draft' AND NEW.lifecycle_status NOT IN ('sent','cancelled') THEN
            RAISE EXCEPTION 'Invalid quote_version transition: % -> %', OLD.lifecycle_status, NEW.lifecycle_status;
        ELSIF OLD.lifecycle_status = 'sent' AND NEW.lifecycle_status NOT IN ('accepted','declined','expired','cancelled') THEN
            RAISE EXCEPTION 'Invalid quote_version transition: % -> %', OLD.lifecycle_status, NEW.lifecycle_status;
        ELSIF OLD.lifecycle_status IN ('accepted','declined','expired','cancelled') THEN
            RAISE EXCEPTION 'Terminal quote_version status % cannot transition to %', OLD.lifecycle_status, NEW.lifecycle_status;
        END IF;
    END IF;
    IF OLD.lifecycle_status = 'draft' AND NEW.lifecycle_status = 'sent' THEN
        NEW.sent_at := COALESCE(NEW.sent_at, now());
    ELSIF OLD.lifecycle_status <> 'draft' AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
        RAISE EXCEPTION 'sent_at is immutable after quote_version leaves draft';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_response_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE quote_version_status text;
BEGIN
    SELECT lifecycle_status INTO quote_version_status
    FROM public.quote_version
    WHERE id = NEW.quote_version_id
      AND organization_id = NEW.organization_id
      AND business_unit_id = NEW.business_unit_id;
    IF quote_version_status IS NULL THEN
        RAISE EXCEPTION 'quote_response does not reference a quote_version in the same scope';
    END IF;
    IF NEW.response_type IN ('accepted','declined','expired','requested_changes') AND quote_version_status <> 'sent' THEN
        RAISE EXCEPTION 'quote_response type % requires quote_version status sent; current status is %', NEW.response_type, quote_version_status;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_response_immutable_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'quote_response is immutable after creation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM public.conversion_record cr WHERE cr.quote_response_id = OLD.id) THEN
            RAISE EXCEPTION 'quote_response cannot be deleted while referenced by conversion_record';
        END IF;
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.conversion_record_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    opportunity_service_request uuid;
    estimate_opportunity uuid;
    quote_opportunity uuid;
    quote_estimate uuid;
    version_quote uuid;
    version_estimate uuid;
    version_status text;
    response_version uuid;
    response_type_value text;
    customer_org uuid;
    customer_bu uuid;
    contact_customer uuid;
    location_customer uuid;
    location_jurisdiction uuid;
    bu_jurisdiction uuid;
BEGIN
    SELECT service_request_id INTO opportunity_service_request
    FROM public.opportunity
    WHERE id = NEW.opportunity_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF opportunity_service_request IS DISTINCT FROM NEW.service_request_id THEN
        RAISE EXCEPTION 'conversion_record opportunity/service_request mismatch';
    END IF;
    IF NEW.estimate_id IS NOT NULL THEN
        SELECT opportunity_id INTO estimate_opportunity
        FROM public.estimate
        WHERE id = NEW.estimate_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
        IF estimate_opportunity IS DISTINCT FROM NEW.opportunity_id THEN
            RAISE EXCEPTION 'conversion_record estimate/opportunity mismatch';
        END IF;
    END IF;
    SELECT opportunity_id, estimate_id INTO quote_opportunity, quote_estimate
    FROM public.quote
    WHERE id = NEW.quote_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF quote_opportunity IS DISTINCT FROM NEW.opportunity_id OR quote_estimate IS DISTINCT FROM NEW.estimate_id THEN
        RAISE EXCEPTION 'conversion_record quote chain mismatch';
    END IF;
    SELECT quote_id, estimate_id, lifecycle_status INTO version_quote, version_estimate, version_status
    FROM public.quote_version
    WHERE id = NEW.quote_version_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF version_quote IS DISTINCT FROM NEW.quote_id OR version_estimate IS DISTINCT FROM NEW.estimate_id OR version_status <> 'accepted' THEN
        RAISE EXCEPTION 'conversion_record requires exact accepted quote_version';
    END IF;
    SELECT quote_version_id, response_type INTO response_version, response_type_value
    FROM public.quote_response
    WHERE id = NEW.quote_response_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF response_version IS DISTINCT FROM NEW.quote_version_id OR response_type_value <> 'accepted' THEN
        RAISE EXCEPTION 'conversion_record requires accepted response for exact quote_version';
    END IF;
    SELECT organization_id, business_unit_id INTO customer_org, customer_bu FROM public.customer WHERE id = NEW.customer_id;
    IF customer_org IS DISTINCT FROM NEW.organization_id OR customer_bu IS DISTINCT FROM NEW.business_unit_id THEN
        RAISE EXCEPTION 'conversion_record customer scope mismatch';
    END IF;
    SELECT customer_id INTO contact_customer FROM public.contact WHERE id = NEW.contact_id;
    IF contact_customer IS DISTINCT FROM NEW.customer_id THEN
        RAISE EXCEPTION 'conversion_record contact/customer mismatch';
    END IF;
    SELECT customer_id, jurisdiction_id INTO location_customer, location_jurisdiction FROM public.service_location WHERE id = NEW.service_location_id;
    IF location_customer IS DISTINCT FROM NEW.customer_id THEN
        RAISE EXCEPTION 'conversion_record service_location/customer mismatch';
    END IF;
    SELECT jurisdiction_id INTO bu_jurisdiction FROM public.business_unit WHERE id = NEW.business_unit_id AND organization_id = NEW.organization_id;
    IF location_jurisdiction IS NOT NULL AND bu_jurisdiction IS NOT NULL AND location_jurisdiction IS DISTINCT FROM bu_jurisdiction THEN
        RAISE EXCEPTION 'conversion_record service_location jurisdiction mismatch';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.job_handoff_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE conversion_version uuid; version_snapshot uuid; version_status text;
BEGIN
    SELECT quote_version_id INTO conversion_version
    FROM public.conversion_record
    WHERE id = NEW.conversion_record_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF conversion_version IS DISTINCT FROM NEW.quote_version_id THEN
        RAISE EXCEPTION 'job_handoff conversion_record/quote_version mismatch';
    END IF;
    SELECT pricing_snapshot_id, lifecycle_status INTO version_snapshot, version_status
    FROM public.quote_version
    WHERE id = NEW.quote_version_id AND organization_id = NEW.organization_id AND business_unit_id = NEW.business_unit_id;
    IF version_snapshot IS DISTINCT FROM NEW.pricing_snapshot_id OR version_status <> 'accepted' THEN
        RAISE EXCEPTION 'job_handoff requires accepted quote_version and exact pricing_snapshot';
    END IF;
    RETURN NEW;
END;
$function$;

-- Exact 16 triggers observed in the foundation layer.
CREATE TRIGGER trg_conversion_record_guard BEFORE INSERT OR UPDATE ON conversion_record FOR EACH ROW EXECUTE FUNCTION conversion_record_guard();
CREATE TRIGGER trg_conversion_record_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON conversion_record FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_estimate_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON estimate FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_job_handoff_guard BEFORE INSERT OR UPDATE ON job_handoff FOR EACH ROW EXECUTE FUNCTION job_handoff_guard();
CREATE TRIGGER trg_job_handoff_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON job_handoff FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_opportunity_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON opportunity FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_pricing_snapshot_immutable BEFORE DELETE OR UPDATE ON pricing_snapshot FOR EACH ROW EXECUTE FUNCTION pricing_snapshot_immutable_guard();
CREATE TRIGGER trg_pricing_snapshot_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON pricing_snapshot FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_pricing_snapshot_scope_guard BEFORE INSERT ON pricing_snapshot FOR EACH ROW EXECUTE FUNCTION pricing_snapshot_scope_guard();
CREATE TRIGGER trg_quote_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON quote FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_quote_response_guard BEFORE INSERT ON quote_response FOR EACH ROW EXECUTE FUNCTION quote_response_guard();
CREATE TRIGGER trg_quote_response_immutable BEFORE DELETE OR UPDATE ON quote_response FOR EACH ROW EXECUTE FUNCTION quote_response_immutable_guard();
CREATE TRIGGER trg_quote_response_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON quote_response FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_quote_version_guard BEFORE INSERT OR UPDATE ON quote_version FOR EACH ROW EXECUTE FUNCTION quote_version_guard();
CREATE TRIGGER trg_quote_version_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON quote_version FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();
CREATE TRIGGER trg_service_request_org_bu_guard BEFORE INSERT OR UPDATE OF organization_id, business_unit_id ON service_request FOR EACH ROW EXECUTE FUNCTION wave2_org_bu_guard();


-- Canonical security reconciliation: legacy sales/finance/qa_supervisor/read_only
-- roles are intentionally excluded. HUC-specific lineage coupling is intentionally removed.
DO $rls$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organization','jurisdiction','app_role','app_user','business_unit','user_membership','customer','contact','service_location','worker','marketing_source','campaign','configuration_version','external_reference','idempotency_key','audit_event','migration_lineage','service_request','opportunity','estimate','pricing_snapshot','quote','quote_version','quote_response','conversion_record','job_handoff']
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); END LOOP;
END $rls$;

CREATE POLICY role_authenticated_select ON app_role FOR SELECT TO authenticated USING (code IN ('owner_admin','office_ops','worker','qa'));
CREATE POLICY app_user_self_select ON app_user FOR SELECT TO authenticated USING (auth_user_id=auth.uid());
CREATE POLICY jurisdiction_authenticated_select ON jurisdiction FOR SELECT TO authenticated USING (true);
CREATE POLICY org_member_select ON organization FOR SELECT TO authenticated USING (is_org_member(id));
CREATE POLICY bu_member_select ON business_unit FOR SELECT TO authenticated USING (is_org_member(organization_id));
CREATE POLICY membership_self_select ON user_membership FOR SELECT TO authenticated USING (app_user_id=current_app_user_id());
CREATE POLICY membership_owner_select ON user_membership FOR SELECT TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin']));
CREATE POLICY config_member_select ON configuration_version FOR SELECT TO authenticated USING (is_org_member(organization_id) AND (business_unit_id IS NULL OR is_business_unit_member(business_unit_id)));
CREATE POLICY config_owner_all ON configuration_version FOR ALL TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin'])) WITH CHECK (has_org_role(organization_id,ARRAY['owner_admin']));

-- Office/owner foundation data access. Worker/QA operational access is introduced by later waves.
CREATE POLICY customer_staff_select ON customer FOR SELECT TO authenticated USING (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY customer_staff_insert ON customer FOR INSERT TO authenticated WITH CHECK (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY customer_staff_update ON customer FOR UPDATE TO authenticated USING (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops'])) WITH CHECK (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY contact_staff_select ON contact FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM customer c WHERE c.id=contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY contact_staff_insert ON contact FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM customer c WHERE c.id=contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY contact_staff_update ON contact FOR UPDATE TO authenticated USING (EXISTS(SELECT 1 FROM customer c WHERE c.id=contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops']))) WITH CHECK (EXISTS(SELECT 1 FROM customer c WHERE c.id=contact.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY location_staff_select ON service_location FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM customer c WHERE c.id=service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY location_staff_insert ON service_location FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM customer c WHERE c.id=service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY location_staff_update ON service_location FOR UPDATE TO authenticated USING (EXISTS(SELECT 1 FROM customer c WHERE c.id=service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops']))) WITH CHECK (EXISTS(SELECT 1 FROM customer c WHERE c.id=service_location.customer_id AND has_bu_role(c.organization_id,c.business_unit_id,ARRAY['owner_admin','office_ops'])));
CREATE POLICY worker_self_or_staff_select ON worker FOR SELECT TO authenticated USING (app_user_id=current_app_user_id() OR has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY worker_staff_write ON worker FOR ALL TO authenticated USING (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops'])) WITH CHECK (has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY marketing_staff_select ON marketing_source FOR SELECT TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY marketing_staff_write ON marketing_source FOR ALL TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin','office_ops'])) WITH CHECK (has_org_role(organization_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY campaign_staff_select ON campaign FOR SELECT TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY campaign_staff_write ON campaign FOR ALL TO authenticated USING (has_org_role(organization_id,ARRAY['owner_admin','office_ops'])) WITH CHECK (has_org_role(organization_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY external_ref_staff_select ON external_reference FOR SELECT TO authenticated USING (organization_id IS NOT NULL AND has_org_role(organization_id,ARRAY['owner_admin','office_ops']));
CREATE POLICY audit_owner_select ON audit_event FOR SELECT TO authenticated USING (organization_id IS NOT NULL AND has_org_role(organization_id,ARRAY['owner_admin']));
CREATE POLICY lineage_owner_select ON migration_lineage FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM user_membership um JOIN app_role ar ON ar.id=um.role_id WHERE um.app_user_id=current_app_user_id() AND um.status='active' AND ar.code='owner_admin'));

-- Wave 2 revenue policy family: office execution, owner oversight.
DO $policies$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['service_request','opportunity','estimate','pricing_snapshot','quote','quote_version','quote_response','conversion_record','job_handoff'] LOOP
   EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (has_bu_role(organization_id,business_unit_id,ARRAY[''owner_admin'',''office_ops'']))','revenue_authorized_read_'||t,t);
   EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (has_bu_role(organization_id,business_unit_id,ARRAY[''owner_admin'',''office_ops''])) WITH CHECK (has_bu_role(organization_id,business_unit_id,ARRAY[''owner_admin'',''office_ops'']))','revenue_staff_write_'||t,t);
 END LOOP;
END $policies$;

-- Table ACLs rely on RLS; anon receives no foundation-table privileges.
DO $acl$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organization','jurisdiction','app_role','app_user','business_unit','user_membership','customer','contact','service_location','worker','marketing_source','campaign','configuration_version','external_reference','idempotency_key','audit_event','migration_lineage','service_request','opportunity','estimate','pricing_snapshot','quote','quote_version','quote_response','conversion_record','job_handoff'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $acl$;

-- RLS helpers are callable only where policies need them.
REVOKE ALL ON FUNCTION current_app_user_id(),is_org_member(uuid),is_business_unit_member(uuid),has_org_role(uuid,text[]),has_bu_role(uuid,uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION current_app_user_id(),is_org_member(uuid),is_business_unit_member(uuid),has_org_role(uuid,text[]),has_bu_role(uuid,uuid,text[]) TO authenticated,service_role;
-- Internal trigger guards are never directly callable by application roles.
REVOKE ALL ON FUNCTION wave2_org_bu_guard(),pricing_snapshot_scope_guard(),pricing_snapshot_immutable_guard(),quote_version_guard(),quote_response_guard(),quote_response_immutable_guard(),conversion_record_guard(),job_handoff_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION wave2_org_bu_guard(),pricing_snapshot_scope_guard(),pricing_snapshot_immutable_guard(),quote_version_guard(),quote_response_guard(),quote_response_immutable_guard(),conversion_record_guard(),job_handoff_guard() TO service_role;
COMMIT;
