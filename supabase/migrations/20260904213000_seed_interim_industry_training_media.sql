-- Interim, externally hosted training media. Replace these rows with governed HUC-owned media versions when available.
begin;

insert into hems_hr.training_module(
  module_code,module_version,title,category,jurisdiction_scope,role_scope,minimum_score,
  assignment_due_days,renewal_policy,source_authority,source_url,delivery_mode,
  practical_observation_required,standard_definition,status,effective_from
) values (
  'HUC_FINAL_QA_WALKTHROUGH','2026.1','Scope of Work and Final Quality Assurance Walkthrough',
  'quality_standard','ALL','all',null,14,'on_change','OctoClean Media',
  'https://www.youtube.com/watch?v=r1mp6oE7bhw','online_or_instructor',true,
  '{"interim_media":true,"scope":["scope and add-ons","checklist adherence","supervisor inspection"]}'::jsonb,
  'active',current_date
)
on conflict(module_code,module_version) do update set
  title=excluded.title,category=excluded.category,jurisdiction_scope=excluded.jurisdiction_scope,
  role_scope=excluded.role_scope,source_authority=excluded.source_authority,source_url=excluded.source_url,
  practical_observation_required=excluded.practical_observation_required,
  standard_definition=excluded.standard_definition,status='active',effective_to=null,updated_at=now();

with media(module_code,media_version,playback_url,duration_seconds) as (values
  ('HUC_CLEANING_SOPS','industry-interim-2026.1','https://www.youtube-nocookie.com/embed/M8bvESowYJg',200),
  ('HUC_COLOR_CODED_MICROFIBER_RAGS','industry-interim-2026.1','https://www.youtube-nocookie.com/embed/sHQVhInihF0',73),
  ('ON_WHIMIS_2015','industry-interim-2026.1','https://www.youtube-nocookie.com/embed/R5oAqYogEOg',1810),
  ('AZ_OSHA_HAZCOM','industry-interim-2026.1','https://www.youtube-nocookie.com/embed/EEX4-O4fgBU',677),
  ('HUC_FINAL_QA_WALKTHROUGH','industry-interim-2026.1','https://www.youtube-nocookie.com/embed/r1mp6oE7bhw',279)
)
insert into hems_hr.applicant_training_media(
  training_module_id,media_version,playback_type,playback_url,duration_seconds,
  required_watch_percent,comprehension_version,status,effective_from
)
select tm.id,m.media_version,'embed',m.playback_url,m.duration_seconds,90,'1.0','active',current_date
from media m join hems_hr.training_module tm on tm.module_code=m.module_code and tm.status='active'
on conflict(training_module_id,media_version) do update set
  playback_type=excluded.playback_type,playback_url=excluded.playback_url,
  duration_seconds=excluded.duration_seconds,required_watch_percent=excluded.required_watch_percent,
  comprehension_version=excluded.comprehension_version,status='active',effective_to=null,updated_at=now();

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
    ) order by case m.module_code when 'HUC_CLEANING_SOPS' then 1 when 'HUC_COLOR_CODED_MICROFIBER_RAGS' then 2 when 'HUC_FINAL_QA_WALKTHROUGH' then 4 else 3 end)
    from hems_hr.training_module m
    left join lateral (select x.* from hems_hr.applicant_training_media x where x.training_module_id=m.id and x.status='active'
      and current_date between x.effective_from and coalesce(x.effective_to,'infinity'::date) order by x.effective_from desc limit 1) media on true
    left join hems_hr.applicant_training_record record on record.applicant_submission_id=v_app.id
      and record.training_module_id=m.id and record.training_media_id=media.id and record.completion_status<>'superseded'
    where m.status='active' and m.module_code in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS','HUC_FINAL_QA_WALKTHROUGH',
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
  if not found or v_module.module_code not in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS','HUC_FINAL_QA_WALKTHROUGH','ON_WHIMIS_2015','AZ_OSHA_HAZCOM') then
    raise exception 'training module is not available to applicants';
  end if;
  if (v_module.module_code='ON_WHIMIS_2015' and not exists(
      select 1 from hems_hr.applicant_intake_program ip where ip.id=v_app.program_id and ip.public_code='HUC_ON_RESIDENTIAL_CLEANER'))
    or (v_module.module_code='AZ_OSHA_HAZCOM' and not exists(
      select 1 from hems_hr.applicant_intake_program ip where ip.id=v_app.program_id and ip.public_code='HUC_AZ_RESIDENTIAL_CLEANER')) then
    raise exception 'training module is outside the applicant jurisdiction';
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
      where required.status='active' and required.module_code in ('HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS','HUC_FINAL_QA_WALKTHROUGH',
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
      'HUC_CLEANING_SOPS','HUC_COLOR_CODED_MICROFIBER_RAGS','HUC_FINAL_QA_WALKTHROUGH',case when v_jurisdiction='ON' then 'ON_WHIMIS_2015' else 'AZ_OSHA_HAZCOM' end)
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
 'public.get_applicant_training_catalog(text,text)'::regprocedure,
 'public.record_applicant_training_milestone(text,text,uuid,integer,boolean,text,boolean,text,text)'::regprocedure,
 'public.get_applicant_training_readiness(uuid,uuid)'::regprocedure
] loop execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f); end loop; end $$;

commit;
