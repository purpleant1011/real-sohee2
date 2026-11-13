create function private.publish_reservation_context(
  p_workspace_id uuid,
  p_attempt_id uuid,
  p_is_new boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', attempt.id,
    'status', attempt.status,
    'providerReference', attempt.provider_reference,
    'errorCode', attempt.error_code,
    'isNew', p_is_new,
    'workspaceId', attempt.workspace_id,
    'scheduleId', schedule.id,
    'versionId', schedule.version_id,
    'channelConnectionId', schedule.channel_connection_id,
    'channel', content.channel,
    'idempotencyKey', attempt.idempotency_key,
    'contentFingerprint', version.fingerprint
  )
  from public.publish_attempts as attempt
  join public.schedules as schedule
    on schedule.workspace_id = attempt.workspace_id
   and schedule.id = attempt.schedule_id
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  join public.content_versions as version
    on version.workspace_id = schedule.workspace_id
   and version.id = schedule.version_id
  where attempt.workspace_id = p_workspace_id
    and attempt.id = p_attempt_id;
$$;

create function private.reserve_publish_attempt_internal(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_id uuid;
  stored_schedule_id uuid;
  scheduled_version_id uuid;
  scheduled_channel_id uuid;
  scheduled_channel text;
  connection_channel text;
  next_attempt integer;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '모의 게시를 실행할 권한이 없습니다.';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception '게시 식별자를 확인해 주세요.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select id, schedule_id into attempt_id, stored_schedule_id
  from public.publish_attempts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;

  if attempt_id is not null then
    if stored_schedule_id <> p_schedule_id then
      raise exception '게시 식별자가 다른 요청에 이미 사용되었습니다.';
    end if;
    return private.publish_reservation_context(p_workspace_id, attempt_id, false);
  end if;

  select schedule.version_id, schedule.channel_connection_id, content.channel, connection.channel
  into scheduled_version_id, scheduled_channel_id, scheduled_channel, connection_channel
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
   and content.current_version_id = schedule.version_id
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
   and connection.id = schedule.channel_connection_id
   and connection.status = 'connected'
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'scheduled'
  for update of schedule, content, connection;

  if scheduled_version_id is null or connection_channel <> scheduled_channel then
    raise exception '게시할 예약과 연결 채널을 확인해 주세요.';
  end if;
  if not private.is_content_version_publishable(p_workspace_id, scheduled_version_id) then
    raise exception '승인 근거가 변경되어 다시 승인해야 합니다.';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into next_attempt
  from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = p_schedule_id;

  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status, created_by
  ) values (
    p_workspace_id, p_schedule_id, next_attempt, p_idempotency_key, 'pending', (select auth.uid())
  ) returning id into attempt_id;

  update public.schedules
  set status = 'publishing', updated_at = now()
  where workspace_id = p_workspace_id and id = p_schedule_id;

  return private.publish_reservation_context(p_workspace_id, attempt_id, true);
end;
$$;

create function private.retry_publish_attempt_allowed_internal(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  failure_code text;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '발행을 재시도할 권한이 없습니다.';
  end if;
  select error_code into failure_code
  from public.publish_attempts
  where workspace_id = p_workspace_id
    and id = p_failed_attempt_id
    and status = 'failed';
  if failure_code not in ('TEMPORARY_NETWORK', 'RATE_LIMITED') then
    raise exception '다시 시도할 수 없는 게시 실패입니다.';
  end if;
  return private.retry_publish_attempt_internal(
    p_workspace_id, p_failed_attempt_id, p_new_idempotency_key
  );
end;
$$;

create or replace function public.retry_publish_attempt(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.retry_publish_attempt_allowed_internal(
    p_workspace_id, p_failed_attempt_id, p_new_idempotency_key
  );
$$;

create function private.reserve_publish_retry_internal(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_schedule_id uuid;
  existing_attempt_id uuid;
  existing_schedule_id uuid;
  retry_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '발행을 재시도할 권한이 없습니다.';
  end if;
  if p_new_idempotency_key is null or p_new_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception '재시도 식별자를 확인해 주세요.';
  end if;

  select schedule_id into failed_schedule_id
  from public.publish_attempts
  where workspace_id = p_workspace_id and id = p_failed_attempt_id and status = 'failed';
  if failed_schedule_id is null then
    raise exception '실패한 발행 시도만 재시도할 수 있습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_new_idempotency_key, 0)
  );
  select id, schedule_id into existing_attempt_id, existing_schedule_id
  from public.publish_attempts
  where workspace_id = p_workspace_id and idempotency_key = p_new_idempotency_key;
  if existing_attempt_id is not null then
    if existing_schedule_id <> failed_schedule_id then
      raise exception '재시도 식별자가 다른 요청에 이미 사용되었습니다.';
    end if;
    return private.publish_reservation_context(p_workspace_id, existing_attempt_id, false);
  end if;

  retry_id := private.retry_publish_attempt_allowed_internal(
    p_workspace_id, p_failed_attempt_id, p_new_idempotency_key
  );
  return private.publish_reservation_context(p_workspace_id, retry_id, true);
end;
$$;

create function public.reserve_publish_attempt(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_publish_attempt_internal(
    p_workspace_id, p_schedule_id, p_idempotency_key
  );
$$;

create function public.reserve_publish_retry(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_publish_retry_internal(
    p_workspace_id, p_failed_attempt_id, p_new_idempotency_key
  );
$$;

revoke all on function private.publish_reservation_context(uuid, uuid, boolean) from public, anon;
revoke all on function private.reserve_publish_attempt_internal(uuid, uuid, text) from public, anon;
revoke all on function private.retry_publish_attempt_allowed_internal(uuid, uuid, text) from public, anon;
revoke all on function private.reserve_publish_retry_internal(uuid, uuid, text) from public, anon;
grant execute on function private.reserve_publish_attempt_internal(uuid, uuid, text) to authenticated;
grant execute on function private.retry_publish_attempt_allowed_internal(uuid, uuid, text) to authenticated;
grant execute on function private.reserve_publish_retry_internal(uuid, uuid, text) to authenticated;

revoke all on function public.reserve_publish_attempt(uuid, uuid, text) from public, anon;
revoke all on function public.reserve_publish_retry(uuid, uuid, text) from public, anon;
grant execute on function public.reserve_publish_attempt(uuid, uuid, text) to authenticated;
grant execute on function public.reserve_publish_retry(uuid, uuid, text) to authenticated;
