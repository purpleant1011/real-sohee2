alter table public.operation_events
  drop constraint operation_events_event_type_check;
alter table public.operation_events
  add constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created', 'content.version.created', 'content.review.requested',
      'content.approved', 'content.approval.invalidated', 'schedule.suggested',
      'schedule.confirmed', 'publish.succeeded', 'publish.failed', 'publish.unknown',
      'report.snapshot.ready', 'customer.conversation.needs_attention',
      'knowledge.conflict.detected', 'harness.rule.candidate_created',
      'channel.response.created', 'channel.response.approved',
      'channel.response.sent', 'channel.response.failed',
      'channel.connection.connected', 'channel.connection.disconnected',
      'channel.connection.expired', 'channel.webhook.received',
      'publish.claimed', 'publish.lease_expired'
    )
  );

create or replace function private.sync_publish_outcome_reporting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_record public.schedules%rowtype;
  event_name text;
  event_payload jsonb;
  notification_body text;
begin
  if old.status = new.status or new.status not in ('succeeded', 'failed', 'unknown') then
    return new;
  end if;

  select * into schedule_record
  from public.schedules
  where workspace_id = new.workspace_id and id = new.schedule_id;
  if schedule_record.id is null then return new; end if;

  update public.work_items
  set status = case when new.status = 'succeeded' then 'published' else 'publish_failed' end
  where workspace_id = new.workspace_id
    and content_item_id = schedule_record.content_id
    and status not in ('cancelled', 'archived');

  event_name := case new.status
    when 'succeeded' then 'publish.succeeded'
    when 'unknown' then 'publish.unknown'
    else 'publish.failed'
  end;
  event_payload := case new.status
    when 'succeeded' then jsonb_build_object(
      'attemptId', new.id,
      'contentVersionId', schedule_record.version_id,
      'providerMode', 'live'
    )
    when 'unknown' then jsonb_build_object(
      'attemptId', new.id,
      'contentVersionId', schedule_record.version_id,
      'errorCode', lower(coalesce(new.error_code, 'result_unknown')),
      'recoveryStatus', coalesce(new.recovery_status, 'reconcile_required')
    )
    else jsonb_build_object(
      'attemptId', new.id,
      'contentVersionId', schedule_record.version_id,
      'errorCode', lower(coalesce(new.error_code, 'provider_error'))
    )
  end;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    new.workspace_id,
    event_name,
    event_name || ':' || new.id::text,
    'publish_attempt',
    new.id,
    event_payload,
    coalesce(new.finished_at, statement_timestamp())
  ) on conflict (workspace_id, event_key) do nothing;

  notification_body := case new.status
    when 'succeeded' then '승인된 콘텐츠가 채널에 게시되었습니다.'
    when 'unknown' then '채널 게시 결과를 확인할 수 없어 외부 상태 대조가 필요합니다.'
    else '채널 게시가 완료되지 않아 확인이 필요합니다.'
  end;
  insert into public.notifications (
    workspace_id, user_id, kind, body, href, event_key
  ) values (
    new.workspace_id, new.created_by, 'publish', notification_body,
    '/app/work/' || schedule_record.content_id::text,
    event_name || ':' || new.id::text
  ) on conflict (workspace_id, user_id, event_key)
    where event_key is not null
    do nothing;

  return new;
end;
$$;

revoke all on function private.sync_publish_outcome_reporting()
  from public, anon, authenticated;
