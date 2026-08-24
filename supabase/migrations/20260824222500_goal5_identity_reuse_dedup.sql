-- Goal 5.3 — Canonical identity reuse + duplicate protection
-- Preserve the accepted-quote transaction boundary while preventing duplicate customer/contact/location creation.
-- Resolution order inside conversion: existing service_request identity -> exact scoped identity match -> create new.

BEGIN;

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
  v_sr_customer_id uuid;
  v_sr_contact_id uuid;
  v_sr_location_id uuid;
  v_customer_match_ids uuid[];
  v_contact_match_ids uuid[];
  v_location_match_ids uuid[];
  v_identity_resolution text := 'created_new';
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
         qv.lifecycle_status,
         sr.customer_id,
         sr.contact_id,
         sr.service_location_id
    INTO v_org_id, v_bu_id, v_quote_id, v_estimate_id, v_pricing_snapshot_id,
         v_opportunity_id, v_service_request_id, v_quote_status,
         v_sr_customer_id, v_sr_contact_id, v_sr_location_id
  FROM public.quote_version qv
  JOIN public.quote q ON q.id = qv.quote_id
    AND q.organization_id = qv.organization_id
    AND q.business_unit_id = qv.business_unit_id
  JOIN public.opportunity o ON o.id = q.opportunity_id
    AND o.organization_id = qv.organization_id
    AND o.business_unit_id = qv.business_unit_id
  JOIN public.service_request sr ON sr.id = o.service_request_id
    AND sr.organization_id = qv.organization_id
    AND sr.business_unit_id = qv.business_unit_id
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
        'identity_resolution', COALESCE(v_conversion.metadata->>'identity_resolution', 'existing_conversion'),
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

  -- Every non-accepted outcome stops here. No identity mutation, conversion, or handoff is permitted.
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
      'identity_resolution', NULL,
      'response', to_jsonb(v_response),
      'conversion_record', NULL,
      'job_handoff', NULL
    );
  END IF;

  -- 5.3 Resolution 1: the service_request already owns a complete canonical identity.
  IF v_sr_customer_id IS NOT NULL OR v_sr_contact_id IS NOT NULL OR v_sr_location_id IS NOT NULL THEN
    IF v_sr_customer_id IS NULL OR v_sr_contact_id IS NULL OR v_sr_location_id IS NULL THEN
      RAISE EXCEPTION 'Service request has partial canonical identity; manual duplicate review required';
    END IF;

    SELECT * INTO v_customer
      FROM public.customer
     WHERE id = v_sr_customer_id
       AND organization_id = v_org_id
       AND (business_unit_id IS NULL OR business_unit_id = v_bu_id);
    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'Service request customer is missing or outside the current organization/business unit';
    END IF;

    SELECT * INTO v_contact
      FROM public.contact
     WHERE id = v_sr_contact_id
       AND customer_id = v_customer.id;
    IF v_contact.id IS NULL THEN
      RAISE EXCEPTION 'Service request contact does not belong to the canonical customer';
    END IF;

    SELECT * INTO v_location
      FROM public.service_location
     WHERE id = v_sr_location_id
       AND customer_id = v_customer.id;
    IF v_location.id IS NULL THEN
      RAISE EXCEPTION 'Service request location does not belong to the canonical customer';
    END IF;

    -- Fail closed when supplied acceptance details clearly conflict with canonical identity.
    IF NULLIF(btrim(p_customer_email), '') IS NOT NULL
       AND NULLIF(btrim(v_contact.email), '') IS NOT NULL
       AND lower(btrim(p_customer_email)) <> lower(btrim(v_contact.email)) THEN
      RAISE EXCEPTION 'Acceptance email conflicts with canonical service-request contact; manual duplicate review required';
    END IF;
    IF NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND NULLIF(regexp_replace(COALESCE(v_contact.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
       AND regexp_replace(p_customer_phone, '[^0-9]', '', 'g') <> regexp_replace(v_contact.phone, '[^0-9]', '', 'g') THEN
      RAISE EXCEPTION 'Acceptance phone conflicts with canonical service-request contact; manual duplicate review required';
    END IF;
    IF NULLIF(btrim(p_address_line1), '') IS NOT NULL
       AND NULLIF(btrim(v_location.address_line1), '') IS NOT NULL
       AND lower(regexp_replace(btrim(p_address_line1), '\s+', ' ', 'g')) <> lower(regexp_replace(btrim(v_location.address_line1), '\s+', ' ', 'g')) THEN
      RAISE EXCEPTION 'Acceptance address conflicts with canonical service-request location; manual duplicate review required';
    END IF;

    v_identity_resolution := 'existing_service_request';
  ELSE
    -- 5.3 Resolution 2a: exact customer + normalized address match when a customer name is supplied.
    IF NULLIF(btrim(p_customer_name), '') IS NOT NULL
       AND NULLIF(btrim(p_address_line1), '') IS NOT NULL
       AND NULLIF(btrim(p_city), '') IS NOT NULL THEN
      SELECT array_agg(DISTINCT cu.id)
        INTO v_customer_match_ids
      FROM public.customer cu
      JOIN public.service_location sl ON sl.customer_id = cu.id
      WHERE cu.organization_id = v_org_id
        AND (cu.business_unit_id IS NULL OR cu.business_unit_id = v_bu_id)
        AND lower(regexp_replace(btrim(cu.display_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_customer_name), '\s+', ' ', 'g'))
        AND lower(regexp_replace(btrim(COALESCE(sl.address_line1, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_address_line1), '\s+', ' ', 'g'))
        AND lower(regexp_replace(btrim(COALESCE(sl.city, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_city), '\s+', ' ', 'g'))
        AND (
          NULLIF(regexp_replace(upper(COALESCE(p_postal_code, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
          OR regexp_replace(upper(COALESCE(sl.postal_code, '')), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_postal_code), '[^A-Z0-9]', '', 'g')
        );
    END IF;

    IF COALESCE(cardinality(v_customer_match_ids), 0) > 1 THEN
      RAISE EXCEPTION 'Multiple canonical customers match name/address; manual duplicate review required';
    ELSIF COALESCE(cardinality(v_customer_match_ids), 0) = 1 THEN
      SELECT * INTO v_customer FROM public.customer WHERE id = v_customer_match_ids[1];
    ELSE
      v_customer_match_ids := NULL;
    END IF;

    -- 5.3 Resolution 2b: exact normalized email/phone match scoped through customer org/business unit.
    IF v_customer.id IS NULL
       AND (NULLIF(btrim(p_customer_email), '') IS NOT NULL
            OR NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL) THEN
      SELECT array_agg(DISTINCT cu.id)
        INTO v_customer_match_ids
      FROM public.customer cu
      JOIN public.contact c ON c.customer_id = cu.id
      WHERE cu.organization_id = v_org_id
        AND (cu.business_unit_id IS NULL OR cu.business_unit_id = v_bu_id)
        AND (
          (NULLIF(btrim(p_customer_email), '') IS NOT NULL
           AND NULLIF(btrim(c.email), '') IS NOT NULL
           AND lower(btrim(c.email)) = lower(btrim(p_customer_email)))
          OR
          (NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
           AND NULLIF(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
           AND regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(p_customer_phone, '[^0-9]', '', 'g'))
        );

      IF COALESCE(cardinality(v_customer_match_ids), 0) > 1 THEN
        RAISE EXCEPTION 'Email/phone matches multiple canonical customers; manual duplicate review required';
      ELSIF COALESCE(cardinality(v_customer_match_ids), 0) = 1 THEN
        SELECT * INTO v_customer FROM public.customer WHERE id = v_customer_match_ids[1];
      END IF;
    END IF;

    IF v_customer.id IS NOT NULL THEN
      -- Resolve exactly one matching contact for the chosen customer. Ambiguity fails closed.
      SELECT array_agg(c.id ORDER BY c.is_primary DESC, c.created_at ASC)
        INTO v_contact_match_ids
      FROM public.contact c
      WHERE c.customer_id = v_customer.id
        AND (
          (NULLIF(btrim(p_customer_email), '') IS NOT NULL
           AND NULLIF(btrim(c.email), '') IS NOT NULL
           AND lower(btrim(c.email)) = lower(btrim(p_customer_email)))
          OR
          (NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
           AND NULLIF(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
           AND regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(p_customer_phone, '[^0-9]', '', 'g'))
        );

      IF COALESCE(cardinality(v_contact_match_ids), 0) > 1 THEN
        RAISE EXCEPTION 'Multiple contacts match the accepted identity; manual duplicate review required';
      ELSIF COALESCE(cardinality(v_contact_match_ids), 0) = 1 THEN
        SELECT * INTO v_contact FROM public.contact WHERE id = v_contact_match_ids[1];
      ELSE
        IF NULLIF(btrim(p_customer_email), '') IS NULL AND NULLIF(btrim(p_customer_phone), '') IS NULL THEN
          RAISE EXCEPTION 'Existing customer match requires an unambiguous contact; manual duplicate review required';
        END IF;
        INSERT INTO public.contact (
          customer_id, contact_type, first_name, last_name, email, phone, is_primary, metadata
        ) VALUES (
          v_customer.id, 'primary', NULLIF(btrim(p_customer_name), ''), NULL,
          NULLIF(btrim(p_customer_email), ''), NULLIF(btrim(p_customer_phone), ''), false,
          jsonb_build_object('source','serviceos_accepted_quote','identity_resolution','existing_customer_new_contact')
        ) RETURNING * INTO v_contact;
      END IF;

      -- Reuse one exact normalized service location; create a new location for this customer only when no exact location exists.
      IF NULLIF(btrim(p_address_line1), '') IS NULL OR NULLIF(btrim(p_city), '') IS NULL OR p_jurisdiction_id IS NULL THEN
        RAISE EXCEPTION 'Existing customer acceptance requires service address, city, and jurisdiction when no service-request location is attached';
      END IF;

      SELECT array_agg(sl.id ORDER BY sl.created_at ASC)
        INTO v_location_match_ids
      FROM public.service_location sl
      WHERE sl.customer_id = v_customer.id
        AND lower(regexp_replace(btrim(COALESCE(sl.address_line1, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_address_line1), '\s+', ' ', 'g'))
        AND lower(regexp_replace(btrim(COALESCE(sl.city, '')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_city), '\s+', ' ', 'g'))
        AND (
          NULLIF(regexp_replace(upper(COALESCE(p_postal_code, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
          OR regexp_replace(upper(COALESCE(sl.postal_code, '')), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(p_postal_code), '[^A-Z0-9]', '', 'g')
        );

      IF COALESCE(cardinality(v_location_match_ids), 0) > 1 THEN
        RAISE EXCEPTION 'Multiple service locations match the accepted address; manual duplicate review required';
      ELSIF COALESCE(cardinality(v_location_match_ids), 0) = 1 THEN
        SELECT * INTO v_location FROM public.service_location WHERE id = v_location_match_ids[1];
      ELSE
        INSERT INTO public.service_location (
          customer_id, jurisdiction_id, label, address_line1, city, subdivision,
          postal_code, country_code, access_notes, metadata
        ) VALUES (
          v_customer.id, p_jurisdiction_id, 'Service location', btrim(p_address_line1),
          btrim(p_city), 'ON', NULLIF(btrim(p_postal_code), ''), 'CA', NULL,
          jsonb_build_object('source','serviceos_accepted_quote','identity_resolution','existing_customer_new_location')
        ) RETURNING * INTO v_location;
      END IF;

      v_identity_resolution := 'exact_scoped_match';
    ELSE
      -- 5.3 Resolution 3: no canonical identity exists. Create one new customer/contact/location.
      IF NULLIF(btrim(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'New customer acceptance requires customer name';
      END IF;
      IF NULLIF(btrim(p_customer_email), '') IS NULL AND NULLIF(btrim(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'New customer acceptance requires customer email or phone';
      END IF;
      IF NULLIF(btrim(p_address_line1), '') IS NULL OR NULLIF(btrim(p_city), '') IS NULL OR p_jurisdiction_id IS NULL THEN
        RAISE EXCEPTION 'New customer acceptance requires service address, city, and jurisdiction';
      END IF;

      INSERT INTO public.customer (
        organization_id, business_unit_id, customer_type, display_name, legal_name,
        status, metadata
      ) VALUES (
        v_org_id, v_bu_id, 'person', btrim(p_customer_name), NULL,
        'active', COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source','serviceos_accepted_quote','identity_resolution','created_new')
      ) RETURNING * INTO v_customer;

      INSERT INTO public.contact (
        customer_id, contact_type, first_name, last_name, email, phone, is_primary, metadata
      ) VALUES (
        v_customer.id, 'primary', btrim(p_customer_name), NULL,
        NULLIF(btrim(p_customer_email), ''), NULLIF(btrim(p_customer_phone), ''), true,
        jsonb_build_object('source','serviceos_accepted_quote','identity_resolution','created_new')
      ) RETURNING * INTO v_contact;

      INSERT INTO public.service_location (
        customer_id, jurisdiction_id, label, address_line1, city, subdivision,
        postal_code, country_code, access_notes, metadata
      ) VALUES (
        v_customer.id, p_jurisdiction_id, 'Primary service location', btrim(p_address_line1),
        btrim(p_city), 'ON', NULLIF(btrim(p_postal_code), ''), 'CA', NULL,
        jsonb_build_object('source','serviceos_accepted_quote','identity_resolution','created_new')
      ) RETURNING * INTO v_location;

      v_identity_resolution := 'created_new';
    END IF;
  END IF;

  -- Acceptance becomes authoritative only after identity resolution succeeds.
  UPDATE public.quote_version
     SET lifecycle_status = 'accepted', updated_by_app_user_id = v_actor
   WHERE id = p_quote_version_id;

  INSERT INTO public.conversion_record (
    organization_id, business_unit_id, service_request_id, opportunity_id,
    estimate_id, quote_id, quote_version_id, quote_response_id,
    customer_id, contact_id, service_location_id, converted_at,
    metadata, created_by_app_user_id
  ) VALUES (
    v_org_id, v_bu_id, v_service_request_id, v_opportunity_id,
    v_estimate_id, v_quote_id, p_quote_version_id, v_response.id,
    v_customer.id, v_contact.id, v_location.id, now(),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source','serviceos_office_acceptance',
      'identity_resolution',v_identity_resolution,
      'customer_id',v_customer.id,
      'contact_id',v_contact.id,
      'service_location_id',v_location.id
    ), v_actor
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
      'source', 'serviceos_office_acceptance',
      'identity_resolution', v_identity_resolution
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
    'identity_resolution', v_identity_resolution,
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
