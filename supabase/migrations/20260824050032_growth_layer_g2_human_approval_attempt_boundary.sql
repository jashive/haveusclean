-- Growth Layer G2: guarded human approval and non-sending attempt creation.
-- Acceptance-first. This migration does not integrate a sender and does not enable any Growth gate.

create unique index if not exists outreach_attempt_one_per_approval_uidx
  on growth.outreach_attempt(outreach_approval_id);

create or replace function public.growth_g2_review_legal_basis(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_prospect_id uuid,
  p_contact_candidate_id uuid,
  p_legal_basis_evidence_id uuid,
  p_decision text,
  p_reviewer_app_user_id uuid,
  p_review_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform public.growth_g2_assert_target_scope(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id
  );
  if p_reviewer_app_user_id is null then raise exception 'growth_g2: reviewer required'; end if;
  if p_decision not in ('accepted','rejected','revoked','expired') then
    raise exception 'growth_g2: unsupported legal-basis decision';
  end if;

  select e.evidence_status into v_status
  from growth.legal_basis_evidence e
  where e.id=p_legal_basis_evidence_id
    and e.organization_id=p_organization_id
    and e.business_unit_id=p_business_unit_id
    and e.jurisdiction_id=p_jurisdiction_id
    and e.prospect_id=p_prospect_id
    and e.contact_candidate_id=p_contact_candidate_id
    and e.channel='email'
  for update;

  if v_status is null then raise exception 'growth_g2: legal basis outside authorized target'; end if;
  if p_decision in ('accepted','rejected') and v_status <> 'pending' then
    raise exception 'growth_g2: legal basis review requires pending status';
  end if;
  if p_decision='revoked' and v_status <> 'accepted' then
    raise exception 'growth_g2: only accepted legal basis may be revoked';
  end if;
  if p_decision='expired' and v_status not in ('pending','accepted') then
    raise exception 'growth_g2: legal basis cannot expire from current status';
  end if;

  update growth.legal_basis_evidence
  set evidence_status=p_decision,
      reviewed_by_app_user_id=p_reviewer_app_user_id,
      reviewed_at=now(),
      updated_at=now(),
      evidence_payload=evidence_payload || jsonb_build_object('review_note',p_review_note)
  where id=p_legal_basis_evidence_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_legal_basis_reviewed','growth_g2',
    jsonb_build_object('legal_basis_evidence_id',p_legal_basis_evidence_id,'decision',p_decision,'reviewer_app_user_id',p_reviewer_app_user_id));
end;
$$;

create or replace function public.growth_g2_create_approval_request(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_prospect_id uuid,
  p_contact_candidate_id uuid,
  p_legal_basis_evidence_id uuid,
  p_subject text,
  p_body text,
  p_sender_identity text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  perform public.growth_g2_assert_target_scope(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id
  );
  if nullif(btrim(coalesce(p_subject,'')),'') is null then raise exception 'growth_g2: subject required'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null then raise exception 'growth_g2: body required'; end if;
  if nullif(btrim(coalesce(p_sender_identity,'')),'') is null then raise exception 'growth_g2: sender identity required'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'growth_g2: idempotency key required'; end if;

  if not exists(
    select 1 from growth.legal_basis_evidence e
    where e.id=p_legal_basis_evidence_id
      and e.organization_id=p_organization_id
      and e.business_unit_id=p_business_unit_id
      and e.jurisdiction_id=p_jurisdiction_id
      and e.prospect_id=p_prospect_id
      and e.contact_candidate_id=p_contact_candidate_id
      and e.channel='email'
  ) then raise exception 'growth_g2: legal basis outside authorized target'; end if;

  select a.id into v_existing from growth.outreach_approval a where a.idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  insert into growth.outreach_approval(
    organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    legal_basis_evidence_id,channel,approval_status,approved_subject,approved_body,
    approved_sender_identity,idempotency_key,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,
    p_legal_basis_evidence_id,'email','pending',btrim(p_subject),btrim(p_body),btrim(p_sender_identity),
    p_idempotency_key,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_approval_requested','growth_g2',
    jsonb_build_object('outreach_approval_id',v_id,'contact_candidate_id',p_contact_candidate_id,'channel','email'));
  return v_id;
end;
$$;

create or replace function public.growth_g2_review_outreach_approval(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_prospect_id uuid,
  p_contact_candidate_id uuid,
  p_outreach_approval_id uuid,
  p_decision text,
  p_reviewer_app_user_id uuid,
  p_postal_address_confirmed boolean default false,
  p_unsubscribe_mechanism_confirmed boolean default false,
  p_expires_at timestamptz default null,
  p_review_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval growth.outreach_approval%rowtype;
  v_basis growth.legal_basis_evidence%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_country text;
  v_subdivision text;
begin
  perform public.growth_g2_assert_target_scope(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id
  );
  if p_reviewer_app_user_id is null then raise exception 'growth_g2: reviewer required'; end if;
  if p_decision not in ('approved','rejected','revoked','expired') then raise exception 'growth_g2: unsupported approval decision'; end if;

  select * into v_approval from growth.outreach_approval a
  where a.id=p_outreach_approval_id
    and a.organization_id=p_organization_id
    and a.business_unit_id=p_business_unit_id
    and a.jurisdiction_id=p_jurisdiction_id
    and a.prospect_id=p_prospect_id
    and a.contact_candidate_id=p_contact_candidate_id
  for update;
  if v_approval.id is null then raise exception 'growth_g2: approval outside authorized target'; end if;

  if p_decision in ('approved','rejected') and v_approval.approval_status <> 'pending' then
    raise exception 'growth_g2: approval review requires pending status';
  end if;
  if p_decision='revoked' and v_approval.approval_status <> 'approved' then
    raise exception 'growth_g2: only approved outreach may be revoked';
  end if;
  if p_decision='expired' and v_approval.approval_status not in ('pending','approved') then
    raise exception 'growth_g2: approval cannot expire from current status';
  end if;

  if p_decision='approved' then
    if v_approval.channel <> 'email' then raise exception 'growth_g2: only email approval is authorized'; end if;
    if nullif(btrim(coalesce(v_approval.approved_subject,'')),'') is null
       or nullif(btrim(coalesce(v_approval.approved_body,'')),'') is null
       or nullif(btrim(coalesce(v_approval.approved_sender_identity,'')),'') is null then
      raise exception 'growth_g2: approved content and sender identity required';
    end if;
    if not coalesce(p_postal_address_confirmed,false) then raise exception 'growth_g2: postal address confirmation required'; end if;
    if not coalesce(p_unsubscribe_mechanism_confirmed,false) then raise exception 'growth_g2: unsubscribe mechanism confirmation required'; end if;
    if p_expires_at is null or p_expires_at <= now() then raise exception 'growth_g2: future approval expiry required'; end if;

    select * into v_contact from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id;
    if v_contact.verification_status <> 'verified' or v_contact.review_status <> 'accepted' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then
      raise exception 'growth_g2: verified accepted email contact required';
    end if;

    select p.country_code,p.subdivision_code into v_country,v_subdivision from growth.prospect p where p.id=p_prospect_id;
    if not ((v_country='CA' and v_subdivision='ON') or (v_country='US' and v_subdivision='AZ')) then
      raise exception 'growth_g2: unsupported jurisdiction';
    end if;

    select * into v_basis from growth.legal_basis_evidence e where e.id=v_approval.legal_basis_evidence_id;
    if v_basis.id is null
       or v_basis.organization_id<>p_organization_id
       or v_basis.business_unit_id<>p_business_unit_id
       or v_basis.jurisdiction_id<>p_jurisdiction_id
       or v_basis.prospect_id<>p_prospect_id
       or v_basis.contact_candidate_id<>p_contact_candidate_id
       or v_basis.channel<>'email'
       or v_basis.evidence_status<>'accepted'
       or v_basis.valid_from>now()
       or (v_basis.valid_until is not null and v_basis.valid_until<=now()) then
      raise exception 'growth_g2: accepted current legal basis required';
    end if;
    if v_country='CA' and v_subdivision='ON' and v_basis.basis_type='can_spam_commercial_email' then
      raise exception 'growth_g2: CAN-SPAM basis does not satisfy Ontario CASL control';
    end if;
  end if;

  update growth.outreach_approval
  set approval_status=p_decision,
      approved_by_app_user_id=p_reviewer_app_user_id,
      approved_at=case when p_decision='approved' then now() else approved_at end,
      expires_at=case when p_decision='approved' then p_expires_at else expires_at end,
      metadata=metadata || jsonb_build_object(
        'postal_address_confirmed',coalesce(p_postal_address_confirmed,false),
        'unsubscribe_mechanism_confirmed',coalesce(p_unsubscribe_mechanism_confirmed,false),
        'review_note',p_review_note
      ),
      updated_at=now()
  where id=p_outreach_approval_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_outreach_approval_reviewed','growth_g2',
    jsonb_build_object('outreach_approval_id',p_outreach_approval_id,'decision',p_decision,'reviewer_app_user_id',p_reviewer_app_user_id));
end;
$$;

create or replace function public.growth_g2_create_non_sending_attempt(
  p_organization_id uuid,
  p_business_unit_id uuid,
  p_jurisdiction_id uuid,
  p_prospect_id uuid,
  p_contact_candidate_id uuid,
  p_outreach_approval_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval growth.outreach_approval%rowtype;
  v_basis growth.legal_basis_evidence%rowtype;
  v_contact growth.prospect_contact_candidate%rowtype;
  v_country text;
  v_subdivision text;
  v_email text;
  v_attempt_id uuid;
  v_recent_attempts integer;
  v_month_attempts integer;
begin
  perform public.growth_g2_assert_target_scope(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id
  );

  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then
    raise exception 'growth_g2: growth layer disabled';
  end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then
    raise exception 'growth_g2: outreach gate disabled';
  end if;

  select * into v_approval from growth.outreach_approval a
  where a.id=p_outreach_approval_id
    and a.organization_id=p_organization_id
    and a.business_unit_id=p_business_unit_id
    and a.jurisdiction_id=p_jurisdiction_id
    and a.prospect_id=p_prospect_id
    and a.contact_candidate_id=p_contact_candidate_id;
  if v_approval.id is null then raise exception 'growth_g2: approval outside authorized target'; end if;
  if v_approval.channel<>'email' or v_approval.approval_status<>'approved'
     or v_approval.approved_by_app_user_id is null or v_approval.approved_at is null
     or v_approval.expires_at is null or v_approval.expires_at<=now() then
    raise exception 'growth_g2: current human approval required';
  end if;
  if coalesce((v_approval.metadata->>'postal_address_confirmed')::boolean,false) is not true then
    raise exception 'growth_g2: postal address confirmation missing';
  end if;
  if coalesce((v_approval.metadata->>'unsubscribe_mechanism_confirmed')::boolean,false) is not true then
    raise exception 'growth_g2: unsubscribe mechanism confirmation missing';
  end if;
  if nullif(btrim(coalesce(v_approval.approved_sender_identity,'')),'') is null then
    raise exception 'growth_g2: sender identity missing';
  end if;

  select * into v_contact from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id;
  if v_contact.verification_status<>'verified' or v_contact.review_status<>'accepted' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then
    raise exception 'growth_g2: verified accepted email contact required';
  end if;
  v_email := lower(btrim(v_contact.email));

  select p.country_code,p.subdivision_code into v_country,v_subdivision from growth.prospect p where p.id=p_prospect_id;
  if not ((v_country='CA' and v_subdivision='ON') or (v_country='US' and v_subdivision='AZ')) then
    raise exception 'growth_g2: unsupported jurisdiction';
  end if;

  select * into v_basis from growth.legal_basis_evidence e where e.id=v_approval.legal_basis_evidence_id;
  if v_basis.id is null
     or v_basis.organization_id<>p_organization_id
     or v_basis.business_unit_id<>p_business_unit_id
     or v_basis.jurisdiction_id<>p_jurisdiction_id
     or v_basis.prospect_id<>p_prospect_id
     or v_basis.contact_candidate_id<>p_contact_candidate_id
     or v_basis.channel<>'email'
     or v_basis.evidence_status<>'accepted'
     or v_basis.valid_from>now()
     or (v_basis.valid_until is not null and v_basis.valid_until<=now()) then
    raise exception 'growth_g2: accepted current legal basis required';
  end if;
  if v_country='CA' and v_subdivision='ON' and v_basis.basis_type='can_spam_commercial_email' then
    raise exception 'growth_g2: CAN-SPAM basis does not satisfy Ontario CASL control';
  end if;

  if exists(
    select 1 from growth.suppression s
    where s.organization_id=p_organization_id
      and s.jurisdiction_id=p_jurisdiction_id
      and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now())
      and s.channel in ('all','email')
      and (s.prospect_id=p_prospect_id or (s.identity_type='email' and s.identity_value_normalized=v_email))
  ) then raise exception 'growth_g2: active suppression blocks outreach'; end if;

  if exists(
    select 1 from growth.outreach_event e
    where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id
      and e.prospect_id=p_prospect_id and e.contact_candidate_id=p_contact_candidate_id and e.channel='email' and e.event_type='reply'
  ) then raise exception 'growth_g2: reply received; sequencing stopped'; end if;

  select count(*) into v_recent_attempts from growth.outreach_attempt a
  where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id
    and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email'
    and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '72 hours';
  if v_recent_attempts>0 then raise exception 'growth_g2: cooldown active'; end if;

  select count(*) into v_month_attempts from growth.outreach_attempt a
  where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id
    and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email'
    and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '30 days';
  if v_month_attempts>=3 then raise exception 'growth_g2: frequency cap exceeded'; end if;

  if exists(select 1 from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id) then
    select a.id into v_attempt_id from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id;
    return v_attempt_id;
  end if;

  insert into growth.outreach_attempt(
    organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,
    outreach_approval_id,channel,provider,provider_message_id,attempt_status,submitted_at,metadata
  ) values(
    p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,
    p_outreach_approval_id,'email',null,null,'created',null,
    jsonb_build_object('non_sending',true,'policy_version','g2-attempt-boundary-2026-08-23','cooldown_hours',72,'monthly_cap',3)
  ) returning id into v_attempt_id;

  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_non_sending_attempt_created','growth_g2',
    jsonb_build_object('outreach_attempt_id',v_attempt_id,'outreach_approval_id',p_outreach_approval_id,'channel','email'));
  return v_attempt_id;
end;
$$;

revoke execute on function public.growth_g2_review_legal_basis(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.growth_g2_create_approval_request(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.growth_g2_review_outreach_approval(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,boolean,boolean,timestamptz,text) from public, anon, authenticated;
revoke execute on function public.growth_g2_create_non_sending_attempt(uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.growth_g2_review_legal_basis(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.growth_g2_create_approval_request(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.growth_g2_review_outreach_approval(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,boolean,boolean,timestamptz,text) to service_role;
grant execute on function public.growth_g2_create_non_sending_attempt(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
