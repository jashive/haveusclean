-- Goal 5.1 / 5.2 — Customer response + atomic accepted-quote transition
-- ServiceOS remains SOR. Only an explicit accepted response may create a conversion and ready job handoff.

BEGIN;

ALTER TABLE public.quote_response
  DROP CONSTRAINT IF EXISTS quote_response_response_type_check;

ALTER TABLE public.quote_response
  ADD CONSTRAINT quote_response_response_type_check
  CHECK (response_type = ANY (ARRAY[
    'viewed'::text,
    'requested_changes'::text,
    'follow_up_required'::text,
    'no_response'::text,
    'accepted'::text,
    'declined'::text,
    'expired'::text
  ]));

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

    IF NEW.response_type IN (
      'accepted','declined','expired','requested_changes','follow_up_required','no_response'
    ) AND quote_version_status <> 'sent' THEN
        RAISE EXCEPTION 'quote_response type % requires quote_version status sent; current status is %', NEW.response_type, quote_version_status;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_quote_response_and_convert(
  p_quote_version_id uuid,
  p_response_type text,
  p_response_channel text DEFAULT 'serviceos_office_ui',
  p_responded_by_name text DEFAULT NULL,
  p_responded_by_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_address_line1 text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_jurisdiction_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_org_id uuid;
  v_bu_id uuid;
  v_quote_id uuid;
  v_estimate_id uuid;
  v_pricing_snapshot_id uuid;
  v_opportunity_id uuid;
  v_service_request_id uuid;
  v_quote_status text;
  v_actor uuid;
  v_response public.quote_response%ROWTYPE;
  v_conversion public.conversion_record%ROWTYPE;
  v_handoff public.job_handoff%ROWTYPE;
  v_customer public.customer%ROWTYPE;
  v_contact public.contact%ROWTYPE;
  v_location public.service_location%ROWTYPE;
BEGIN
  IF p_response_type NOT IN ('accepted','declined','requested_changes','follow_up_required','no_response') THEN
    RAISE EXCEPTION 'Unsupported office response type: %', p_response_type;
  END IF;

  SELECT qv.organization_id,
         qv.business_unit_id,
         qv.quote_id,
         qv.estimate_id,
         qv.pricing_snapshot_id,
         q.opportunity_id,
         o.service_request_id,
         qv.lifecycle_status
    INTO v_org_id, v_bu_id, v_quote_id, v_estimate_id, v_pricing_snapshot_id,
         v_opportunity_id, v_service_request_id, v_quote_status
  FROM public.quote_version qv
  JOIN public.quote q ON q.id = qv.quote_id
    AND q.organization_id = qv.organization_id
    AND q.business_unit_id = qv.business_unit_id
  JOIN public.opportunity o ON o.id = q.opportunity_id
    AND o.organization_id = qv.organization_id
    AND o.business_unit_id = qv.business_unit_id
  WHERE qv.id = p_quote_version_id
  FOR UPDATE OF qv;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Quote version not found or not visible in current scope';
  END IF;

  IF NOT public.has_bu_role(v_org_id, v_bu_id, ARRAY['owner_admin','office_ops']) THEN
    RAISE EXCEPTION 'Revenue role is not authorized for this business unit';
  END IF;

  v_actor := public.current_app_user_id();

  -- Retry/idempotency fast path. A previously completed acceptance is returned unchanged.
  IF p_response_type = 'accepted' THEN
    SELECT * INTO v_conversion
    FROM public.conversion_record
    WHERE quote_version_id = p_quote_version_id
      AND organization_id = v_org_id
      AND business_unit_id = v_bu_id;

    IF v_conversion.id IS NOT NULL THEN
      SELECT * INTO v_response FROM public.quote_response WHERE id = v_conversion.quote_response_id;
      SELECT * INTO v_handoff FROM public.job_handoff WHERE conversion_record_id = v_conversion.id;
      IF v_handoff.id IS NULL THEN
        RAISE EXCEPTION 'Accepted conversion exists without required job handoff; manual integrity review required';
      END IF;
      RETURN jsonb_build_object(
        'idempotent_replay', true,
        'response', to_jsonb(v_response),
        'conversion_record', to_jsonb(v_conversion),
        'job_handoff', to_jsonb(v_handoff)
      );
    END IF;
  END IF;

  IF v_quote_status <> 'sent' THEN
    RAISE EXCEPTION 'Customer response requires a sent quote_version; current status is %', v_quote_status;
  END IF;

  INSERT INTO public.quote_response (
    organization_id, business_unit_id, quote_version_id,
    response_type, response_channel, responded_by_name, responded_by_email,
    responded_at, notes, metadata, created_by_app_user_id
  ) VALUES (
    v_org_id, v_bu_id, p_quote_version_id,
    p_response_type, COALESCE(NULLIF(btrim(p_response_channel), ''), 'serviceos_office_ui'),
    NULLIF(btrim(p_responded_by_name), ''), NULLIF(btrim(p_responded_by_email), ''),
    now(), NULLIF(btrim(p_notes), ''), COALESCE(p_metadata, '{}'::jsonb), v_actor
  )
  RETURNING * INTO v_response;

  -- Every non-accepted outcome stops here. No conversion or handoff is permitted.
  IF p_response_type <> 'accepted' THEN
    IF p_response_type = 'declined' THEN
      UPDATE public.quote_version
         SET lifecycle_status = 'declined', updated_by_app_user_id = v_actor
       WHERE id = p_quote_version_id;
      UPDATE public.quote
         SET lifecycle_status = 'declined', updated_by_app_user_id = v_actor
       WHERE id = v_quote_id;
      UPDATE public.opportunity
         SET stage = 'lost', close_reason = COALESCE(NULLIF(btrim(p_notes), ''), 'Customer declined quote'), updated_by_app_user_id = v_actor
       WHERE id = v_opportunity_id;
    END IF;

    RETURN jsonb_build_object(
      'idempotent_replay', false,
      'response', to_jsonb(v_response),
      'conversion_record', NULL,
      'job_handoff', NULL
    );
  END IF;

  IF NULLIF(btrim(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'Accepted response requires customer name';
  END IF;
  IF NULLIF(btrim(p_customer_email), '') IS NULL AND NULLIF(btrim(p_customer_phone), '') IS NULL THEN
    RAISE EXCEPTION 'Accepted response requires customer email or phone';
  END IF;
  IF NULLIF(btrim(p_address_line1), '') IS NULL OR NULLIF(btrim(p_city), '') IS NULL OR p_jurisdiction_id IS NULL THEN
    RAISE EXCEPTION 'Accepted response requires service address, city, and jurisdiction';
  END IF;

  -- Acceptance becomes authoritative before conversion guards are evaluated.
  UPDATE public.quote_version
     SET lifecycle_status = 'accepted', updated_by_app_user_id = v_actor
   WHERE id = p_quote_version_id;

  INSERT INTO public.customer (
    organization_id, business_unit_id, customer_type, display_name, legal_name,
    status, metadata
  ) VALUES (
    v_org_id, v_bu_id, 'person', btrim(p_customer_name), NULL,
    'active', COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source','serviceos_accepted_quote')
  ) RETURNING * INTO v_customer;

  INSERT INTO public.contact (
    customer_id, contact_type, first_name, last_name, email, phone, is_primary, metadata
  ) VALUES (
    v_customer.id, 'primary', btrim(p_customer_name), NULL,
    NULLIF(btrim(p_customer_email), ''), NULLIF(btrim(p_customer_phone), ''), true,
    jsonb_build_object('source','serviceos_accepted_quote')
  ) RETURNING * INTO v_contact;

  INSERT INTO public.service_location (
    customer_id, jurisdiction_id, label, address_line1, city, subdivision,
    postal_code, country_code, access_notes, metadata
  ) VALUES (
    v_customer.id, p_jurisdiction_id, 'Primary service location', btrim(p_address_line1),
    btrim(p_city), 'ON', NULLIF(btrim(p_postal_code), ''), 'CA', NULL,
    jsonb_build_object('source','serviceos_accepted_quote')
  ) RETURNING * INTO v_location;

  INSERT INTO public.conversion_record (
    organization_id, business_unit_id, service_request_id, opportunity_id,
    estimate_id, quote_id, quote_version_id, quote_response_id,
    customer_id, contact_id, service_location_id, converted_at,
    metadata, created_by_app_user_id
  ) VALUES (
    v_org_id, v_bu_id, v_service_request_id, v_opportunity_id,
    v_estimate_id, v_quote_id, p_quote_version_id, v_response.id,
    v_customer.id, v_contact.id, v_location.id, now(),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source','serviceos_office_acceptance'), v_actor
  ) RETURNING * INTO v_conversion;

  INSERT INTO public.job_handoff (
    organization_id, business_unit_id, conversion_record_id, quote_version_id,
    pricing_snapshot_id, handoff_status, handoff_payload, metadata,
    handed_off_at, created_by_app_user_id
  ) VALUES (
    v_org_id, v_bu_id, v_conversion.id, p_quote_version_id,
    v_pricing_snapshot_id, 'ready',
    jsonb_build_object(
      'customer_id', v_customer.id,
      'contact_id', v_contact.id,
      'service_location_id', v_location.id,
      'source', 'serviceos_office_acceptance'
    ),
    COALESCE(p_metadata, '{}'::jsonb), now(), v_actor
  ) RETURNING * INTO v_handoff;

  UPDATE public.quote
     SET lifecycle_status = 'accepted', customer_id = v_customer.id,
         contact_id = v_contact.id, service_location_id = v_location.id,
         updated_by_app_user_id = v_actor
   WHERE id = v_quote_id;

  UPDATE public.opportunity
     SET stage = 'won', customer_id = v_customer.id,
         contact_id = v_contact.id, service_location_id = v_location.id,
         updated_by_app_user_id = v_actor
   WHERE id = v_opportunity_id;

  UPDATE public.service_request
     SET lifecycle_status = 'converted', customer_id = v_customer.id,
         contact_id = v_contact.id, service_location_id = v_location.id,
         updated_by_app_user_id = v_actor
   WHERE id = v_service_request_id;

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'response', to_jsonb(v_response),
    'conversion_record', to_jsonb(v_conversion),
    'job_handoff', to_jsonb(v_handoff),
    'customer', to_jsonb(v_customer),
    'contact', to_jsonb(v_contact),
    'service_location', to_jsonb(v_location)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_quote_response_and_convert(
  uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_quote_response_and_convert(
  uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb
) TO authenticated, service_role;

COMMIT;
