-- Applicant in-app video training. Candidate self-attestation satisfies only
-- the training portion of readiness; promotion, evidence review, compliance,
-- approval and ServiceOS activation remain governed Owner/Admin operations.
begin;

create table if not exists hems_hr.applicant_training_media (
  id uuid primary key default gen_random_uuid(),
  training_module_id uuid not null references hems_hr.training_module(id),
  media_version text not null,
  playback_type text not null check (playback_type in ('mp4','hls','embed')),
  playback_url text not null check (playback_url ~ '^https://'),
  poster_url text check (poster_url is null or poster_url ~ '^https://'),
  duration_seconds integer not null check (duration_seconds between 1 and 14400),
  required_watch_percent numeric(5,2) not null default 90 check (required_watch_percent between 50 and 100),
  comprehension_version text not null default '1.0',
  status text not null default 'draft' check (status in ('draft','active','retired')),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(training_module_id,media_version),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists hems_hr.applicant_training_record (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  business_unit_id uuid not null,
  applicant_submission_id uuid not null references hems_hr.applicant_submission(id),
  training_module_id uuid not null references hems_hr.training_module(id),
  training_media_id uuid not null references hems_hr.applicant_training_media(id),
  module_version text not null,
  media_version text not null,
  watched_seconds integer not null default 0 check (watched_seconds >= 0),
  completion_percent numeric(5,2) not null default 0 check (completion_percent between 0 and 100),
  comprehension_confirmed boolean not null default false,
  comprehension_version text,
  completion_status text not null default 'in_progress' check (completion_status in ('in_progress','completed','superseded')),
  completed_at timestamptz,
  source_fingerprint_hash text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(applicant_submission_id,training_module_id,media_version),
  unique(applicant_submission_id,idempotency_key),
  check ((completion_status='completed') = (completed_at is not null and comprehension_confirmed))
);

create index if not exists idx_applicant_training_media_module on hems_hr.applicant_training_media(training_module_id);
create index if not exists idx_applicant_training_record_submission on hems_hr.applicant_training_record(applicant_submission_id);
create index if not exists idx_applicant_training_record_module on hems_hr.applicant_training_record(training_module_id);
create index if not exists idx_applicant_training_record_media on hems_hr.applicant_training_record(training_media_id);
create index if not exists idx_applicant_training_record_bu_status on hems_hr.applicant_training_record(business_unit_id,completion_status);

alter table hems_hr.applicant_training_media enable row level security;
alter table hems_hr.applicant_training_record enable row level security;
revoke all on hems_hr.applicant_training_media,hems_hr.applicant_training_record from public,anon,authenticated;
grant select,insert,update on hems_hr.applicant_training_media,hems_hr.applicant_training_record to service_role;

create or replace function hems_hr.applicant_token_matches(p_reference text,p_access_token text)
returns hems_hr.applicant_submission language sql stable security definer set search_path=pg_catalog as $$
  select a from hems_hr.applicant_submission a
  where a.applicant_reference=p_reference and a.disposition='open'
    and a.access_token_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_access_token,'UTF8'),'sha256'),'hex')
$$;

create or replace function public.get_applicant_training_catalog(p_applicant_reference text,p_access_token text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_app hems_hr.applicant_submission%rowtype; v_jurisdiction text;
begin
  select * into v_app from hems_hr.applicant_token_matches(p_applicant_reference,p_access_token);
  if v_app.id is null then raise exception 'applicant training session unavailable'; end if;
  select case when p.public_code='HUC_ON_RESIDENTIAL_CLEANER' then 'ON' else 'AZ' end into v_jurisdiction
  from hems_hr.applicant_intake_program p where p.id=v_app.program_id;
  return jsonb_build_object(
    'applicant_reference',v_app.applicant_reference,'current_stage',v_app.current_stage,
    'modules',coalesce((select jsonb_agg(jsonb_build_object(
      'training_module_id',m.id,'module_code',m.module_code,'module_version',m.module_version,'title',m.title,
      'category',m.category,'playback_configured',media.id is not null,'training_media_id',media.id,
      'media_version',media.media_version,'playback_type',media.playback_type,'playback_url',media.playback_url,
      'poster_url',media.poster_url,'duration_seconds',media.duration_seconds,
      'required_watch_percent',media.required_watch_percent,'comprehension_version',media.comprehension_version,
      'completion_status',coalesce(record.completion_status,'not_started'),'completion_percent',coalesce(record.completion_percent,0),
      'comprehension_confirmed',coalesce(record.comprehension_confirmed,false),'completed_at',record.completed_at
    ) order by case m.module_code when 'HUC_CLEANING_SOPS' then 1 when 'HUC_COLOR_CODED_MICROFIBER_RAGS' then 2 else 3 end)
    from hems_hr.training_module m
    left join lateral (select x.* from hems_hr.applicant_training_media x where x.training_module_id=m.id and x.status='active'
      and current_date between x.effective_from and coalesce(x.effective_to,'infinity'::date) order by x.effective_from desc limit 1) media on true
    left join hems_hr.applicant_training_record record on record.applicant_submission_id=v_app.id
      and record.training_module_id=m.id and record.training_media_id=media.id and record.completion_status<>'superseded'
    where m.status='active' and m.module_code in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS',
      case when v_jurisdiction='ON' then 'ON_WHIMIS_2015' else 'AZ_OSHA_HAZCOM' end)),'[]'::jsonb)
  );
end;
$$;

create or replace function public.record_applicant_training_milestone(
  p_applicant_reference text,p_access_token text,p_training_media_id uuid,p_watched_seconds integer,
  p_comprehension_confirmed boolean,p_comprehension_version text,p_complete boolean,
  p_source_fingerprint_hash text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_app hems_hr.applicant_submission%rowtype; v_media hems_hr.applicant_training_media%rowtype;
  v_module hems_hr.training_module%rowtype; v_percent numeric(5,2); v_status text; v_completed timestamptz;
begin
  select * into v_app from hems_hr.applicant_token_matches(p_applicant_reference,p_access_token);
  if v_app.id is null then raise exception 'applicant training session unavailable'; end if;
  select * into v_media from hems_hr.applicant_training_media where id=p_training_media_id and status='active'
    and current_date between effective_from and coalesce(effective_to,'infinity'::date);
  if not found then raise exception 'active applicant training media unavailable'; end if;
  select * into v_module from hems_hr.training_module where id=v_media.training_module_id and status='active';
  if not found or v_module.module_code not in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS','ON_WHIMIS_2015','AZ_OSHA_HAZCOM') then
    raise exception 'training module is not available to applicants';
  end if;
  v_percent:=least(100,round(100.0*greatest(0,p_watched_seconds)/v_media.duration_seconds,2));
  if p_complete and (v_percent<v_media.required_watch_percent or not coalesce(p_comprehension_confirmed,false)
    or p_comprehension_version is distinct from v_media.comprehension_version) then
    raise exception 'watch threshold and current comprehension confirmation are required';
  end if;
  v_status:=case when p_complete then 'completed' else 'in_progress' end;
  v_completed:=case when p_complete then now() else null end;
  insert into hems_hr.applicant_training_record(
    organization_id,business_unit_id,applicant_submission_id,training_module_id,training_media_id,module_version,media_version,
    watched_seconds,completion_percent,comprehension_confirmed,comprehension_version,completion_status,completed_at,
    source_fingerprint_hash,idempotency_key
  ) values(v_app.organization_id,v_app.business_unit_id,v_app.id,v_module.id,v_media.id,v_module.module_version,v_media.media_version,
    least(greatest(0,p_watched_seconds),v_media.duration_seconds),v_percent,coalesce(p_comprehension_confirmed,false),
    nullif(btrim(p_comprehension_version),''),v_status,v_completed,nullif(btrim(p_source_fingerprint_hash),''),p_idempotency_key)
  on conflict(applicant_submission_id,training_module_id,media_version) do update set
    watched_seconds=greatest(hems_hr.applicant_training_record.watched_seconds,excluded.watched_seconds),
    completion_percent=greatest(hems_hr.applicant_training_record.completion_percent,excluded.completion_percent),
    comprehension_confirmed=hems_hr.applicant_training_record.comprehension_confirmed or excluded.comprehension_confirmed,
    comprehension_version=coalesce(excluded.comprehension_version,hems_hr.applicant_training_record.comprehension_version),
    completion_status=case when hems_hr.applicant_training_record.completion_status='completed' or excluded.completion_status='completed' then 'completed' else 'in_progress' end,
    completed_at=coalesce(hems_hr.applicant_training_record.completed_at,excluded.completed_at),updated_at=now();
  return jsonb_build_object('module_code',v_module.module_code,'completion_status',v_status,'completion_percent',v_percent,
    'training_ready',not exists(select 1 from hems_hr.training_module required
      left join hems_hr.applicant_training_media rm on rm.training_module_id=required.id and rm.status='active'
      left join hems_hr.applicant_training_record rr on rr.applicant_submission_id=v_app.id and rr.training_module_id=required.id
        and rr.training_media_id=rm.id and rr.completion_status='completed'
      where required.status='active' and required.module_code in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS',
        case when exists(select 1 from hems_hr.applicant_intake_program ip where ip.id=v_app.program_id and ip.public_code='HUC_ON_RESIDENTIAL_CLEANER') then 'ON_WHIMIS_2015' else 'AZ_OSHA_HAZCOM' end)
        and (rm.id is null or rr.id is null)));
end;
$$;

create or replace function public.get_applicant_training_readiness(
  p_applicant_submission_id uuid,p_actor_app_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_app hems_hr.applicant_submission%rowtype; v_jurisdiction text; v_required integer; v_completed integer; v_configured integer;
begin
  select * into v_app from hems_hr.applicant_submission where id=p_applicant_submission_id;
  if not found then raise exception 'applicant not found'; end if;
  if not hems_hr.dashboard_actor_can_view(v_app.organization_id,v_app.business_unit_id,p_actor_app_user_id) then raise exception 'applicant training actor is not authorized'; end if;
  select case when p.public_code='HUC_ON_RESIDENTIAL_CLEANER' then 'ON' else 'AZ' end into v_jurisdiction
  from hems_hr.applicant_intake_program p where p.id=v_app.program_id;
  with required as (
    select m.id from hems_hr.training_module m where m.status='active' and m.module_code in (
      'HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS',case when v_jurisdiction='ON' then 'ON_WHIMIS_2015' else 'AZ_OSHA_HAZCOM' end)
  ), current_media as (
    select distinct on (x.training_module_id) x.id,x.training_module_id from hems_hr.applicant_training_media x
    join required r on r.id=x.training_module_id where x.status='active' and current_date between x.effective_from and coalesce(x.effective_to,'infinity'::date)
    order by x.training_module_id,x.effective_from desc
  )
  select count(*),count(cm.id),count(rr.id) into v_required,v_configured,v_completed from required r
  left join current_media cm on cm.training_module_id=r.id
  left join hems_hr.applicant_training_record rr on rr.applicant_submission_id=v_app.id and rr.training_module_id=r.id and rr.training_media_id=cm.id and rr.completion_status='completed';
  return jsonb_build_object('status',case when v_required>0 and v_configured=v_required and v_completed=v_required then 'complete' else 'blocked' end,
    'required_count',v_required,'configured_count',v_configured,'completed_count',v_completed,
    'video_training_complete',v_required>0 and v_configured=v_required and v_completed=v_required,
    'activation_note','Video completion satisfies the applicant video milestone only; practical observation and all other compliance gates remain required.');
end;
$$;

do $$ declare f regprocedure; begin foreach f in array array[
 'hems_hr.applicant_token_matches(text,text)'::regprocedure,
 'public.get_applicant_training_catalog(text,text)'::regprocedure,
 'public.record_applicant_training_milestone(text,text,uuid,integer,boolean,text,boolean,text,text)'::regprocedure,
 'public.get_applicant_training_readiness(uuid,uuid)'::regprocedure
] loop execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f); end loop; end $$;

comment on table hems_hr.applicant_training_record is 'Applicant self-attested in-app video milestones; never sufficient alone for ServiceOS activation.';
commit;
