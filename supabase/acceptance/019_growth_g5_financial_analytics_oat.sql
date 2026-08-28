begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := 'f7400246-a791-47a1-a924-c2fab39b9f05';
  v_jur uuid := '7ce78825-e3ac-48f0-a18e-1ae72c160adb';
  v_sr uuid := '46afc42d-d17a-44cc-875f-5c7140adc039';
  v_opp uuid := 'f1657c84-2962-4b86-9e18-c268fcb2b76f';
  v_job uuid := 'fb2f3f6e-8b97-4045-9030-8c6424c3a8b2';
  v_invoice uuid := '1c086dc1-ef85-44b4-9eb5-256b37a4a633';
  p uuid := gen_random_uuid();
  h uuid := gen_random_uuid();
  v record;
  mismatch_blocked boolean := false;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,
    source_lane,city,country_code,company_name,segment,facility_type,service_need_summary,
    verification_status,risk_flags,missing_fields,metadata,captured_at
  ) values(
    p,v_org,v_bu,v_jur,'G5-OAT-019-FIN','handoff_ready','synthetic_g5_finance','Phoenix','US',
    'G5 Finance Synthetic','office','office','Synthetic finance lineage proof','verified','[]','[]',
    jsonb_build_object('synthetic',true,'oat','019'),'2026-08-01T00:00:00Z'
  );

  insert into growth.handoff_candidate(
    id,prospect_id,organization_id,business_unit_id,jurisdiction_id,status,trigger_type,
    qualification_evidence,handoff_payload,idempotency_key,serviceos_service_request_id,
    serviceos_opportunity_id,attempt_count,submitted_at,completed_at
  ) values(
    h,p,v_org,v_bu,v_jur,'succeeded','positive_reply',jsonb_build_object('synthetic',true),
    jsonb_build_object('synthetic',true),'G5-OAT-019-HANDOFF',v_sr,v_opp,1,
    '2026-08-02T00:00:00Z','2026-08-02T00:01:00Z'
  );

  select * into v from growth.prospect_financial_analytics_v1 where prospect_id=p;
  if v.operational_job_id <> v_job or v.invoice_request_id <> v_invoice then
    raise exception 'OAT019 canonical finance lineage did not resolve: %',row_to_json(v);
  end if;
  if v.invoice_currency_code <> 'CAD' or v.profitability_currency_code <> 'CAD' or v.currency_lineage_matches is not true then
    raise exception 'OAT019 matched currency lineage wrong: %',row_to_json(v);
  end if;

  select * into v
  from public.growth_g5_financial_summary(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_finance';
  if v.currency_code <> 'CAD' or v.invoiced_prospects <> 1 or v.invoice_total <> 300.00 or v.recognized_revenue <> 300.00 or v.gross_contribution <> 200.00 or v.currency_mismatch_records <> 0 then
    raise exception 'OAT019 matched financial summary wrong: %',row_to_json(v);
  end if;

  begin
    insert into public.job_profitability_snapshot(
      organization_id,business_unit_id,operational_job_id,invoice_request_id,currency_code,
      recognized_revenue_amount,tax_amount,direct_labor_cost,other_direct_cost,
      gross_margin_percent,source_lineage,snapshot_taken_at,metadata
    ) values(
      v_org,v_bu,v_job,v_invoice,'USD',999.00,0,100.00,0,0.8999,
      jsonb_build_object('synthetic',true,'oat','019'),'2026-08-28T23:59:00Z',jsonb_build_object('synthetic',true,'oat','019')
    );
  exception when others then
    if sqlerrm like '%currency_code USD does not match invoice_request.currency_code CAD%' then
      mismatch_blocked := true;
    else
      raise;
    end if;
  end;
  if not mismatch_blocked then
    raise exception 'OAT019 expected ServiceOS to reject cross-currency profitability snapshot';
  end if;

  select * into v
  from public.growth_g5_financial_summary(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
  where source_lane='synthetic_g5_finance';
  if v.currency_code <> 'CAD' or v.recognized_revenue <> 300.00 or v.gross_contribution <> 200.00 or v.currency_mismatch_records <> 0 then
    raise exception 'OAT019 rejected mismatch altered financial aggregation: %',row_to_json(v);
  end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then
    raise exception 'OAT019 execution gate unexpectedly enabled';
  end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key='G5-OAT-019-FIN') as persisted_prospects,
  (select count(*) from growth.handoff_candidate where idempotency_key='G5-OAT-019-HANDOFF') as persisted_handoffs,
  (select count(*) from public.job_profitability_snapshot where metadata->>'oat'='019') as persisted_profitability_snapshots,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
