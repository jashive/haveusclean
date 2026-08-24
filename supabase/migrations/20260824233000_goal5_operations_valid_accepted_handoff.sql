-- Goal 5.4 — Operations may consume only a ready handoff backed by an accepted Revenue chain.
-- Defense in depth: Revenue guards already require accepted quote_response and quote_version.
-- This strengthens the operational_job INSERT boundary so direct/manual inserts cannot bypass handoff readiness.

BEGIN;

CREATE OR REPLACE FUNCTION public.wave3_validate_oj_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_jh public.job_handoff%ROWTYPE;
  v_cr public.conversion_record%ROWTYPE;
  v_qr public.quote_response%ROWTYPE;
  v_qv public.quote_version%ROWTYPE;
  v_sl public.service_location%ROWTYPE;
BEGIN
  SELECT * INTO v_jh
  FROM public.job_handoff
  WHERE id = NEW.job_handoff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: job_handoff % not found', NEW.job_handoff_id;
  END IF;

  IF v_jh.handoff_status <> 'ready' THEN
    RAISE EXCEPTION 'operational_job: job_handoff must be ready; current status is %', v_jh.handoff_status;
  END IF;

  IF v_jh.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff organization_id mismatch';
  END IF;
  IF v_jh.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff business_unit_id mismatch';
  END IF;
  IF v_jh.conversion_record_id <> NEW.conversion_record_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.conversion_record_id mismatch';
  END IF;
  IF v_jh.quote_version_id <> NEW.quote_version_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.quote_version_id mismatch';
  END IF;
  IF v_jh.pricing_snapshot_id <> NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION 'operational_job: job_handoff.pricing_snapshot_id mismatch';
  END IF;

  SELECT * INTO v_cr
  FROM public.conversion_record
  WHERE id = NEW.conversion_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: conversion_record % not found', NEW.conversion_record_id;
  END IF;

  IF v_cr.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record organization_id mismatch';
  END IF;
  IF v_cr.business_unit_id <> NEW.business_unit_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record business_unit_id mismatch';
  END IF;
  IF v_cr.quote_version_id <> NEW.quote_version_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.quote_version_id mismatch';
  END IF;
  IF v_cr.customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.customer_id mismatch';
  END IF;
  IF v_cr.contact_id <> NEW.contact_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.contact_id mismatch';
  END IF;
  IF v_cr.service_location_id <> NEW.service_location_id THEN
    RAISE EXCEPTION 'operational_job: conversion_record.service_location_id mismatch';
  END IF;

  SELECT * INTO v_qr
  FROM public.quote_response
  WHERE id = v_cr.quote_response_id
    AND organization_id = NEW.organization_id
    AND business_unit_id = NEW.business_unit_id;

  IF NOT FOUND OR v_qr.quote_version_id <> NEW.quote_version_id OR v_qr.response_type <> 'accepted' THEN
    RAISE EXCEPTION 'operational_job: accepted quote_response for exact quote_version is required';
  END IF;

  SELECT * INTO v_qv
  FROM public.quote_version
  WHERE id = NEW.quote_version_id
    AND organization_id = NEW.organization_id
    AND business_unit_id = NEW.business_unit_id;

  IF NOT FOUND OR v_qv.lifecycle_status <> 'accepted' THEN
    RAISE EXCEPTION 'operational_job: accepted quote_version is required';
  END IF;
  IF v_qv.pricing_snapshot_id <> NEW.pricing_snapshot_id THEN
    RAISE EXCEPTION 'operational_job: quote_version.pricing_snapshot_id mismatch';
  END IF;

  SELECT * INTO v_sl
  FROM public.service_location
  WHERE id = NEW.service_location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'operational_job: service_location % not found', NEW.service_location_id;
  END IF;
  IF v_sl.customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'operational_job: service_location.customer_id mismatch';
  END IF;
  IF v_sl.jurisdiction_id <> NEW.jurisdiction_id THEN
    RAISE EXCEPTION 'operational_job: service_location.jurisdiction_id mismatch';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
