alter table public.provider_webhook_events
  add column provider_post_reference text
  check (
    provider_post_reference is null
    or char_length(provider_post_reference) between 1 and 500
  );

create index provider_webhook_events_post_time_idx
  on public.provider_webhook_events (
    workspace_id, provider, provider_post_reference, occurred_at desc
  )
  where provider_post_reference is not null;

create table public.channel_metric_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  publish_attempt_id uuid not null,
  request_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  period_start timestamptz not null,
  period_end timestamptz not null,
  collected_at timestamptz not null,
  status text not null check (
    status in ('succeeded', 'no_data', 'permission_denied', 'failed')
  ),
  error_code text check (
    error_code is null or (
      char_length(error_code) between 1 and 120
      and error_code ~ '^[A-Z0-9_]+$'
    )
  ),
  next_attempt_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint channel_metric_collections_workspace_id_id_key unique (workspace_id, id),
  constraint channel_metric_collections_request_key unique (workspace_id, request_key),
  constraint channel_metric_collections_attempt_fkey
    foreign key (workspace_id, publish_attempt_id)
    references public.publish_attempts (workspace_id, id)
    on delete cascade,
  constraint channel_metric_collections_period_check check (period_end >= period_start),
  constraint channel_metric_collections_result_check check (
    (status in ('succeeded', 'no_data', 'permission_denied')
      and error_code is null and next_attempt_at is null)
    or (status = 'failed' and error_code is not null)
  )
);

create index channel_metric_collections_attempt_time_idx
  on public.channel_metric_collections (
    workspace_id, publish_attempt_id, collected_at desc, id desc
  );
create index channel_metric_collections_retry_idx
  on public.channel_metric_collections (next_attempt_at, created_at)
  where status = 'failed' and next_attempt_at is not null;

create table public.channel_metric_values (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  collection_id uuid not null,
  metric text not null check (
    metric in (
      'views', 'likes', 'comments', 'saved', 'shares',
      'replies', 'reposts', 'quotes', 'visits', 'inquiries'
    )
  ),
  state text not null check (
    state in ('available', 'no_data', 'not_supported', 'permission_denied', 'failed')
  ),
  value bigint check (value is null or value >= 0),
  created_at timestamptz not null default statement_timestamp(),
  primary key (collection_id, metric),
  constraint channel_metric_values_collection_fkey
    foreign key (workspace_id, collection_id)
    references public.channel_metric_collections (workspace_id, id)
    on delete cascade,
  constraint channel_metric_values_value_state_check check (
    (state = 'available' and value is not null)
    or (state <> 'available' and value is null)
  )
);

create index channel_metric_values_workspace_collection_idx
  on public.channel_metric_values (workspace_id, collection_id);

alter table public.channel_metric_collections enable row level security;
alter table public.channel_metric_values enable row level security;

create policy "workspace members can read channel metric collections"
on public.channel_metric_collections for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read channel metric values"
on public.channel_metric_values for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.channel_metric_collections from public, anon, authenticated;
revoke all on public.channel_metric_values from public, anon, authenticated;
grant select on public.channel_metric_collections to authenticated;
grant select on public.channel_metric_values to authenticated;
grant select, insert, update, delete on public.channel_metric_collections to service_role;
grant select, insert, update, delete on public.channel_metric_values to service_role;
grant usage on schema private to service_role;

create function private.save_channel_metric_collection_internal(
  p_workspace_id uuid,
  p_publish_attempt_id uuid,
  p_request_key uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_collected_at timestamptz,
  p_status text,
  p_error_code text,
  p_next_attempt_at timestamptz,
  p_metrics jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection_id uuid;
  existing_fingerprint text;
  request_fingerprint text;
  metric_count integer;
  distinct_metric_count integer;
begin
  if p_workspace_id is null
    or p_publish_attempt_id is null
    or p_request_key is null
    or p_period_start is null
    or p_period_end < p_period_start
    or p_collected_at is null
    or p_collected_at > statement_timestamp() + interval '5 minutes'
    or p_status not in ('succeeded', 'no_data', 'permission_denied', 'failed')
    or jsonb_typeof(p_metrics) <> 'array'
    or jsonb_array_length(p_metrics) not between 1 and 10
    or (p_status = 'failed' and p_error_code is null)
    or (p_status <> 'failed' and p_error_code is not null)
  then
    raise exception 'METRIC_COLLECTION_INVALID';
  end if;

  select count(*), count(distinct item.metric)
  into metric_count, distinct_metric_count
  from jsonb_to_recordset(p_metrics) as item(metric text, state text, value bigint)
  where item.metric in (
      'views', 'likes', 'comments', 'saved', 'shares',
      'replies', 'reposts', 'quotes', 'visits', 'inquiries'
    )
    and item.state in (
      'available', 'no_data', 'not_supported', 'permission_denied', 'failed'
    )
    and (
      (item.state = 'available' and item.value is not null and item.value >= 0)
      or (item.state <> 'available' and item.value is null)
    );
  if metric_count <> jsonb_array_length(p_metrics)
    or distinct_metric_count <> metric_count
  then
    raise exception 'METRIC_VALUES_INVALID';
  end if;

  if not exists (
    select 1
    from public.publish_attempts as attempt
    join public.schedules as schedule
      on schedule.workspace_id = attempt.workspace_id
     and schedule.id = attempt.schedule_id
    where attempt.workspace_id = p_workspace_id
      and attempt.id = p_publish_attempt_id
      and attempt.status = 'succeeded'
      and attempt.provider_reference is not null
      and schedule.status = 'published'
  ) then
    raise exception 'PUBLISHED_ATTEMPT_NOT_FOUND';
  end if;

  request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'publishAttemptId', p_publish_attempt_id,
      'periodStart', p_period_start,
      'periodEnd', p_period_end,
      'collectedAt', p_collected_at,
      'status', p_status,
      'errorCode', p_error_code,
      'nextAttemptAt', p_next_attempt_at,
      'metrics', p_metrics
    )::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_request_key::text, 0)
  );
  select id, channel_metric_collections.request_fingerprint
  into collection_id, existing_fingerprint
  from public.channel_metric_collections
  where workspace_id = p_workspace_id and request_key = p_request_key;
  if collection_id is not null then
    if existing_fingerprint <> request_fingerprint then
      raise exception 'METRIC_REQUEST_KEY_REUSED';
    end if;
    return collection_id;
  end if;

  insert into public.channel_metric_collections (
    workspace_id, publish_attempt_id, request_key, request_fingerprint,
    period_start, period_end, collected_at, status, error_code, next_attempt_at
  ) values (
    p_workspace_id, p_publish_attempt_id, p_request_key, request_fingerprint,
    p_period_start, p_period_end, p_collected_at, p_status, p_error_code, p_next_attempt_at
  ) returning id into collection_id;

  insert into public.channel_metric_values (
    workspace_id, collection_id, metric, state, value
  )
  select p_workspace_id, collection_id, item.metric, item.state, item.value
  from jsonb_to_recordset(p_metrics) as item(metric text, state text, value bigint);

  return collection_id;
end;
$$;

create function public.save_channel_metric_collection(
  p_workspace_id uuid,
  p_publish_attempt_id uuid,
  p_request_key uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_collected_at timestamptz,
  p_status text,
  p_error_code text,
  p_next_attempt_at timestamptz,
  p_metrics jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.save_channel_metric_collection_internal(
    p_workspace_id, p_publish_attempt_id, p_request_key,
    p_period_start, p_period_end, p_collected_at,
    p_status, p_error_code, p_next_attempt_at, p_metrics
  );
$$;

revoke all on function private.save_channel_metric_collection_internal(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz,
  text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.save_channel_metric_collection(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz,
  text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function private.save_channel_metric_collection_internal(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz,
  text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.save_channel_metric_collection(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz,
  text, text, timestamptz, jsonb
) to service_role;

create function private.load_social_metric_context_internal(
  p_workspace_id uuid,
  p_publish_attempt_id uuid
)
returns table (
  workspace_id uuid,
  publish_attempt_id uuid,
  channel_connection_id uuid,
  channel text,
  provider_post_reference text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempt.workspace_id,
    attempt.id,
    schedule.channel_connection_id,
    connection.channel,
    attempt.provider_reference,
    attempt.finished_at
  from public.publish_attempts as attempt
  join public.schedules as schedule
    on schedule.workspace_id = attempt.workspace_id
   and schedule.id = attempt.schedule_id
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
   and connection.id = schedule.channel_connection_id
  where attempt.workspace_id = p_workspace_id
    and attempt.id = p_publish_attempt_id
    and attempt.status = 'succeeded'
    and attempt.provider_reference is not null
    and attempt.finished_at is not null
    and schedule.status = 'published'
    and connection.channel in ('instagram', 'threads');
$$;

create function public.load_social_metric_context(
  p_workspace_id uuid,
  p_publish_attempt_id uuid
)
returns table (
  workspace_id uuid,
  publish_attempt_id uuid,
  channel_connection_id uuid,
  channel text,
  provider_post_reference text,
  published_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.load_social_metric_context_internal(
    p_workspace_id, p_publish_attempt_id
  );
$$;

revoke all on function private.load_social_metric_context_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.load_social_metric_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_social_metric_context_internal(uuid, uuid)
  to service_role;
grant execute on function public.load_social_metric_context(uuid, uuid)
  to service_role;

create function private.list_social_post_reports_internal(
  p_workspace_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_content_id uuid default null
)
returns table (
  workspace_id uuid,
  work_item_id uuid,
  work_title text,
  content_item_id uuid,
  content_version_id uuid,
  version_number integer,
  channel text,
  schedule_id uuid,
  scheduled_at timestamptz,
  schedule_status text,
  publish_attempt_id uuid,
  delivery_status text,
  provider_post_reference text,
  published_at timestamptz,
  collection_id uuid,
  collection_status text,
  collection_period_start timestamptz,
  collection_period_end timestamptz,
  collected_at timestamptz,
  metrics jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_member(p_workspace_id))
    or p_period_start is null
    or p_period_end < p_period_start
    or p_period_end - p_period_start > interval '366 days'
  then raise exception 'SOCIAL_REPORT_FORBIDDEN'; end if;

  return query
  with latest_attempt as (
    select distinct on (attempt.schedule_id)
      attempt.*
    from public.publish_attempts as attempt
    join public.schedules as candidate_schedule
      on candidate_schedule.workspace_id = attempt.workspace_id
     and candidate_schedule.id = attempt.schedule_id
    where attempt.workspace_id = p_workspace_id
      and coalesce(attempt.finished_at, candidate_schedule.publish_at)
        between p_period_start and p_period_end
    order by attempt.schedule_id, attempt.attempt_number desc, attempt.started_at desc
  )
  select
    schedule.workspace_id,
    work.id,
    coalesce(work.title, content.title),
    content.id,
    version.id,
    version.version_number,
    connection.channel,
    schedule.id,
    schedule.publish_at,
    schedule.status,
    attempt.id,
    attempt.status,
    attempt.provider_reference,
    attempt.finished_at,
    collection.id,
    collection.status,
    collection.period_start,
    collection.period_end,
    collection.collected_at,
    coalesce(metric.values, '[]'::jsonb)
  from latest_attempt as attempt
  join public.schedules as schedule
    on schedule.workspace_id = attempt.workspace_id
   and schedule.id = attempt.schedule_id
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  join public.content_versions as version
    on version.workspace_id = schedule.workspace_id
   and version.id = schedule.version_id
   and version.content_id = content.id
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
   and connection.id = schedule.channel_connection_id
   and connection.channel in ('instagram', 'threads')
  left join lateral (
    select item.id, item.title
    from public.work_items as item
    where item.workspace_id = content.workspace_id
      and item.content_item_id = content.id
    order by item.created_at asc, item.id asc
    limit 1
  ) as work on true
  left join lateral (
    select candidate.*
    from public.channel_metric_collections as candidate
    where candidate.workspace_id = attempt.workspace_id
      and candidate.publish_attempt_id = attempt.id
    order by candidate.collected_at desc, candidate.id desc
    limit 1
  ) as collection on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'metric', value.metric,
        'state', value.state,
        'value', value.value
      ) order by value.metric
    ) as values
    from public.channel_metric_values as value
    where value.workspace_id = collection.workspace_id
      and value.collection_id = collection.id
  ) as metric on true
  where p_content_id is null or content.id = p_content_id
  order by coalesce(attempt.finished_at, schedule.publish_at) desc, attempt.id desc
  limit 100;
end;
$$;

create function public.list_social_post_reports(
  p_workspace_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_content_id uuid default null
)
returns table (
  workspace_id uuid,
  work_item_id uuid,
  work_title text,
  content_item_id uuid,
  content_version_id uuid,
  version_number integer,
  channel text,
  schedule_id uuid,
  scheduled_at timestamptz,
  schedule_status text,
  publish_attempt_id uuid,
  delivery_status text,
  provider_post_reference text,
  published_at timestamptz,
  collection_id uuid,
  collection_status text,
  collection_period_start timestamptz,
  collection_period_end timestamptz,
  collected_at timestamptz,
  metrics jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_social_post_reports_internal(
    p_workspace_id, p_period_start, p_period_end, p_content_id
  );
$$;

create function private.list_social_report_reactions_internal(
  p_workspace_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_content_id uuid default null
)
returns table (
  workspace_id uuid,
  event_id uuid,
  provider text,
  category text,
  occurred_at timestamptz,
  inbound_text text,
  provider_post_reference text,
  publish_attempt_id uuid,
  content_item_id uuid,
  content_version_id uuid,
  work_item_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_read_text boolean;
begin
  if not (select private.is_workspace_member(p_workspace_id))
    or p_period_start is null
    or p_period_end < p_period_start
    or p_period_end - p_period_start > interval '366 days'
  then raise exception 'SOCIAL_REACTIONS_FORBIDDEN'; end if;
  can_read_text := (select private.has_workspace_role(
    p_workspace_id, array['owner', 'manager']::text[]
  ));

  return query
  select
    event.workspace_id,
    event.id,
    event.provider,
    event.category,
    event.occurred_at,
    case when can_read_text then case
      when event.category = 'dm' then event.payload #>> '{message,text}'
      else event.payload #>> '{value,text}'
    end else null end,
    event.provider_post_reference,
    link.publish_attempt_id,
    link.content_item_id,
    link.content_version_id,
    link.work_item_id
  from public.provider_webhook_events as event
  left join lateral (
    select
      attempt.id as publish_attempt_id,
      schedule.content_id as content_item_id,
      schedule.version_id as content_version_id,
      (
        select item.id
        from public.work_items as item
        where item.workspace_id = schedule.workspace_id
          and item.content_item_id = schedule.content_id
        order by item.created_at asc, item.id asc
        limit 1
      ) as work_item_id
    from public.publish_attempts as attempt
    join public.schedules as schedule
      on schedule.workspace_id = attempt.workspace_id
     and schedule.id = attempt.schedule_id
     and schedule.channel_connection_id = event.channel_connection_id
    where attempt.workspace_id = event.workspace_id
      and attempt.status = 'succeeded'
      and attempt.provider_reference = event.provider_post_reference
    order by attempt.finished_at desc nulls last, attempt.attempt_number desc
    limit 1
  ) as link on true
  where event.workspace_id = p_workspace_id
    and event.occurred_at between p_period_start and p_period_end
    and (p_content_id is null or link.content_item_id = p_content_id)
  order by event.occurred_at desc, event.id desc
  limit 200;
end;
$$;

create function public.list_social_report_reactions(
  p_workspace_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_content_id uuid default null
)
returns table (
  workspace_id uuid,
  event_id uuid,
  provider text,
  category text,
  occurred_at timestamptz,
  inbound_text text,
  provider_post_reference text,
  publish_attempt_id uuid,
  content_item_id uuid,
  content_version_id uuid,
  work_item_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_social_report_reactions_internal(
    p_workspace_id, p_period_start, p_period_end, p_content_id
  );
$$;

revoke all on function private.list_social_post_reports_internal(
  uuid, timestamptz, timestamptz, uuid
) from public, anon;
revoke all on function public.list_social_post_reports(
  uuid, timestamptz, timestamptz, uuid
) from public, anon;
revoke all on function private.list_social_report_reactions_internal(
  uuid, timestamptz, timestamptz, uuid
) from public, anon;
revoke all on function public.list_social_report_reactions(
  uuid, timestamptz, timestamptz, uuid
) from public, anon;
grant execute on function private.list_social_post_reports_internal(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.list_social_post_reports(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function private.list_social_report_reactions_internal(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.list_social_report_reactions(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;

create function private.sync_publish_outcome_reporting()
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
  if old.status = new.status or new.status not in ('succeeded', 'failed') then
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

  event_name := case when new.status = 'succeeded'
    then 'publish.succeeded' else 'publish.failed' end;
  event_payload := case when new.status = 'succeeded'
    then jsonb_build_object(
      'attemptId', new.id,
      'contentVersionId', schedule_record.version_id,
      'providerMode', 'live'
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
    new.workspace_id, event_name, event_name || ':' || new.id::text,
    'publish_attempt', new.id, event_payload, coalesce(new.finished_at, statement_timestamp())
  ) on conflict (workspace_id, event_key) do nothing;

  notification_body := case when new.status = 'succeeded'
    then '승인된 콘텐츠가 채널에 게시되었습니다.'
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

create trigger publish_attempts_sync_outcome_reporting
after update of status on public.publish_attempts
for each row execute function private.sync_publish_outcome_reporting();

revoke all on function private.sync_publish_outcome_reporting()
  from public, anon, authenticated;
