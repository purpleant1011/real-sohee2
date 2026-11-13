create unique index schedules_one_active_approval_idx
  on public.schedules (workspace_id, approval_id)
  where status in ('scheduled', 'publishing');

create function private.reject_content_version_internal(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual_fingerprint text;
  existing_id uuid;
  existing_status text;
  rejection_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  )) then
    raise exception '콘텐츠를 검토할 권한이 없습니다.';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception '거절 사유를 500자 이내로 입력해 주세요.';
  end if;

  select version.fingerprint
  into actual_fingerprint
  from public.content_items as content
  join public.content_versions as version
    on version.workspace_id = content.workspace_id
   and version.id = content.current_version_id
  where content.workspace_id = p_workspace_id
    and content.id = p_content_id
    and content.current_version_id = p_version_id
  for update of content;

  if actual_fingerprint is null then
    raise exception '최신 버전만 검토할 수 있습니다.';
  end if;
  if actual_fingerprint <> p_expected_fingerprint then
    raise exception '현재 버전 지문이 일치하지 않습니다.';
  end if;

  select id, status
  into existing_id, existing_status
  from public.approvals
  where workspace_id = p_workspace_id and version_id = p_version_id
  for update;

  if existing_id is not null then
    if existing_status = 'rejected' then
      return existing_id;
    end if;
    raise exception '이미 다른 결과로 검토된 버전입니다.';
  end if;

  insert into public.approvals (
    workspace_id, content_id, version_id, fingerprint, status,
    disclosure_confirmed, rights_confirmed, reason, decided_by
  ) values (
    p_workspace_id, p_content_id, p_version_id, actual_fingerprint, 'rejected',
    false, false, btrim(p_reason), (select auth.uid())
  ) returning id into rejection_id;

  update public.content_items
  set status = 'draft'
  where workspace_id = p_workspace_id
    and id = p_content_id
    and current_version_id = p_version_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.rejected',
    'approval',
    rejection_id,
    jsonb_build_object('versionId', p_version_id, 'fingerprint', actual_fingerprint)
  );

  return rejection_id;
end;
$$;

create function public.reject_content_version(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.reject_content_version_internal(
    p_workspace_id, p_content_id, p_version_id, p_expected_fingerprint, p_reason
  );
$$;

create function private.schedule_approved_content_once_internal(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_schedule_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_approval_id::text, 0)
  );

  select id into existing_schedule_id
  from public.schedules
  where workspace_id = p_workspace_id
    and approval_id = p_approval_id
    and status in ('scheduled', 'publishing')
  order by created_at
  limit 1;

  if existing_schedule_id is not null then
    return existing_schedule_id;
  end if;

  return private.schedule_approved_content_internal(
    p_workspace_id, p_approval_id, p_publish_at, p_timezone, p_channel_connection_id
  );
end;
$$;

create or replace function public.schedule_approved_content(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.schedule_approved_content_once_internal(
    p_workspace_id, p_approval_id, p_publish_at, p_timezone, p_channel_connection_id
  );
$$;

create function private.reschedule_content_internal(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_publish_at timestamptz,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled_version_id uuid;
  scheduled_content_id uuid;
  scheduled_channel_connection_id uuid;
  connection_status text;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '일정을 변경할 권한이 없습니다.';
  end if;
  if p_publish_at is null or p_publish_at < statement_timestamp() + interval '60 minutes' then
    raise exception '예약 시각은 현재보다 60분 이상 뒤여야 합니다.';
  end if;
  if p_timezone is null or char_length(p_timezone) not between 1 and 64 then
    raise exception '예약 시간대를 확인해 주세요.';
  end if;

  select schedule.version_id, schedule.content_id, schedule.channel_connection_id
  into scheduled_version_id, scheduled_content_id, scheduled_channel_connection_id
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
   and content.current_version_id = schedule.version_id
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'scheduled'
  for update of schedule, content;

  if scheduled_version_id is null then
    raise exception '변경할 수 있는 예약 일정을 찾지 못했습니다.';
  end if;
  if not private.is_content_version_publishable(p_workspace_id, scheduled_version_id) then
    raise exception '승인 근거가 변경되어 다시 승인해야 합니다.';
  end if;

  select status into connection_status
  from public.channel_connections
  where workspace_id = p_workspace_id and id = scheduled_channel_connection_id
  for update;
  if connection_status <> 'connected' then
    raise exception '연결된 게시 채널을 확인해 주세요.';
  end if;

  update public.schedules
  set publish_at = p_publish_at, timezone = p_timezone, updated_at = now()
  where workspace_id = p_workspace_id and id = p_schedule_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.rescheduled',
    'schedule',
    p_schedule_id,
    jsonb_build_object('versionId', scheduled_version_id, 'publishAt', p_publish_at)
  );
  return p_schedule_id;
end;
$$;

create function public.reschedule_content(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_publish_at timestamptz,
  p_timezone text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.reschedule_content_internal(
    p_workspace_id, p_schedule_id, p_publish_at, p_timezone
  );
$$;

create function private.cancel_schedule_internal(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled_content_id uuid;
  scheduled_version_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '일정을 취소할 권한이 없습니다.';
  end if;

  select schedule.content_id, schedule.version_id
  into scheduled_content_id, scheduled_version_id
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'scheduled'
  for update of schedule, content;

  if scheduled_content_id is null then
    raise exception '취소할 수 있는 예약 일정을 찾지 못했습니다.';
  end if;

  update public.schedules
  set status = 'cancelled', updated_at = now()
  where workspace_id = p_workspace_id and id = p_schedule_id;

  update public.content_items
  set status = 'approved'
  where workspace_id = p_workspace_id
    and id = scheduled_content_id
    and current_version_id = scheduled_version_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.schedule_cancelled',
    'schedule',
    p_schedule_id,
    jsonb_build_object('versionId', scheduled_version_id)
  );
  return p_schedule_id;
end;
$$;

create function public.cancel_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_schedule_internal(p_workspace_id, p_schedule_id);
$$;

revoke all on function private.reject_content_version_internal(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.schedule_approved_content_once_internal(uuid, uuid, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function private.reschedule_content_internal(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function private.cancel_schedule_internal(uuid, uuid) from public, anon, authenticated;

revoke all on function public.reject_content_version(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.reschedule_content(uuid, uuid, timestamptz, text) from public, anon;
revoke all on function public.cancel_schedule(uuid, uuid) from public, anon;
grant execute on function public.reject_content_version(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.reschedule_content(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.cancel_schedule(uuid, uuid) to authenticated;

comment on function public.reject_content_version(uuid, uuid, uuid, text, text)
  is '최신 버전을 검토 거절하고 원문을 제외한 감사 기록을 남긴다.';
comment on function public.reschedule_content(uuid, uuid, timestamptz, text)
  is '소유자 또는 관리자가 승인 근거를 재검사한 뒤 예약 시각을 변경한다.';
comment on function public.cancel_schedule(uuid, uuid)
  is '소유자 또는 관리자가 게시 전 예약을 취소한다.';
