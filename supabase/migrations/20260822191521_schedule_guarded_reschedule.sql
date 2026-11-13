alter table public.customer_conversations
  add column if not exists booking_starts_at timestamptz,
  add column if not exists booking_timezone text;

alter table public.customer_conversations
  drop constraint if exists customer_conversations_booking_timezone_check;

alter table public.customer_conversations
  add constraint customer_conversations_booking_timezone_check
  check (
    booking_timezone is null
    or char_length(booking_timezone) between 1 and 64
  );

create index if not exists customer_conversations_workspace_booking_starts_idx
  on public.customer_conversations(workspace_id, booking_starts_at)
  where booking_starts_at is not null;

create or replace function private.schedule_approved_content_once_internal(
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
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'schedule_permission_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_approval_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('schedule-conflict:' || p_workspace_id::text, 0)
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

  if exists (
    select 1
    from public.schedules as other
    where other.workspace_id = p_workspace_id
      and other.channel_connection_id = p_channel_connection_id
      and other.status in ('scheduled', 'publishing')
      and other.publish_at > p_publish_at - interval '60 minutes'
      and other.publish_at < p_publish_at + interval '60 minutes'
  ) then
    raise exception 'schedule_channel_conflict';
  end if;

  if exists (
    select 1
    from public.customer_conversations as reservation
    where reservation.workspace_id = p_workspace_id
      and reservation.booking_id is not null
      and reservation.booking_starts_at is not null
      and reservation.booking_starts_at > p_publish_at - interval '60 minutes'
      and reservation.booking_starts_at < p_publish_at + interval '60 minutes'
  ) then
    raise exception 'schedule_customer_conflict';
  end if;

  return private.schedule_approved_content_internal(
    p_workspace_id,
    p_approval_id,
    p_publish_at,
    p_timezone,
    p_channel_connection_id
  );
end;
$$;

create or replace function private.reschedule_content_guarded_internal(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_expected_updated_at timestamptz,
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
  scheduled_channel_connection_id uuid;
  observed_updated_at timestamptz;
  connection_status text;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'schedule_permission_denied';
  end if;

  if p_publish_at is null or p_publish_at < statement_timestamp() + interval '60 minutes' then
    raise exception 'schedule_minimum_lead_time';
  end if;
  if p_timezone is null or char_length(p_timezone) not between 1 and 64 then
    raise exception 'schedule_timezone_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('schedule-conflict:' || p_workspace_id::text, 0)
  );

  select schedule.version_id, schedule.channel_connection_id, schedule.updated_at
  into scheduled_version_id, scheduled_channel_connection_id, observed_updated_at
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
    raise exception 'schedule_not_changeable';
  end if;
  if observed_updated_at is distinct from p_expected_updated_at then
    raise exception 'schedule_changed';
  end if;
  if not private.is_content_version_publishable(p_workspace_id, scheduled_version_id) then
    raise exception 'schedule_approval_changed';
  end if;

  select status into connection_status
  from public.channel_connections
  where workspace_id = p_workspace_id
    and id = scheduled_channel_connection_id
  for update;
  if connection_status <> 'connected' then
    raise exception 'schedule_channel_disconnected';
  end if;

  if exists (
    select 1
    from public.schedules as other
    where other.workspace_id = p_workspace_id
      and other.id <> p_schedule_id
      and other.channel_connection_id = scheduled_channel_connection_id
      and other.status in ('scheduled', 'publishing')
      and other.publish_at > p_publish_at - interval '60 minutes'
      and other.publish_at < p_publish_at + interval '60 minutes'
  ) then
    raise exception 'schedule_channel_conflict';
  end if;

  if exists (
    select 1
    from public.customer_conversations as reservation
    where reservation.workspace_id = p_workspace_id
      and reservation.booking_id is not null
      and reservation.booking_starts_at is not null
      and reservation.booking_starts_at > p_publish_at - interval '60 minutes'
      and reservation.booking_starts_at < p_publish_at + interval '60 minutes'
  ) then
    raise exception 'schedule_customer_conflict';
  end if;

  update public.schedules
  set publish_at = p_publish_at,
      timezone = p_timezone,
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_schedule_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.rescheduled',
    'schedule',
    p_schedule_id,
    jsonb_build_object(
      'versionId', scheduled_version_id,
      'publishAt', p_publish_at,
      'guarded', true
    )
  );

  return p_schedule_id;
end;
$$;

create or replace function public.reschedule_content_guarded(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_expected_updated_at timestamptz,
  p_publish_at timestamptz,
  p_timezone text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.reschedule_content_guarded_internal(
    p_workspace_id,
    p_schedule_id,
    p_expected_updated_at,
    p_publish_at,
    p_timezone
  );
$$;

create or replace function private.cancel_schedule_guarded_internal(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled_content_id uuid;
  scheduled_version_id uuid;
  observed_updated_at timestamptz;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'schedule_permission_denied';
  end if;

  select schedule.content_id, schedule.version_id, schedule.updated_at
  into scheduled_content_id, scheduled_version_id, observed_updated_at
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'scheduled'
  for update of schedule, content;

  if scheduled_content_id is null then
    raise exception 'schedule_not_changeable';
  end if;
  if observed_updated_at is distinct from p_expected_updated_at then
    raise exception 'schedule_changed';
  end if;

  update public.schedules
  set status = 'cancelled',
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_schedule_id;

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
    jsonb_build_object('versionId', scheduled_version_id, 'guarded', true)
  );

  return p_schedule_id;
end;
$$;

create or replace function public.cancel_schedule_guarded(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_expected_updated_at timestamptz
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_schedule_guarded_internal(
    p_workspace_id,
    p_schedule_id,
    p_expected_updated_at
  );
$$;

revoke all on function private.reschedule_content_guarded_internal(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon;
revoke all on function private.cancel_schedule_guarded_internal(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function private.reschedule_content_guarded_internal(uuid, uuid, timestamptz, timestamptz, text)
  to authenticated;
grant execute on function private.cancel_schedule_guarded_internal(uuid, uuid, timestamptz)
  to authenticated;

revoke all on function public.reschedule_content_guarded(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon;
revoke all on function public.cancel_schedule_guarded(uuid, uuid, timestamptz)
  from public, anon;

grant execute on function public.reschedule_content_guarded(uuid, uuid, timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.cancel_schedule_guarded(uuid, uuid, timestamptz)
  to authenticated;

comment on function public.reschedule_content_guarded(uuid, uuid, timestamptz, timestamptz, text)
  is '소유자 또는 관리자가 마지막 확인 시각과 승인 근거를 재검사한 뒤 일정 충돌 없이 예약 시각을 변경한다.';
comment on function public.cancel_schedule_guarded(uuid, uuid, timestamptz)
  is '소유자 또는 관리자가 마지막 확인 시각과 게시 시작 전 상태를 재검사한 뒤 예약을 취소한다.';
