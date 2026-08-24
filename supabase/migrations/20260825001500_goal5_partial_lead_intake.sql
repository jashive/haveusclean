-- Goal 5.6 — Save Lead / Qualify Later
-- Canonically capture incomplete inbound leads before quote qualification.
-- Creates only service_request=intake + opportunity=open. No customer conversion,
-- estimate, pricing, quote, handoff, job, provider, accounting, or Wave 6 effects.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_request_external_intake_source
ON public.service_request (
  organization_id,
  business_unit_id,
  (metadata->>'external_source_system'),
  (metadata->>'external_source_id')
)
WHERE NULLIF(metadata->>'external_source_system','') IS NOT NULL
  AND NULLIF(metadata->>'external_source_id','') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_inbound_lead(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_service_category text DEFAULT 'residential',
  p_intake_channel text DEFAULT 'office_manual',
  p_lead_source text DEFAULT NULL,
  p_external_source_system text DEFAULT NULL,
  p_external_source_id text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_address_line1 text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_property_type text DEFAULT NULL,
  p_bedrooms numeric DEFAULT NULL,
  p_bathrooms numeric DEFAULT NULL,
  p_square_feet numeric DEFAULT NULL,
  p_clean_type text DEFAULT NULL,
  p_frequency text DEFAULT NULL,
  p_preferred_date text DEFAULT NULL,
  p_preferred_time text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_existing_sr public.service_request%ROWTYPE;
  v_existing_opp public.opportunity%ROWTYPE;
  v_service_request public.service_request%ROWTYPE;
  v_opportunity public.opportunity%ROWTYPE;
  v_source_system text := NULLIF(lower(btrim(p_external_source_system)), '');
  v_source_id text := NULLIF(btrim(p_external_source_id), '');
  v_phone_norm text := NULLIF(regexp_replace(COALESCE(p_customer_phone,''), '[^0-9]', '', 'g'), '');
  v_email_norm text := NULLIF(lower(btrim(p_customer_email)), '');
  v_name_norm text := NULLIF(lower(regexp_replace(btrim(COALESCE(p_customer_name,'')), '\s+', ' ', 'g')), '');
  v_address_norm text := NULLIF(lower(regexp_replace(btrim(COALESCE(p_address_line1,'')), '\s+', ' ', 'g')), '');
  v_city_norm text := NULLIF(lower(regexp_replace(btrim(COALESCE(p_city,'')), '\s+', ' ', 'g')), '');
  v_match_ids uuid[];
  v_requirements jsonb;
  v_metadata jsonb;
  v_title text;
BEGIN
  IF p_organization_id IS NULL OR p_business_unit_id IS NULL THEN
    RAISE EXCEPTION 'Organization and business unit are required';
  END IF;

  IF NOT public.has_bu_role(p_organization_id, p_business_unit_id, ARRAY['owner_admin','office_ops']) THEN
    RAISE EXCEPTION 'Revenue role is not authorized for this business unit';
  END IF;

  IF NULLIF(btrim(p_customer_name),'') IS NULL
     AND v_phone_norm IS NULL
     AND v_email_norm IS NULL
     AND v_source_id IS NULL THEN
    RAISE EXCEPTION 'Lead intake requires a name, phone, email, or external source ID';
  END IF;

  v_actor := public.current_app_user_id();

  -- Serialize exact external-source intake so two retries cannot create two rows.
  IF v_source_system IS NOT NULL AND v_source_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        p_organization_id::text || ':' || p_business_unit_id::text || ':' || v_source_system || ':' || v_source_id,
        0
      )
    );

    SELECT * INTO v_existing_sr
    FROM public.service_request sr
    WHERE sr.organization_id = p_organization_id
      AND sr.business_unit_id = p_business_unit_id
      AND lower(COALESCE(sr.metadata->>'external_source_system','')) = v_source_system
      AND sr.metadata->>'external_source_id' = v_source_id
    ORDER BY sr.created_at ASC
    LIMIT 1;

    IF v_existing_sr.id IS NOT NULL THEN
      SELECT * INTO v_existing_opp
      FROM public.opportunity o
      WHERE o.organization_id = p_organization_id
        AND o.business_unit_id = p_business_unit_id
        AND o.service_request_id = v_existing_sr.id
      ORDER BY o.created_at ASC
      LIMIT 1;

      RETURN jsonb_build_object(
        'created', false,
        'duplicate_review_required', false,
        'dedup_reason', 'external_source_id',
        'service_request', to_jsonb(v_existing_sr),
        'opportunity', CASE WHEN v_existing_opp.id IS NULL THEN NULL ELSE to_jsonb(v_existing_opp) END
      );
    END IF;
  END IF;

  -- Active phone/email match: do not auto-merge and do not silently create another request.
  -- Surface the existing canonical lead for explicit office review.
  IF v_phone_norm IS NOT NULL OR v_email_norm IS NOT NULL THEN
    SELECT array_agg(sr.id ORDER BY sr.created_at ASC)
      INTO v_match_ids
    FROM public.service_request sr
    WHERE sr.organization_id = p_organization_id
      AND sr.business_unit_id = p_business_unit_id
      AND sr.lifecycle_status NOT IN ('converted','cancelled','closed')
      AND (
        (v_phone_norm IS NOT NULL
         AND regexp_replace(COALESCE(sr.requirements#>>'{customer,phone}',''), '[^0-9]', '', 'g') = v_phone_norm)
        OR
        (v_email_norm IS NOT NULL
         AND lower(btrim(COALESCE(sr.requirements#>>'{customer,email}',''))) = v_email_norm)
      );

    IF COALESCE(cardinality(v_match_ids),0) > 1 THEN
      RAISE EXCEPTION 'Phone/email matches multiple active service requests; manual duplicate review required';
    ELSIF COALESCE(cardinality(v_match_ids),0) = 1 THEN
      SELECT * INTO v_existing_sr FROM public.service_request WHERE id = v_match_ids[1];
      SELECT * INTO v_existing_opp
      FROM public.opportunity o
      WHERE o.organization_id = p_organization_id
        AND o.business_unit_id = p_business_unit_id
        AND o.service_request_id = v_existing_sr.id
      ORDER BY o.created_at ASC
      LIMIT 1;

      RETURN jsonb_build_object(
        'created', false,
        'duplicate_review_required', true,
        'dedup_reason', 'active_phone_or_email',
        'service_request', to_jsonb(v_existing_sr),
        'opportunity', CASE WHEN v_existing_opp.id IS NULL THEN NULL ELSE to_jsonb(v_existing_opp) END
      );
    END IF;
  END IF;

  -- Exact name + address/city match is also review-only when no phone/email match exists.
  IF v_name_norm IS NOT NULL AND v_address_norm IS NOT NULL AND v_city_norm IS NOT NULL THEN
    SELECT array_agg(sr.id ORDER BY sr.created_at ASC)
      INTO v_match_ids
    FROM public.service_request sr
    WHERE sr.organization_id = p_organization_id
      AND sr.business_unit_id = p_business_unit_id
      AND sr.lifecycle_status NOT IN ('converted','cancelled','closed')
      AND lower(regexp_replace(btrim(COALESCE(sr.requirements#>>'{customer,name}','')), '\s+', ' ', 'g')) = v_name_norm
      AND lower(regexp_replace(btrim(COALESCE(sr.requirements#>>'{location,address}','')), '\s+', ' ', 'g')) = v_address_norm
      AND lower(regexp_replace(btrim(COALESCE(sr.requirements#>>'{location,city}','')), '\s+', ' ', 'g')) = v_city_norm;

    IF COALESCE(cardinality(v_match_ids),0) > 1 THEN
      RAISE EXCEPTION 'Name/address matches multiple active service requests; manual duplicate review required';
    ELSIF COALESCE(cardinality(v_match_ids),0) = 1 THEN
      SELECT * INTO v_existing_sr FROM public.service_request WHERE id = v_match_ids[1];
      SELECT * INTO v_existing_opp
      FROM public.opportunity o
      WHERE o.organization_id = p_organization_id
        AND o.business_unit_id = p_business_unit_id
        AND o.service_request_id = v_existing_sr.id
      ORDER BY o.created_at ASC
      LIMIT 1;

      RETURN jsonb_build_object(
        'created', false,
        'duplicate_review_required', true,
        'dedup_reason', 'active_name_address',
        'service_request', to_jsonb(v_existing_sr),
        'opportunity', CASE WHEN v_existing_opp.id IS NULL THEN NULL ELSE to_jsonb(v_existing_opp) END
      );
    END IF;
  END IF;

  v_requirements := jsonb_build_object(
    'customer', jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(p_customer_name),''),
      'phone', NULLIF(btrim(p_customer_phone),''),
      'email', NULLIF(btrim(p_customer_email),'')
    )),
    'location', jsonb_strip_nulls(jsonb_build_object(
      'address', NULLIF(btrim(p_address_line1),''),
      'city', NULLIF(btrim(p_city),''),
      'postalCode', NULLIF(btrim(p_postal_code),'')
    )),
    'scope', jsonb_strip_nulls(jsonb_build_object(
      'propertyType', NULLIF(btrim(p_property_type),''),
      'beds', p_bedrooms,
      'baths', p_bathrooms,
      'sqft', p_square_feet,
      'cleanType', NULLIF(btrim(p_clean_type),''),
      'frequency', NULLIF(btrim(p_frequency),''),
      'preferredDate', NULLIF(btrim(p_preferred_date),''),
      'preferredWindow', NULLIF(btrim(p_preferred_time),''),
      'notes', NULLIF(btrim(p_notes),'')
    ))
  );

  v_metadata := COALESCE(p_metadata,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'source', COALESCE(NULLIF(btrim(p_lead_source),''), NULLIF(btrim(p_intake_channel),''), 'office_manual'),
      'lead_source', NULLIF(btrim(p_lead_source),''),
      'external_source_system', v_source_system,
      'external_source_id', v_source_id,
      'synthetic', false,
      'partial_intake', true,
      'quote_ready', false
    ));

  v_title := COALESCE(NULLIF(btrim(p_customer_name),''), NULLIF(btrim(p_customer_phone),''), NULLIF(btrim(p_customer_email),''), 'Inbound lead')
    || ' — ' || COALESCE(NULLIF(btrim(p_clean_type),''), NULLIF(btrim(p_service_category),''), 'service inquiry');

  INSERT INTO public.service_request(
    organization_id,business_unit_id,service_category,lifecycle_status,requested_at,
    intake_channel,title,description,requirements,metadata,created_by_app_user_id,updated_by_app_user_id
  ) VALUES (
    p_organization_id,p_business_unit_id,COALESCE(NULLIF(btrim(p_service_category),''),'residential'),'intake',now(),
    COALESCE(NULLIF(btrim(p_intake_channel),''),'office_manual'),v_title,NULLIF(btrim(p_notes),''),
    v_requirements,v_metadata,v_actor,v_actor
  ) RETURNING * INTO v_service_request;

  INSERT INTO public.opportunity(
    organization_id,business_unit_id,service_request_id,stage,title,summary,metadata,
    created_by_app_user_id,updated_by_app_user_id
  ) VALUES (
    p_organization_id,p_business_unit_id,v_service_request.id,'open',v_title,
    'Inbound lead captured; qualification pending',v_metadata,v_actor,v_actor
  ) RETURNING * INTO v_opportunity;

  INSERT INTO public.audit_event(
    organization_id,business_unit_id,actor_user_id,event_type,entity_type,entity_id,
    source_system,after_state,metadata
  ) VALUES (
    p_organization_id,p_business_unit_id,v_actor,'lead_intake_captured','service_request',v_service_request.id,
    'serviceos_revenue',jsonb_build_object('service_request_id',v_service_request.id,'opportunity_id',v_opportunity.id),
    jsonb_build_object('external_source_system',v_source_system,'external_source_id',v_source_id,'partial_intake',true)
  );

  RETURN jsonb_build_object(
    'created', true,
    'duplicate_review_required', false,
    'dedup_reason', NULL,
    'service_request', to_jsonb(v_service_request),
    'opportunity', to_jsonb(v_opportunity)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_source_system IS NOT NULL AND v_source_id IS NOT NULL THEN
      SELECT * INTO v_existing_sr
      FROM public.service_request sr
      WHERE sr.organization_id=p_organization_id
        AND sr.business_unit_id=p_business_unit_id
        AND lower(COALESCE(sr.metadata->>'external_source_system',''))=v_source_system
        AND sr.metadata->>'external_source_id'=v_source_id
      ORDER BY sr.created_at ASC LIMIT 1;
      IF v_existing_sr.id IS NOT NULL THEN
        SELECT * INTO v_existing_opp FROM public.opportunity o
        WHERE o.organization_id=p_organization_id AND o.business_unit_id=p_business_unit_id
          AND o.service_request_id=v_existing_sr.id
        ORDER BY o.created_at ASC LIMIT 1;
        RETURN jsonb_build_object(
          'created',false,'duplicate_review_required',false,'dedup_reason','external_source_id',
          'service_request',to_jsonb(v_existing_sr),
          'opportunity',CASE WHEN v_existing_opp.id IS NULL THEN NULL ELSE to_jsonb(v_existing_opp) END
        );
      END IF;
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_inbound_lead(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,text,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inbound_lead(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,numeric,numeric,numeric,text,text,text,text,text,jsonb
) TO authenticated, service_role;

COMMIT;
