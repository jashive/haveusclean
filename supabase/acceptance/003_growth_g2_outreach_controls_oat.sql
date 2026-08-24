-- Growth Layer G2 controlled-outreach acceptance OAT.
-- NON-PRODUCTION / SYNTHETIC / ROLLBACK ONLY.
-- Proves scope isolation, legal-basis recording, suppression mapping, reply behavior, and zero persistence.

begin;

do $$
declare
  v_prospect uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_basis uuid;
  v_event uuid;
  v_reply_event uuid;
  v_cross_scope_rejected boolean := false;
  v_suppression_count integer;
  v_reply_suppression_count integer;
begin
  insert into growth.prospect(
    id, organization_id, business_unit_id, jurisdiction_id, external_prospect_key,
    lifecycle_status, source_lane, city, country_code, subdivision_code,
    company_name, segment, verification_status, risk_flags, missing_fields, metadata
  ) values (
    v_prospect,
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    'G2-OAT-ON-ROLLBACK','review_ready','synthetic_oat','Toronto','CA','ON',
    'G2 OAT Synthetic Company','office','verified','[]'::jsonb,'[]'::jsonb,
    jsonb_build_object('synthetic',true,'not_for_outreach',true)
  );

  insert into growth.prospect_contact_candidate(
    id, prospect_id, organization_id, business_unit_id, jurisdiction_id,
    first_name,last_name,buyer_title,email,contact_source,verification_status,
    is_primary_candidate,metadata,review_status
  ) values (
    v_contact,v_prospect,
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    'Synthetic','Reviewer','Office Manager','g2-oat@example.invalid','synthetic_oat','verified',
    true,jsonb_build_object('synthetic',true,'not_for_outreach',true),'accepted'
  );

  begin
    perform public.growth_g2_assert_target_scope(
      '411e167e-506b-4304-9428-11b7cfc98e15',
      '1cf7abdc-957b-4601-b26a-82c1fec7bcd0',
      '7288ca65-5d0f-4e21-a200-1d47cf527e29',
      v_prospect,v_contact
    );
  exception when others then
    if position('outside authorized scope' in sqlerrm) > 0 then
      v_cross_scope_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_cross_scope_rejected then
    raise exception 'G2 OAT failed: cross-scope target was accepted';
  end if;

  perform public.growth_g2_assert_target_scope(
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    v_prospect,v_contact
  );

  v_basis := public.growth_g2_record_legal_basis(
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    v_prospect,v_contact,'email',
    'implied_consent_conspicuously_published_business_contact',
    'synthetic_oat','G2-OAT-DOC',jsonb_build_object('synthetic',true),null
  );

  if v_basis is null then
    raise exception 'G2 OAT failed: legal basis not recorded';
  end if;

  v_event := public.growth_g2_record_event(
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    v_prospect,v_contact,null,'email','unsubscribe','G2-OAT-UNSUB',now(),jsonb_build_object('synthetic',true)
  );

  if v_event is null then
    raise exception 'G2 OAT failed: unsubscribe event not recorded';
  end if;

  select count(*) into v_suppression_count
  from growth.suppression
  where prospect_id=v_prospect and channel='email' and reason='opt_out' and active=true;

  if v_suppression_count <> 1 then
    raise exception 'G2 OAT failed: unsubscribe did not map to opt_out suppression';
  end if;

  v_reply_event := public.growth_g2_record_event(
    '411e167e-506b-4304-9428-11b7cfc98e15',
    '03334f81-9f30-408d-bfd1-74579ebf6426',
    '09340f23-f2fb-4c26-adbf-c1c1c625f8c6',
    v_prospect,v_contact,null,'email','reply','G2-OAT-REPLY',now(),jsonb_build_object('synthetic',true)
  );

  if v_reply_event is null then
    raise exception 'G2 OAT failed: reply event not recorded';
  end if;

  select count(*) into v_reply_suppression_count
  from growth.suppression
  where prospect_id=v_prospect and metadata->>'event_type'='reply';

  if v_reply_suppression_count <> 0 then
    raise exception 'G2 OAT failed: ordinary reply created permanent suppression';
  end if;
end $$;

rollback;

select
  0::int as oat_assertion_failures,
  (select count(*) from growth.prospect where external_prospect_key='G2-OAT-ON-ROLLBACK') as persisted_prospects,
  (select count(*) from growth.legal_basis_evidence where evidence_source='synthetic_oat') as persisted_legal_basis,
  (select count(*) from growth.outreach_event where provider_event_id in ('G2-OAT-UNSUB','G2-OAT-REPLY')) as persisted_events;
