-- Growth Layer G2 sender identity + deliverability-health controls.
-- Acceptance-first. No provider connection and no gate activation.

create table if not exists growth.sender_identity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  jurisdiction_id uuid not null,
  email_address text not null,
  sender_domain text not null,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','suspended','revoked','expired')),
  approved_by_app_user_id uuid references public.app_user(id),
  approved_at timestamptz,
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_address = lower(btrim(email_address))),
  check (sender_domain = lower(btrim(sender_domain))),
  check (position('@' in email_address) > 1),
  check (sender_domain = split_part(email_address,'@',2)),
  check (valid_until is null or valid_until > created_at),
  unique(organization_id,business_unit_id,jurisdiction_id,email_address)
);

create table if not exists growth.sender_auth_evidence (
  id uuid primary key default gen_random_uuid(),
  sender_identity_id uuid not null references growth.sender_identity(id) on delete cascade,
  spf_status text not null check (spf_status in ('pass','fail','missing','unknown')),
  dkim_status text not null check (dkim_status in ('pass','fail','missing','unknown')),
  dmarc_status text not null check (dmarc_status in ('pass','fail','missing','unknown')),
  evidence_status text not null default 'pending' check (evidence_status in ('pending','accepted','rejected','expired','revoked')),
  evidence_source text not null,
  evidence_reference text,
  checked_at timestamptz not null,
  valid_until timestamptz not null,
  reviewed_by_app_user_id uuid references public.app_user(id),
  reviewed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (valid_until > checked_at)
);

create table if not exists growth.sender_health_snapshot (
  id uuid primary key default gen_random_uuid(),
  sender_identity_id uuid not null references growth.sender_identity(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  submitted_count integer not null check (submitted_count >= 0),
  delivered_count integer not null check (delivered_count >= 0),
  hard_bounce_count integer not null check (hard_bounce_count >= 0),
  complaint_count integer not null check (complaint_count >= 0),
  hard_bounce_rate numeric(9,6) not null check (hard_bounce_rate >= 0 and hard_bounce_rate <= 1),
  complaint_rate numeric(9,6) not null check (complaint_rate >= 0 and complaint_rate <= 1),
  health_status text not null check (health_status in ('healthy','warning','blocked')),
  policy_version text not null,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  check (window_end > window_start),
  check (delivered_count <= submitted_count),
  check (hard_bounce_count <= submitted_count),
  check (complaint_count <= submitted_count)
);

create index if not exists sender_identity_scope_idx on growth.sender_identity(organization_id,business_unit_id,jurisdiction_id,status);
create index if not exists sender_auth_evidence_latest_idx on growth.sender_auth_evidence(sender_identity_id,checked_at desc);
create index if not exists sender_health_snapshot_latest_idx on growth.sender_health_snapshot(sender_identity_id,recorded_at desc);

alter table growth.sender_identity enable row level security;
alter table growth.sender_auth_evidence enable row level security;
alter table growth.sender_health_snapshot enable row level security;
revoke all on growth.sender_identity from public,anon,authenticated;
revoke all on growth.sender_auth_evidence from public,anon,authenticated;
revoke all on growth.sender_health_snapshot from public,anon,authenticated;
grant select on growth.sender_identity to service_role;
grant select on growth.sender_auth_evidence to service_role;
grant select on growth.sender_health_snapshot to service_role;

create or replace function public.growth_g2_register_sender_identity(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,
  p_email_address text,p_display_name text,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(coalesce(p_email_address,''))); v_domain text; v_id uuid; begin
  if v_email='' or position('@' in v_email)<=1 then raise exception 'growth_g2: valid sender email required'; end if;
  v_domain:=split_part(v_email,'@',2);
  if v_domain='' then raise exception 'growth_g2: sender domain required'; end if;
  if nullif(btrim(coalesce(p_display_name,'')),'') is null then raise exception 'growth_g2: sender display name required'; end if;
  if not exists(select 1 from public.business_unit b where b.id=p_business_unit_id and b.organization_id=p_organization_id) then raise exception 'growth_g2: sender business unit outside organization'; end if;
  if not exists(select 1 from public.jurisdiction j where j.id=p_jurisdiction_id) then raise exception 'growth_g2: sender jurisdiction missing'; end if;
  insert into growth.sender_identity(organization_id,business_unit_id,jurisdiction_id,email_address,sender_domain,display_name,metadata)
  values(p_organization_id,p_business_unit_id,p_jurisdiction_id,v_email,v_domain,btrim(p_display_name),coalesce(p_metadata,'{}'::jsonb))
  on conflict(organization_id,business_unit_id,jurisdiction_id,email_address) do update set display_name=excluded.display_name,metadata=growth.sender_identity.metadata||excluded.metadata,updated_at=now()
  returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(p_organization_id,p_business_unit_id,null,'g2_sender_identity_registered','growth_g2',jsonb_build_object('sender_identity_id',v_id,'email_address',v_email));
  return v_id;
end; $$;

create or replace function public.growth_g2_review_sender_identity(
  p_sender_identity_id uuid,p_decision text,p_reviewer_app_user_id uuid,p_valid_until timestamptz default null,p_review_note text default null
) returns void language plpgsql security definer set search_path='' as $$
declare v_sender growth.sender_identity%rowtype; begin
  if p_reviewer_app_user_id is null then raise exception 'growth_g2: reviewer required'; end if;
  if p_decision not in ('approved','suspended','revoked','expired') then raise exception 'growth_g2: unsupported sender decision'; end if;
  select * into v_sender from growth.sender_identity s where s.id=p_sender_identity_id for update;
  if v_sender.id is null then raise exception 'growth_g2: sender identity not found'; end if;
  if p_decision='approved' then
    if v_sender.status<>'pending' then raise exception 'growth_g2: sender approval requires pending status'; end if;
    if p_valid_until is null or p_valid_until<=now() then raise exception 'growth_g2: future sender expiry required'; end if;
  elsif p_decision='suspended' and v_sender.status<>'approved' then raise exception 'growth_g2: only approved sender may be suspended';
  elsif p_decision='revoked' and v_sender.status not in ('approved','suspended') then raise exception 'growth_g2: sender cannot be revoked from current status';
  elsif p_decision='expired' and v_sender.status not in ('pending','approved','suspended') then raise exception 'growth_g2: sender cannot expire from current status'; end if;
  update growth.sender_identity set status=p_decision,approved_by_app_user_id=case when p_decision='approved' then p_reviewer_app_user_id else approved_by_app_user_id end,approved_at=case when p_decision='approved' then now() else approved_at end,valid_until=case when p_decision='approved' then p_valid_until else valid_until end,metadata=metadata||jsonb_build_object('review_note',p_review_note,'last_decision',p_decision,'last_reviewer_app_user_id',p_reviewer_app_user_id),updated_at=now() where id=p_sender_identity_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(v_sender.organization_id,v_sender.business_unit_id,null,'g2_sender_identity_reviewed','growth_g2',jsonb_build_object('sender_identity_id',p_sender_identity_id,'decision',p_decision,'reviewer_app_user_id',p_reviewer_app_user_id));
end; $$;

create or replace function public.growth_g2_record_sender_auth_evidence(
  p_sender_identity_id uuid,p_spf_status text,p_dkim_status text,p_dmarc_status text,p_evidence_source text,p_evidence_reference text,p_checked_at timestamptz,p_valid_until timestamptz,p_reviewer_app_user_id uuid,p_decision text default 'accepted',p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_sender growth.sender_identity%rowtype; v_id uuid; begin
  select * into v_sender from growth.sender_identity s where s.id=p_sender_identity_id;
  if v_sender.id is null then raise exception 'growth_g2: sender identity not found'; end if;
  if p_spf_status not in ('pass','fail','missing','unknown') or p_dkim_status not in ('pass','fail','missing','unknown') or p_dmarc_status not in ('pass','fail','missing','unknown') then raise exception 'growth_g2: invalid authentication status'; end if;
  if p_decision not in ('accepted','rejected') then raise exception 'growth_g2: authentication review decision invalid'; end if;
  if p_reviewer_app_user_id is null then raise exception 'growth_g2: reviewer required'; end if;
  if nullif(btrim(coalesce(p_evidence_source,'')),'') is null then raise exception 'growth_g2: authentication evidence source required'; end if;
  if p_checked_at is null or p_valid_until is null or p_valid_until<=p_checked_at then raise exception 'growth_g2: valid authentication evidence window required'; end if;
  insert into growth.sender_auth_evidence(sender_identity_id,spf_status,dkim_status,dmarc_status,evidence_status,evidence_source,evidence_reference,checked_at,valid_until,reviewed_by_app_user_id,reviewed_at,payload)
  values(p_sender_identity_id,p_spf_status,p_dkim_status,p_dmarc_status,p_decision,p_evidence_source,p_evidence_reference,p_checked_at,p_valid_until,p_reviewer_app_user_id,now(),coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(v_sender.organization_id,v_sender.business_unit_id,null,'g2_sender_auth_evidence_recorded','growth_g2',jsonb_build_object('sender_identity_id',p_sender_identity_id,'sender_auth_evidence_id',v_id,'spf',p_spf_status,'dkim',p_dkim_status,'dmarc',p_dmarc_status,'decision',p_decision));
  return v_id;
end; $$;

create or replace function public.growth_g2_record_sender_health_snapshot(
  p_sender_identity_id uuid,p_window_start timestamptz,p_window_end timestamptz,p_submitted_count integer,p_delivered_count integer,p_hard_bounce_count integer,p_complaint_count integer,p_source text,p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_sender growth.sender_identity%rowtype; v_bounce numeric(9,6); v_complaint numeric(9,6); v_status text; v_id uuid; begin
  select * into v_sender from growth.sender_identity s where s.id=p_sender_identity_id;
  if v_sender.id is null then raise exception 'growth_g2: sender identity not found'; end if;
  if p_window_start is null or p_window_end is null or p_window_end<=p_window_start then raise exception 'growth_g2: invalid sender-health window'; end if;
  if p_submitted_count<0 or p_delivered_count<0 or p_hard_bounce_count<0 or p_complaint_count<0 or p_delivered_count>p_submitted_count or p_hard_bounce_count>p_submitted_count or p_complaint_count>p_submitted_count then raise exception 'growth_g2: invalid sender-health counts'; end if;
  if nullif(btrim(coalesce(p_source,'')),'') is null then raise exception 'growth_g2: sender-health source required'; end if;
  if p_submitted_count=0 then v_bounce:=0; v_complaint:=0; else v_bounce:=round(p_hard_bounce_count::numeric/p_submitted_count,6); v_complaint:=round(p_complaint_count::numeric/p_submitted_count,6); end if;
  v_status:=case when p_complaint_count>=1 or p_hard_bounce_count>=3 or v_complaint>=0.001 or v_bounce>=0.02 then 'blocked' when p_hard_bounce_count>=1 or v_bounce>=0.01 then 'warning' else 'healthy' end;
  insert into growth.sender_health_snapshot(sender_identity_id,window_start,window_end,submitted_count,delivered_count,hard_bounce_count,complaint_count,hard_bounce_rate,complaint_rate,health_status,policy_version,source,payload)
  values(p_sender_identity_id,p_window_start,p_window_end,p_submitted_count,p_delivered_count,p_hard_bounce_count,p_complaint_count,v_bounce,v_complaint,v_status,'g2-sender-health-2026-08-23',p_source,coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload)
  values(v_sender.organization_id,v_sender.business_unit_id,null,'g2_sender_health_snapshot_recorded','growth_g2',jsonb_build_object('sender_identity_id',p_sender_identity_id,'sender_health_snapshot_id',v_id,'health_status',v_status,'hard_bounce_rate',v_bounce,'complaint_rate',v_complaint));
  return v_id;
end; $$;

create or replace function public.growth_g2_evaluate_sender_readiness(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_sender_email text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sender growth.sender_identity%rowtype; v_auth growth.sender_auth_evidence%rowtype; v_health growth.sender_health_snapshot%rowtype; v_blockers text[]:=array[]::text[]; begin
  select * into v_sender from growth.sender_identity s where s.organization_id=p_organization_id and s.business_unit_id=p_business_unit_id and s.jurisdiction_id=p_jurisdiction_id and s.email_address=lower(btrim(coalesce(p_sender_email,''))) order by s.updated_at desc limit 1;
  if v_sender.id is null then v_blockers:=array_append(v_blockers,'sender_not_registered'); return jsonb_build_object('ready',false,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-2026-08-23'); end if;
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
  select * into v_health from growth.sender_health_snapshot h where h.sender_identity_id=v_sender.id order by h.recorded_at desc limit 1;
  if v_health.id is null then v_blockers:=array_append(v_blockers,'sender_health_missing'); else
    if v_health.recorded_at < now()-interval '24 hours' then v_blockers:=array_append(v_blockers,'sender_health_stale'); end if;
    if v_health.health_status<>'healthy' then v_blockers:=array_append(v_blockers,'sender_health_not_healthy'); end if;
  end if;
  return jsonb_build_object('ready',cardinality(v_blockers)=0,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-2026-08-23','sender_identity_id',v_sender.id);
end; $$;

create or replace function public.growth_g2_create_non_sending_attempt(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_prospect_id uuid,p_contact_candidate_id uuid,p_outreach_approval_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_approval growth.outreach_approval%rowtype; v_basis growth.legal_basis_evidence%rowtype; v_contact growth.prospect_contact_candidate%rowtype; v_country text; v_subdivision text; v_email text; v_attempt_id uuid; v_recent_attempts integer; v_month_attempts integer; v_sender_ready jsonb; begin
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
  select * into v_contact from growth.prospect_contact_candidate c where c.id=p_contact_candidate_id;
  if v_contact.verification_status<>'verified' or v_contact.review_status<>'accepted' or nullif(btrim(coalesce(v_contact.email,'')),'') is null then raise exception 'growth_g2: verified accepted email contact required'; end if; v_email:=lower(btrim(v_contact.email));
  select p.country_code,p.subdivision_code into v_country,v_subdivision from growth.prospect p where p.id=p_prospect_id;
  if not ((v_country='CA' and v_subdivision='ON') or (v_country='US' and v_subdivision='AZ')) then raise exception 'growth_g2: unsupported jurisdiction'; end if;
  select * into v_basis from growth.legal_basis_evidence e where e.id=v_approval.legal_basis_evidence_id;
  if v_basis.id is null or v_basis.organization_id<>p_organization_id or v_basis.business_unit_id<>p_business_unit_id or v_basis.jurisdiction_id<>p_jurisdiction_id or v_basis.prospect_id<>p_prospect_id or v_basis.contact_candidate_id<>p_contact_candidate_id or v_basis.channel<>'email' or v_basis.evidence_status<>'accepted' or v_basis.valid_from>now() or (v_basis.valid_until is not null and v_basis.valid_until<=now()) then raise exception 'growth_g2: accepted current legal basis required'; end if;
  if v_country='CA' and v_subdivision='ON' and v_basis.basis_type='can_spam_commercial_email' then raise exception 'growth_g2: CAN-SPAM basis does not satisfy Ontario CASL control'; end if;
  if exists(select 1 from growth.suppression s where s.organization_id=p_organization_id and s.jurisdiction_id=p_jurisdiction_id and s.active=true and s.effective_at<=now() and (s.expires_at is null or s.expires_at>now()) and s.channel in ('all','email') and (s.prospect_id=p_prospect_id or (s.identity_type='email' and s.identity_value_normalized=v_email))) then raise exception 'growth_g2: active suppression blocks outreach'; end if;
  if exists(select 1 from growth.outreach_event e where e.organization_id=p_organization_id and e.business_unit_id=p_business_unit_id and e.jurisdiction_id=p_jurisdiction_id and e.prospect_id=p_prospect_id and e.contact_candidate_id=p_contact_candidate_id and e.channel='email' and e.event_type='reply') then raise exception 'growth_g2: reply received; sequencing stopped'; end if;
  select count(*) into v_recent_attempts from growth.outreach_attempt a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email' and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '72 hours'; if v_recent_attempts>0 then raise exception 'growth_g2: cooldown active'; end if;
  select count(*) into v_month_attempts from growth.outreach_attempt a where a.organization_id=p_organization_id and a.business_unit_id=p_business_unit_id and a.jurisdiction_id=p_jurisdiction_id and a.prospect_id=p_prospect_id and a.contact_candidate_id=p_contact_candidate_id and a.channel='email' and a.attempt_status in ('created','submitted','delivered') and a.created_at>now()-interval '30 days'; if v_month_attempts>=3 then raise exception 'growth_g2: frequency cap exceeded'; end if;
  if exists(select 1 from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id) then select a.id into v_attempt_id from growth.outreach_attempt a where a.outreach_approval_id=p_outreach_approval_id; return v_attempt_id; end if;
  insert into growth.outreach_attempt(organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,outreach_approval_id,channel,provider,provider_message_id,attempt_status,submitted_at,metadata) values(p_organization_id,p_business_unit_id,p_jurisdiction_id,p_prospect_id,p_contact_candidate_id,p_outreach_approval_id,'email',null,null,'created',null,jsonb_build_object('non_sending',true,'policy_version','g2-attempt-boundary-2026-08-23','cooldown_hours',72,'monthly_cap',3,'sender_readiness_policy','g2-sender-readiness-2026-08-23')) returning id into v_attempt_id;
  insert into growth.audit_event(organization_id,business_unit_id,prospect_id,event_type,source_system,payload) values(p_organization_id,p_business_unit_id,p_prospect_id,'g2_non_sending_attempt_created','growth_g2',jsonb_build_object('outreach_attempt_id',v_attempt_id,'outreach_approval_id',p_outreach_approval_id,'channel','email','sender_identity',v_approval.approved_sender_identity));
  return v_attempt_id;
end; $$;

revoke execute on function public.growth_g2_register_sender_identity(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_review_sender_identity(uuid,text,uuid,timestamptz,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_record_sender_auth_evidence(uuid,text,text,text,text,text,timestamptz,timestamptz,uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_record_sender_health_snapshot(uuid,timestamptz,timestamptz,integer,integer,integer,integer,text,jsonb) from public,anon,authenticated;
revoke execute on function public.growth_g2_evaluate_sender_readiness(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.growth_g2_create_non_sending_attempt(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.growth_g2_register_sender_identity(uuid,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.growth_g2_review_sender_identity(uuid,text,uuid,timestamptz,text) to service_role;
grant execute on function public.growth_g2_record_sender_auth_evidence(uuid,text,text,text,text,text,timestamptz,timestamptz,uuid,text,jsonb) to service_role;
grant execute on function public.growth_g2_record_sender_health_snapshot(uuid,timestamptz,timestamptz,integer,integer,integer,integer,text,jsonb) to service_role;
grant execute on function public.growth_g2_evaluate_sender_readiness(uuid,uuid,uuid,text) to service_role;
grant execute on function public.growth_g2_create_non_sending_attempt(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
