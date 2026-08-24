alter table growth.outreach_attempt
  add column if not exists sender_identity_id uuid references growth.sender_identity(id) on delete restrict;

alter table growth.outreach_attempt
  alter column sender_identity_id set not null;

alter table growth.outreach_event
  add column if not exists provider text,
  add column if not exists provider_message_id text;

alter table growth.outreach_event drop constraint if exists outreach_event_provider_event_id_key;
create unique index if not exists outreach_event_provider_event_uidx
  on growth.outreach_event(provider,provider_event_id)
  where provider is not null and provider_event_id is not null;
create index if not exists outreach_attempt_sender_created_idx
  on growth.outreach_attempt(sender_identity_id,created_at desc);
create index if not exists outreach_event_attempt_occurred_idx
  on growth.outreach_event(outreach_attempt_id,occurred_at desc);

create or replace function public.growth_g2_outreach_event_immutable_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'growth_g2: outreach events are immutable';
end;
$$;

drop trigger if exists trg_growth_g2_outreach_event_immutable on growth.outreach_event;
create trigger trg_growth_g2_outreach_event_immutable
before update or delete on growth.outreach_event
for each row execute function public.growth_g2_outreach_event_immutable_guard();

create or replace function public.growth_g2_outreach_attempt_identity_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.business_unit_id is distinct from old.business_unit_id
     or new.jurisdiction_id is distinct from old.jurisdiction_id
     or new.prospect_id is distinct from old.prospect_id
     or new.contact_candidate_id is distinct from old.contact_candidate_id
     or new.outreach_approval_id is distinct from old.outreach_approval_id
     or new.sender_identity_id is distinct from old.sender_identity_id
     or new.channel is distinct from old.channel then
    raise exception 'growth_g2: outreach attempt identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_growth_g2_outreach_attempt_identity on growth.outreach_attempt;
create trigger trg_growth_g2_outreach_attempt_identity
before update on growth.outreach_attempt
for each row execute function public.growth_g2_outreach_attempt_identity_guard();

create or replace function public.growth_g2_create_non_sending_attempt(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,p_outreach_approval_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
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
  v_sender_ready jsonb;
  v_sender_identity_id uuid;
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_layer_enabled' and g.enabled=true) then raise exception 'growth_g2: growth layer disabled'; end if;
  if not exists(select 1 from growth.feature_gate g where g.gate_code='growth_outreach_enabled' and g.enabled=true) then raise exception 'growth_g2: outreach gate disabled'; end if;
  select * into v_approval from growth.outreach_approval a where a.id=p_outreach_approval_id and a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id;
  if v_approval.id is null then raise exception 'growth_g2: approval outside authorized target'; end if;
  if v_approval.channel<>'email' or v_approval.approval_status<>'approved' or v_approval.approved_by_app_user_id is null or v_approval.approved_at is null or v_approval.expires_at is null or v_approval.expires_at<=now() then raise exception 'growth_g2: current human approval required'; end if;
  if coalesce((v_approval.metadata->>'postal_address_confirmed')::boolean,false) is not true then raise exception 'growth_g2: postal address confirmation missing'; end if;
  if coalesce((v_approval.metadata->>'unsubscribe_mechanism_confirmed')::boolean,false) is not true then raise exception 'growth_g2: unsubscribe mechanism confirmation missing'; end if;
  if nullif(btrim(coalesce(v_approval.approved_sender_identity,'')),'') is null then raise exception 'growth_g2: sender identity missing'; end if;
  v_sender_ready:=public.growth_g2_evaluate_sender_readiness(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_approval.approved_sender_identity);
  if coalesce((v_sender_ready->>'ready')::boolean,false) is not true then raise exception 'growth_g2: sender readiness blocked: %',v_sender_ready->'blocking_reasons'; end if;
  v_sender_identity_id := nullif(v_sender_ready->>'sender_identity_id','')::uuid;
  if v_sender_identity_id is null then raise exception 'growth_g2: sender identity linkage missing'; end if;
  select * into v_contact from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id;
  if v_contact.verification_status<>'verified' or v_contact.review_status<>'accepted' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then raise exception 'growth_g2: verified accepted email contact required'; end if;
  v_email:=lower(btrim(v_contact.email));
  select p.country_code,p.subdivision_code into v_country,v_subdivision from growth.prospect p where p.id=p_prospect_id;
  if not ((v_country='CA' and v_subdivision='ON') or (v_country='US' and v_subdivision='AZ')) then raise exception 'growth_g2: unsupported jurisdiction'; end if;
  select * into v_basis from growth.legal_basis_evidence e where e.id=v_approval.legal_basis_evidence_id;
  if v_basis.id is null or v_basis.organization_id<>p_organization_id or v_basis.business_unit_id<>p_business_unit_id or v_basis.jurisdiction_id<>p_jurisdiction_id or v_basis.prospect_id<>p_prospect_id or v_basis.contact_candidate_id<>p_contact_candidate_id or v_basis.channel<>'email' or v_basis.evidence_status<>'accepted' or v_basis.valid_from>now() or (v_basis.valid_until is not null and v_basis.valid_until<=now()) then raise exception 'growth_g2: accepted current legal basis required'; end if;
  if v_country='CA' and v_subdivision='ON' and v_basis.basis_type='can_spam_commercial_email' then raise exception 'growth_g2: CAN-SPAM basis does not satisfy Ontario CASL control'; end if;
  if exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email') and (s.prospect_id=p_prospect_id or (s.identity_type='email' and s.identity_value_normalized=v_email))) then raise exception 'growth_g2: active suppression blocks outreach'; end if;
  if exists(select 1 from growth.outreach_event e where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id and e.prospect_id=p_prospect_id and e.contact_candidate_id=p_contact_candidate_id and e.channel='email' and e.event_type='reply') then raise exception 'growth_g2: reply received; sequencing stopped'; end if;
  select count(*) into v_recent_attempts from growth.outreach_attempt a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email' and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '72 hours';
  if v_recent_attempts>0 then raise exception 'growth_g2: cooldown active'; end if;
  select count(*) into v_month_attempts from growth.outreach_attempt a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email' and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '30 days';
  if v_month_attempts>=3 then raise exception 'growth_g2: frequency cap exceeded'; end if;
  if exists(select 1 from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id) then select a.id into v_attempt_id from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id; return v_attempt_id; end if;
  insert into growth.outreach_attempt(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_approval_id,sender_identity_id,channel,provider,provider_message_id,attempt_status,submitted_at,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_approval_id,v_sender_identity_id,'email',null,null,'created',null,jsonb_build_object('non_sending',true,'policy_version','g2-attempt-boundary-2026-08-23','cooldown_hours',72,'monthly_cap',3,'sender_readiness_policy','g2-sender-readiness-2026-08-23')) returning id into v_attempt_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_non_sending_attempt_created','growth_g2',jsonb_build_object('outreach_attempt_id',v_attempt_id,'outreach_approval_id',p_outreach_approval_id,'sender_identity_id',v_sender_identity_id,'channel','email'));
  return v_attempt_id;
end;
$$;

create or replace function public.growth_g2_ingest_delivery_event(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_outreach_attempt_id uuid,
  p_provider text,p_provider_message_id text,p_provider_event_id text,p_event_type text,p_occurred_at timestamptz,p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_attempt growth.outreach_attempt%rowtype;
  v_existing growth.outreach_event%rowtype;
  v_event_id uuid;
  v_suppression_reason text;
  v_email text;
begin
  if nullif(btrim(coalesce(p_provider,'')),'') is null then raise exception 'growth_g2: provider required'; end if;
  if nullif(btrim(coalesce(p_provider_message_id,'')),'') is null then raise exception 'growth_g2: provider message id required'; end if;
  if nullif(btrim(coalesce(p_provider_event_id,'')),'') is null then raise exception 'growth_g2: provider event id required'; end if;
  if p_event_type not in ('submitted','delivered','bounce','complaint','failed') then raise exception 'growth_g2: unsupported delivery event type'; end if;
  if p_occurred_at is null or p_occurred_at > now()+interval '5 minutes' then raise exception 'growth_g2: invalid delivery event timestamp'; end if;
  select * into v_attempt from growth.outreach_attempt a where a.id=p_outreach_attempt_id for update;
  if v_attempt.id is null then raise exception 'growth_g2: outreach attempt not found'; end if;
  if v_attempt.organization_id<>p_organization_id or v_attempt.business_unit_id<>p_business_unit_id or v_attempt.jurisdiction_id<>p_jurisdiction_id then raise exception 'growth_g2: delivery event outside authorized scope'; end if;
  if v_attempt.channel<>'email' then raise exception 'growth_g2: only email delivery feedback is authorized'; end if;
  if v_attempt.sender_identity_id is null then raise exception 'growth_g2: sender identity linkage missing'; end if;
  if not exists(select 1 from growth.sender_identity s where s.id=v_attempt.sender_identity_id and s.organization_id=p_organization_id and s.business_unit_id=p_business_unit_id and s.jurisdiction_id=p_jurisdiction_id) then raise exception 'growth_g2: sender identity outside attempt scope'; end if;
  select * into v_existing from growth.outreach_event e where e.provider=btrim(p_provider) and e.provider_event_id=btrim(p_provider_event_id);
  if v_existing.id is not null then
    if v_existing.outreach_attempt_id=p_outreach_attempt_id and v_existing.event_type=p_event_type and v_existing.provider_message_id=btrim(p_provider_message_id) then return v_existing.id; end if;
    raise exception 'growth_g2: provider event id collision';
  end if;
  if p_event_type='submitted' then
    if v_attempt.attempt_status not in ('created','submitted') then raise exception 'growth_g2: invalid submitted transition'; end if;
    if v_attempt.provider is not null and v_attempt.provider<>btrim(p_provider) then raise exception 'growth_g2: provider mismatch'; end if;
    if v_attempt.provider_message_id is not null and v_attempt.provider_message_id<>btrim(p_provider_message_id) then raise exception 'growth_g2: provider message mismatch'; end if;
  else
    if v_attempt.provider is null or v_attempt.provider_message_id is null then raise exception 'growth_g2: submitted event required before delivery feedback'; end if;
    if v_attempt.provider<>btrim(p_provider) or v_attempt.provider_message_id<>btrim(p_provider_message_id) then raise exception 'growth_g2: provider linkage mismatch'; end if;
    if not exists(select 1 from growth.outreach_event e where e.outreach_attempt_id=p_outreach_attempt_id and e.event_type='submitted') then raise exception 'growth_g2: submitted event required before delivery feedback'; end if;
    if p_event_type='delivered' and v_attempt.attempt_status not in ('submitted','delivered') then raise exception 'growth_g2: invalid delivered transition'; end if;
    if p_event_type='complaint' and not exists(select 1 from growth.outreach_event e where e.outreach_attempt_id=p_outreach_attempt_id and e.event_type='delivered') then raise exception 'growth_g2: delivered event required before complaint'; end if;
  end if;
  insert into growth.outreach_event(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_attempt_id,channel,event_type,provider,provider_message_id,provider_event_id,occurred_at,payload)
  values(v_attempt.organization_id,v_attempt.business_unit_id,v_attempt.jurisdiction_id,v_attempt.prospect_id,v_attempt.contact_candidate_id,v_attempt.id,'email',p_event_type,btrim(p_provider),btrim(p_provider_message_id),btrim(p_provider_event_id),p_occurred_at,coalesce(p_payload,'{}'::jsonb)) returning id into v_event_id;
  if p_event_type='submitted' then
    update growth.outreach_attempt set provider=btrim(p_provider),provider_message_id=btrim(p_provider_message_id),attempt_status='submitted',submitted_at=coalesce(submitted_at,p_occurred_at),metadata=metadata||jsonb_build_object('provider_linked',true) where id=v_attempt.id;
  elsif p_event_type='delivered' then
    update growth.outreach_attempt set attempt_status='delivered' where id=v_attempt.id;
  elsif p_event_type in ('bounce','failed') then
    update growth.outreach_attempt set attempt_status='failed' where id=v_attempt.id;
  end if;
  v_suppression_reason := case p_event_type when 'bounce' then 'hard_bounce' when 'complaint' then 'complaint' else null end;
  if v_suppression_reason is not null then
    select lower(btrim(c.email)) into v_email from growth.prospect_contact_candidate c where c.id=v_attempt.contact_candidate_id;
    if v_email is null then raise exception 'growth_g2: verified email missing for suppression'; end if;
    if not exists(select 1 from growth.suppression s where s.organization_id=v_attempt.organization_id and s.jurisdiction_id=v_attempt.jurisdiction_id and s.channel in ('all','email') and s.identity_type='email' and s.identity_value_normalized=v_email and s.reason=v_suppression_reason and s.active=true) then
      insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
      values(v_attempt.organization_id,v_attempt.jurisdiction_id,v_attempt.prospect_id,'email','email',v_email,v_suppression_reason,'growth_g2_delivery_event',true,jsonb_build_object('outreach_event_id',v_event_id,'outreach_attempt_id',v_attempt.id));
    end if;
  end if;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(v_attempt.organization_id,v_attempt.business_unit_id,v_attempt.prospect_id,'g2_delivery_event_ingested','growth_g2',jsonb_build_object('outreach_attempt_id',v_attempt.id,'outreach_event_id',v_event_id,'sender_identity_id',v_attempt.sender_identity_id,'provider',btrim(p_provider),'event_type',p_event_type));
  return v_event_id;
end;
$$;

create or replace function public.growth_g2_refresh_sender_health_from_events(
  p_sender_identity_id uuid,p_window_start timestamptz,p_window_end timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_sender growth.sender_identity%rowtype;
  v_submitted integer:=0;
  v_delivered integer:=0;
  v_bounce integer:=0;
  v_complaint integer:=0;
  v_bounce_rate numeric(9,6):=0;
  v_complaint_rate numeric(9,6):=0;
  v_status text;
  v_id uuid;
begin
  select * into v_sender from growth.sender_identity s where s.id=p_sender_identity_id;
  if v_sender.id is null then raise exception 'growth_g2: sender identity not found'; end if;
  if p_window_start is null or p_window_end is null or p_window_end<=p_window_start then raise exception 'growth_g2: invalid sender-health window'; end if;
  if p_window_end>now()+interval '5 minutes' then raise exception 'growth_g2: sender-health window cannot be future'; end if;
  with base as (
    select distinct a.id
    from growth.outreach_attempt a
    join growth.outreach_event e on e.outreach_attempt_id=a.id and e.event_type='submitted'
    where a.sender_identity_id=p_sender_identity_id and e.occurred_at>=p_window_start and e.occurred_at<p_window_end
  )
  select count(*)::integer,
    count(*) filter (where exists(select 1 from growth.outreach_event e2 where e2.outreach_attempt_id=base.id and e2.event_type='delivered' and e2.occurred_at<=p_window_end))::integer,
    count(*) filter (where exists(select 1 from growth.outreach_event e2 where e2.outreach_attempt_id=base.id and e2.event_type='bounce' and e2.occurred_at<=p_window_end))::integer,
    count(*) filter (where exists(select 1 from growth.outreach_event e2 where e2.outreach_attempt_id=base.id and e2.event_type='complaint' and e2.occurred_at<=p_window_end))::integer
  into v_submitted,v_delivered,v_bounce,v_complaint from base;
  if v_submitted>0 then v_bounce_rate:=round(v_bounce::numeric/v_submitted,6); v_complaint_rate:=round(v_complaint::numeric/v_submitted,6); end if;
  v_status:=case when v_complaint>=1 or v_bounce>=3 or v_complaint_rate>=0.001 or v_bounce_rate>=0.02 then 'blocked' when v_bounce>=1 or v_bounce_rate>=0.01 then 'warning' else 'healthy' end;
  insert into growth.sender_health_snapshot(sender_identity_id,window_start,window_end,submitted_count,delivered_count,hard_bounce_count,complaint_count,hard_bounce_rate,complaint_rate,health_status,policy_version,source,payload)
  values(p_sender_identity_id,p_window_start,p_window_end,v_submitted,v_delivered,v_bounce,v_complaint,v_bounce_rate,v_complaint_rate,v_status,'g2-sender-health-derived-2026-08-23','derived_outreach_events',jsonb_build_object('derived',true,'submitted_event_window','[start,end)','outcome_cutoff',p_window_end)) returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(v_sender.organization_id,v_sender.business_unit_id,null,'g2_sender_health_derived','growth_g2',jsonb_build_object('sender_identity_id',p_sender_identity_id,'sender_health_snapshot_id',v_id,'submitted_count',v_submitted,'delivered_count',v_delivered,'hard_bounce_count',v_bounce,'complaint_count',v_complaint,'health_status',v_status));
  return v_id;
end;
$$;

create or replace function public.growth_g2_evaluate_sender_readiness(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_sender_email text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_sender growth.sender_identity%rowtype;
  v_auth growth.sender_auth_evidence%rowtype;
  v_health growth.sender_health_snapshot%rowtype;
  v_blockers text[]:=array[]::text[];
begin
  select * into v_sender from growth.sender_identity s where s.organization_id=p_organization_id and s.business_unit_id=p_business_unit_id and s.jurisdiction_id=p_jurisdiction_id and s.email_address=lower(btrim(coalesce(p_sender_email,''))) order by s.updated_at desc limit 1;
  if v_sender.id is null then v_blockers:=array_append(v_blockers,'sender_not_registered'); return jsonb_build_object('ready',false,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-derived-2026-08-23'); end if;
  if v_sender.status<>'approved' then v_blockers:=array_append(v_blockers,'sender_not_approved'); end if;
  if v_sender.valid_until is null or v_sender.valid_until<=now() then v_blockers:=array_append(v_blockers,'sender_approval_expired'); end if;
  select * into v_auth from growth.sender_auth_evidence a where a.sender_identity_id=v_sender.id order by a.checked_at desc,a.created_at desc limit 1;
  if v_auth.id is null then v_blockers:=array_append(v_blockers,'sender_auth_evidence_missing'); else
    if v_auth.evidence_status<>'accepted' then v_blockers:=array_append(v_blockers,'sender_auth_evidence_not_accepted'); end if;
    if v_auth.valid_until<=now() then v_blockers:=array_append(v_blockers,'sender_auth_evidence_expired'); end if;
    if v_auth.spf_status<>'pass' then v_blockers:=array_append(v_blockers,'spf_not_pass'); end if;
    if v_auth.dkim_status<>'pass' then v_blockers:=array_append(v_blockers,'dkim_not_pass'); end if;
    if v_auth.dmarc_status<>'pass' then v_blockers:=array_append(v_blockers,'dmarc_not_pass'); end if;
  end if;
  select * into v_health from growth.sender_health_snapshot h where h.sender_identity_id=v_sender.id and h.source='derived_outreach_events' and coalesce((h.payload->>'derived')::boolean,false)=true order by h.window_end desc,h.recorded_at desc limit 1;
  if v_health.id is null then v_blockers:=array_append(v_blockers,'derived_sender_health_missing'); else
    if v_health.window_end < now()-interval '24 hours' then v_blockers:=array_append(v_blockers,'sender_health_stale'); end if;
    if v_health.health_status<>'healthy' then v_blockers:=array_append(v_blockers,'sender_health_not_healthy'); end if;
  end if;
  return jsonb_build_object('ready',cardinality(v_blockers)=0,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-derived-2026-08-23','sender_identity_id',v_sender.id);
end;
$$;

create or replace function public.growth_g2_record_event(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,p_outreach_attempt_id uuid,p_channel text,p_event_type text,p_provider_event_id text default null,p_occurred_at timestamptz default now(),p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_suppression_reason text;
  v_attempt growth.outreach_attempt%rowtype;
begin
  perform public.growth_g2_assert_target_scope(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id);
  if p_event_type not in ('unsubscribe','reply','blocked','suppressed') then raise exception 'growth_g2: delivery feedback must use immutable provider boundary'; end if;
  if p_channel<>'email' then raise exception 'growth_g2: only email event recording is authorized'; end if;
  if p_outreach_attempt_id is not null then
    select * into v_attempt from growth.outreach_attempt a where a.id=p_outreach_attempt_id;
    if v_attempt.id is null or v_attempt.organization_id<>p_organization_id or v_attempt.business_unit_id<>p_business_unit_id or v_attempt.jurisdiction_id<>p_jurisdiction_id or v_attempt.prospect_id<>p_prospect_id or v_attempt.contact_candidate_id<>p_contact_candidate_id then raise exception 'growth_g2: outreach event attempt outside authorized target'; end if;
  end if;
  insert into growth.outreach_event(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_attempt_id,channel,event_type,provider_event_id,occurred_at,payload)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_attempt_id,p_channel,p_event_type,null,p_occurred_at,coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
  v_suppression_reason := case p_event_type when 'unsubscribe' then 'opt_out' else null end;
  if v_suppression_reason is not null and p_contact_candidate_id is not null then
    insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
    select p_organization_id,p_jurisdiction_id,p_prospect_id,'email','email',lower(trim(c.email)),v_suppression_reason,'growth_g2_event',true,jsonb_build_object('outreach_event_id',v_id,'event_type',p_event_type)
    from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id and c.email is not null;
  end if;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_outreach_event_recorded','growth_g2',jsonb_build_object('outreach_event_id',v_id,'event_type',p_event_type,'channel',p_channel));
  return v_id;
end;
$$;

revoke execute on function public.growth_g2_record_sender_health_snapshot(uuid,timestamptz,timestamptz,integer,integer,integer,integer,text,jsonb) from service_role;
revoke execute on function public.growth_g2_ingest_delivery_event(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_refresh_sender_health_from_events(uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke execute on function public.growth_g2_outreach_event_immutable_guard() from public,anon,authenticated,service_role;
revoke execute on function public.growth_g2_outreach_attempt_identity_guard() from public,anon,authenticated,service_role;
grant execute on function public.growth_g2_ingest_delivery_event(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.growth_g2_refresh_sender_health_from_events(uuid,timestamptz,timestamptz) to service_role;

revoke insert,update,delete on growth.outreach_attempt from service_role;
revoke insert,update,delete on growth.outreach_event from service_role;
grant select on growth.outreach_attempt to service_role;
grant select on growth.outreach_event to service_role;
