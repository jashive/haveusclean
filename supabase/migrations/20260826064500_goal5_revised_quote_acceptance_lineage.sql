-- Goal 5 revised-quote acceptance hotfix
-- A governed quote revision keeps the same parent quote/opportunity but creates a new
-- estimate/pricing snapshot for the exact quote_version. The conversion guard must
-- therefore validate quote -> opportunity at the parent quote level and validate
-- estimate identity at the exact quote_version level.

BEGIN;

CREATE OR REPLACE FUNCTION public.conversion_record_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    opportunity_service_request uuid;
    estimate_opportunity uuid;
    quote_opportunity uuid;
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
    SELECT service_request_id
      INTO opportunity_service_request
      FROM public.opportunity
     WHERE id = NEW.opportunity_id
       AND organization_id = NEW.organization_id
       AND business_unit_id = NEW.business_unit_id;

    IF opportunity_service_request IS DISTINCT FROM NEW.service_request_id THEN
        RAISE EXCEPTION 'conversion_record opportunity/service_request mismatch';
    END IF;

    IF NEW.estimate_id IS NOT NULL THEN
        SELECT opportunity_id
          INTO estimate_opportunity
          FROM public.estimate
         WHERE id = NEW.estimate_id
           AND organization_id = NEW.organization_id
           AND business_unit_id = NEW.business_unit_id;

        IF estimate_opportunity IS DISTINCT FROM NEW.opportunity_id THEN
            RAISE EXCEPTION 'conversion_record estimate/opportunity mismatch';
        END IF;
    END IF;

    -- Parent quote lineage is quote -> opportunity. A revised quote_version may use a
    -- new estimate while retaining the same parent quote, so quote.estimate_id is not
    -- authoritative for revised-version conversion lineage.
    SELECT opportunity_id
      INTO quote_opportunity
      FROM public.quote
     WHERE id = NEW.quote_id
       AND organization_id = NEW.organization_id
       AND business_unit_id = NEW.business_unit_id;

    IF quote_opportunity IS DISTINCT FROM NEW.opportunity_id THEN
        RAISE EXCEPTION 'conversion_record quote chain mismatch';
    END IF;

    -- The exact quote_version remains authoritative for estimate and acceptance state.
    SELECT quote_id, estimate_id, lifecycle_status
      INTO version_quote, version_estimate, version_status
      FROM public.quote_version
     WHERE id = NEW.quote_version_id
       AND organization_id = NEW.organization_id
       AND business_unit_id = NEW.business_unit_id;

    IF version_quote IS DISTINCT FROM NEW.quote_id
       OR version_estimate IS DISTINCT FROM NEW.estimate_id
       OR version_status <> 'accepted' THEN
        RAISE EXCEPTION 'conversion_record requires exact accepted quote_version';
    END IF;

    SELECT quote_version_id, response_type
      INTO response_version, response_type_value
      FROM public.quote_response
     WHERE id = NEW.quote_response_id
       AND organization_id = NEW.organization_id
       AND business_unit_id = NEW.business_unit_id;

    IF response_version IS DISTINCT FROM NEW.quote_version_id
       OR response_type_value <> 'accepted' THEN
        RAISE EXCEPTION 'conversion_record requires accepted response for exact quote_version';
    END IF;

    SELECT organization_id, business_unit_id
      INTO customer_org, customer_bu
      FROM public.customer
     WHERE id = NEW.customer_id;

    IF customer_org IS DISTINCT FROM NEW.organization_id
       OR customer_bu IS DISTINCT FROM NEW.business_unit_id THEN
        RAISE EXCEPTION 'conversion_record customer scope mismatch';
    END IF;

    SELECT customer_id
      INTO contact_customer
      FROM public.contact
     WHERE id = NEW.contact_id;

    IF contact_customer IS DISTINCT FROM NEW.customer_id THEN
        RAISE EXCEPTION 'conversion_record contact/customer mismatch';
    END IF;

    SELECT customer_id, jurisdiction_id
      INTO location_customer, location_jurisdiction
      FROM public.service_location
     WHERE id = NEW.service_location_id;

    IF location_customer IS DISTINCT FROM NEW.customer_id THEN
        RAISE EXCEPTION 'conversion_record service_location/customer mismatch';
    END IF;

    SELECT jurisdiction_id
      INTO bu_jurisdiction
      FROM public.business_unit
     WHERE id = NEW.business_unit_id
       AND organization_id = NEW.organization_id;

    IF location_jurisdiction IS NOT NULL
       AND bu_jurisdiction IS NOT NULL
       AND location_jurisdiction IS DISTINCT FROM bu_jurisdiction THEN
        RAISE EXCEPTION 'conversion_record service_location jurisdiction mismatch';
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;
