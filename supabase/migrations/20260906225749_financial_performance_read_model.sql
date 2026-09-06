-- OS 1.0 Financial Performance: territory-isolated, Owner/Admin read model.
-- Monetary authority remains the accepted pricing, payable, and append-only
-- profitability ledgers. This migration creates no writable financial surface.

CREATE INDEX IF NOT EXISTS idx_quote_response_scope_accepted_at
  ON public.quote_response (organization_id, business_unit_id, responded_at DESC)
  WHERE response_type = 'accepted';

CREATE INDEX IF NOT EXISTS idx_contractor_payable_scope_approved_at
  ON public.contractor_payable (organization_id, business_unit_id, approved_at DESC)
  WHERE payable_status IN ('approved', 'paid');

CREATE INDEX IF NOT EXISTS idx_jps_scope_taken_job
  ON public.job_profitability_snapshot
  (organization_id, business_unit_id, snapshot_taken_at DESC, operational_job_id);

CREATE OR REPLACE FUNCTION public.get_financial_performance(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_market_code text;
  v_currency text;
  v_gross_bookings numeric := 0;
  v_cleaner_payouts numeric := 0;
  v_recognized_revenue numeric := 0;
  v_net_contribution numeric := 0;
  v_jobs_count integer := 0;
  v_jobs jsonb := '[]'::jsonb;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_end <= p_period_start
     OR p_period_end - p_period_start > interval '370 days' THEN
    RAISE EXCEPTION 'Financial performance period must be greater than zero and no longer than 370 days';
  END IF;

  SELECT code INTO v_market_code
    FROM public.business_unit
   WHERE id = p_business_unit_id
     AND organization_id = p_organization_id
     AND status = 'active';

  v_currency := CASE v_market_code WHEN 'HUC-ON' THEN 'CAD' WHEN 'HUC-AZ' THEN 'USD' ELSE NULL END;
  IF v_currency IS NULL THEN RAISE EXCEPTION 'Unsupported financial performance business unit'; END IF;
  IF NOT public.has_bu_role(p_organization_id, p_business_unit_id, ARRAY['owner_admin']::text[]) THEN
    RAISE EXCEPTION 'Financial performance requires Owner/Admin access';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quote_response qr
    JOIN public.quote_version qv ON qv.id = qr.quote_version_id AND qv.organization_id = qr.organization_id AND qv.business_unit_id = qr.business_unit_id
    JOIN public.pricing_snapshot ps ON ps.id = qv.pricing_snapshot_id
    WHERE qr.organization_id = p_organization_id AND qr.business_unit_id = p_business_unit_id
      AND qr.response_type = 'accepted' AND qr.responded_at >= p_period_start AND qr.responded_at < p_period_end
      AND ps.currency_code <> v_currency
  ) OR EXISTS (
    SELECT 1 FROM public.contractor_payable cp
    WHERE cp.organization_id = p_organization_id AND cp.business_unit_id = p_business_unit_id
      AND cp.payable_status IN ('approved','paid') AND cp.approved_at >= p_period_start AND cp.approved_at < p_period_end
      AND cp.currency_code <> v_currency
  ) OR EXISTS (
    SELECT 1 FROM public.job_profitability_snapshot jps
    WHERE jps.organization_id = p_organization_id AND jps.business_unit_id = p_business_unit_id
      AND jps.snapshot_taken_at >= p_period_start AND jps.snapshot_taken_at < p_period_end
      AND jps.currency_code <> v_currency
  ) THEN
    RAISE EXCEPTION 'Financial ledger currency does not match the selected territory';
  END IF;

  WITH accepted_quotes AS (
    SELECT DISTINCT ON (qv.quote_id) qv.quote_id, ps.subtotal_amount
      FROM public.quote_response qr
      JOIN public.quote_version qv ON qv.id = qr.quote_version_id AND qv.organization_id = qr.organization_id AND qv.business_unit_id = qr.business_unit_id
      JOIN public.pricing_snapshot ps ON ps.id = qv.pricing_snapshot_id
     WHERE qr.organization_id = p_organization_id AND qr.business_unit_id = p_business_unit_id
       AND qr.response_type = 'accepted' AND qr.responded_at >= p_period_start AND qr.responded_at < p_period_end
     ORDER BY qv.quote_id, qr.responded_at DESC, qr.id DESC
  ) SELECT COALESCE(sum(subtotal_amount), 0) INTO v_gross_bookings FROM accepted_quotes;

  SELECT COALESCE(sum(computed_amount), 0) INTO v_cleaner_payouts
    FROM public.contractor_payable
   WHERE organization_id = p_organization_id AND business_unit_id = p_business_unit_id
     AND payable_status IN ('approved','paid') AND approved_at >= p_period_start AND approved_at < p_period_end;

  WITH latest AS (
    SELECT DISTINCT ON (jps.operational_job_id)
      jps.id, jps.operational_job_id, jps.snapshot_taken_at,
      jps.recognized_revenue_amount, jps.direct_labor_cost, jps.other_direct_cost,
      jps.gross_contribution, jps.gross_margin_percent, qv.title
    FROM public.job_profitability_snapshot jps
    LEFT JOIN public.operational_job oj ON oj.id = jps.operational_job_id
    LEFT JOIN public.quote_version qv ON qv.id = oj.quote_version_id
    WHERE jps.organization_id = p_organization_id AND jps.business_unit_id = p_business_unit_id
      AND jps.snapshot_taken_at >= p_period_start AND jps.snapshot_taken_at < p_period_end
    ORDER BY jps.operational_job_id, jps.snapshot_taken_at DESC, jps.id DESC
  ), totals AS (
    SELECT count(*)::integer AS jobs_count,
      COALESCE(sum(recognized_revenue_amount),0) AS recognized_revenue,
      COALESCE(sum(gross_contribution),0) AS net_contribution
    FROM latest
  ), job_rows AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'snapshot_id', id, 'operational_job_id', operational_job_id,
      'job_label', COALESCE(NULLIF(title,''), 'Completed service'), 'snapshot_taken_at', snapshot_taken_at,
      'recognized_revenue', recognized_revenue_amount, 'cleaner_cost', direct_labor_cost,
      'other_direct_cost', other_direct_cost, 'net_contribution', gross_contribution,
      'contribution_margin_percent', gross_margin_percent
    ) ORDER BY snapshot_taken_at DESC), '[]'::jsonb) AS jobs
    FROM (SELECT * FROM latest ORDER BY snapshot_taken_at DESC LIMIT 100) compact
  )
  SELECT totals.jobs_count, totals.recognized_revenue, totals.net_contribution, job_rows.jobs
    INTO v_jobs_count, v_recognized_revenue, v_net_contribution, v_jobs
    FROM totals CROSS JOIN job_rows;

  RETURN jsonb_build_object(
    'scope', jsonb_build_object('market_code', v_market_code, 'currency_code', v_currency, 'period_start', p_period_start, 'period_end', p_period_end),
    'kpis', jsonb_build_object(
      'gross_bookings', v_gross_bookings, 'cleaner_payouts', v_cleaner_payouts,
      'net_contribution', v_net_contribution,
      'contribution_margin_percent', CASE WHEN v_recognized_revenue = 0 THEN NULL ELSE round((v_net_contribution / v_recognized_revenue) * 100, 2) END
    ),
    'unit_economics', jsonb_build_object(
      'jobs_count', v_jobs_count,
      'recognized_revenue_per_job', CASE WHEN v_jobs_count = 0 THEN NULL ELSE round(v_recognized_revenue / v_jobs_count, 2) END,
      'net_contribution_per_job', CASE WHEN v_jobs_count = 0 THEN NULL ELSE round(v_net_contribution / v_jobs_count, 2) END
    ),
    'jobs', v_jobs,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_performance(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_performance(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_financial_performance(uuid, uuid, timestamptz, timestamptz) IS
  'Owner/Admin-only, RLS-respecting territory financial performance read model. Never mixes currencies or recalculates ledger authority.';
