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
