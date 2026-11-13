create table public.social_post_tracking (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  publish_attempt_id uuid not null,
  tracking_id text not null check (tracking_id ~ '^SH-[A-Z0-9]{12}$'),
  destination_url text check (destination_url is null or char_length(destination_url) between 8 and 2048),
  created_at timestamptz not null default statement_timestamp(),
  constraint social_post_tracking_attempt_key unique (workspace_id, publish_attempt_id),
  constraint social_post_tracking_tracking_key unique (tracking_id),
  constraint social_post_tracking_attempt_fkey foreign key (workspace_id, publish_attempt_id)
    references public.publish_attempts (workspace_id, id) on delete cascade
);

create table public.social_attribution_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tracking_id text not null,
  event_type text not null check (event_type in ('visit', 'return_visit', 'inquiry', 'reservation')),
  anonymous_visitor_hash text check (anonymous_visitor_hash is null or anonymous_visitor_hash ~ '^[a-f0-9]{64}$'),
  booking_id uuid,
  reservation_value_krw bigint check (reservation_value_krw is null or reservation_value_krw >= 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint social_attribution_events_tracking_fkey foreign key (tracking_id)
    references public.social_post_tracking (tracking_id) on delete cascade,
  constraint social_attribution_events_reservation_check check (
    event_type = 'reservation' or (booking_id is null and reservation_value_krw is null)
  )
);

create index social_attribution_events_report_idx
  on public.social_attribution_events (workspace_id, tracking_id, event_type, occurred_at desc);

alter table public.social_post_tracking enable row level security;
alter table public.social_attribution_events enable row level security;
create policy "workspace members can read social tracking"
  on public.social_post_tracking for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

revoke all on public.social_post_tracking, public.social_attribution_events from public, anon, authenticated;
grant select on public.social_post_tracking to authenticated;
grant select, insert, update, delete on public.social_post_tracking, public.social_attribution_events to service_role;

create function private.ensure_social_post_tracking_internal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'succeeded' and new.provider_reference is not null then
    insert into public.social_post_tracking (workspace_id, publish_attempt_id, tracking_id)
    values (
      new.workspace_id,
      new.id,
      'SH-' || upper(substr(replace(new.id::text, '-', ''), 1, 12))
    ) on conflict (workspace_id, publish_attempt_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger publish_attempt_social_tracking
after insert or update of status, provider_reference on public.publish_attempts
for each row execute function private.ensure_social_post_tracking_internal();

insert into public.social_post_tracking (workspace_id, publish_attempt_id, tracking_id)
select attempt.workspace_id, attempt.id,
  'SH-' || upper(substr(replace(attempt.id::text, '-', ''), 1, 12))
from public.publish_attempts as attempt
where attempt.status = 'succeeded' and attempt.provider_reference is not null
on conflict (workspace_id, publish_attempt_id) do nothing;

create function private.list_due_social_metric_contexts_internal(p_now timestamptz, p_limit integer)
returns table (workspace_id uuid, publish_attempt_id uuid, published_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit not between 1 and 25 then raise exception 'DUE_SOCIAL_METRICS_INVALID'; end if;
  return query
  select attempt.workspace_id, attempt.id, attempt.finished_at
  from public.publish_attempts as attempt
  join public.schedules as schedule on schedule.workspace_id = attempt.workspace_id and schedule.id = attempt.schedule_id
  left join lateral (
    select collection.collected_at, collection.status, collection.next_attempt_at
    from public.channel_metric_collections as collection
    where collection.workspace_id = attempt.workspace_id and collection.publish_attempt_id = attempt.id
    order by collection.collected_at desc, collection.id desc limit 1
  ) latest on true
  where attempt.status = 'succeeded' and attempt.provider_reference is not null
    and attempt.finished_at is not null and schedule.status = 'published'
    and (
      latest.collected_at is null
      or (latest.status = 'failed' and latest.next_attempt_at is not null and latest.next_attempt_at <= p_now)
      or (latest.status in ('succeeded', 'no_data') and latest.collected_at + interval '4 hours' <= p_now)
    )
  order by coalesce(latest.next_attempt_at, latest.collected_at + interval '4 hours', attempt.finished_at), attempt.id
  limit p_limit;
end;
$$;

create function public.list_due_social_metric_contexts(p_now timestamptz, p_limit integer default 10)
returns table (workspace_id uuid, publish_attempt_id uuid, published_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.list_due_social_metric_contexts_internal(p_now, p_limit);
$$;
revoke all on function private.list_due_social_metric_contexts_internal(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.list_due_social_metric_contexts(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.list_due_social_metric_contexts_internal(timestamptz, integer) to service_role;
grant execute on function public.list_due_social_metric_contexts(timestamptz, integer) to service_role;

create function private.list_social_post_reports_v075_internal(
  p_workspace_id uuid, p_period_start timestamptz, p_period_end timestamptz, p_content_id uuid default null
)
returns table (
  workspace_id uuid, work_item_id uuid, work_title text, content_item_id uuid,
  content_version_id uuid, version_number integer, channel text, schedule_id uuid,
  scheduled_at timestamptz, schedule_status text, publish_attempt_id uuid,
  delivery_status text, provider_post_reference text, published_at timestamptz,
  collection_id uuid, collection_status text, collection_period_start timestamptz,
  collection_period_end timestamptz, collected_at timestamptz, tracking_id text,
  next_collection_at timestamptz, return_visits bigint, reservation_count bigint,
  reservation_value bigint, metrics jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_workspace_member(p_workspace_id))
    or p_period_start is null or p_period_end < p_period_start
    or p_period_end - p_period_start > interval '366 days'
  then raise exception 'SOCIAL_REPORT_FORBIDDEN'; end if;
  return query
  with latest_attempt as (
    select distinct on (attempt.schedule_id) attempt.*
    from public.publish_attempts attempt
    join public.schedules candidate on candidate.workspace_id = attempt.workspace_id and candidate.id = attempt.schedule_id
    where attempt.workspace_id = p_workspace_id
      and coalesce(attempt.finished_at, candidate.publish_at) between p_period_start and p_period_end
    order by attempt.schedule_id, attempt.attempt_number desc, attempt.started_at desc
  )
  select schedule.workspace_id, work.id, coalesce(work.title, content.title), content.id,
    version.id, version.version_number, connection.channel, schedule.id, schedule.publish_at,
    schedule.status, attempt.id, attempt.status, attempt.provider_reference, attempt.finished_at,
    collection.id, collection.status, collection.period_start, collection.period_end, collection.collected_at,
    tracking.tracking_id,
    case when collection.collected_at is null then attempt.finished_at else collection.collected_at + interval '4 hours' end,
    attribution.return_visits, attribution.reservation_count, attribution.reservation_value,
    coalesce(metric.values, '[]'::jsonb)
  from latest_attempt attempt
  join public.schedules schedule on schedule.workspace_id = attempt.workspace_id and schedule.id = attempt.schedule_id
  join public.content_items content on content.workspace_id = schedule.workspace_id and content.id = schedule.content_id
  join public.content_versions version on version.workspace_id = schedule.workspace_id and version.id = schedule.version_id and version.content_id = content.id
  join public.channel_connections connection on connection.workspace_id = schedule.workspace_id and connection.id = schedule.channel_connection_id and connection.channel in ('instagram','threads')
  left join lateral (select item.id, item.title from public.work_items item where item.workspace_id = content.workspace_id and item.content_item_id = content.id order by item.created_at, item.id limit 1) work on true
  left join lateral (select candidate.* from public.channel_metric_collections candidate where candidate.workspace_id = attempt.workspace_id and candidate.publish_attempt_id = attempt.id order by candidate.collected_at desc, candidate.id desc limit 1) collection on true
  left join lateral (select jsonb_agg(jsonb_build_object('metric', value.metric, 'state', value.state, 'value', value.value) order by value.metric) values from public.channel_metric_values value where value.workspace_id = collection.workspace_id and value.collection_id = collection.id) metric on true
  left join public.social_post_tracking tracking on tracking.workspace_id = attempt.workspace_id and tracking.publish_attempt_id = attempt.id
  left join lateral (
    select count(*) filter (where event.event_type = 'return_visit')::bigint return_visits,
      count(*) filter (where event.event_type = 'reservation')::bigint reservation_count,
      sum(event.reservation_value_krw) filter (where event.event_type = 'reservation')::bigint reservation_value
    from public.social_attribution_events event
    where event.workspace_id = attempt.workspace_id and event.tracking_id = tracking.tracking_id
      and event.occurred_at between p_period_start and p_period_end
  ) attribution on true
  where p_content_id is null or content.id = p_content_id
  order by coalesce(attempt.finished_at, schedule.publish_at) desc, attempt.id desc limit 100;
end;
$$;

create function public.list_social_post_reports_v075(
  p_workspace_id uuid, p_period_start timestamptz, p_period_end timestamptz, p_content_id uuid default null
)
returns table (
  workspace_id uuid, work_item_id uuid, work_title text, content_item_id uuid,
  content_version_id uuid, version_number integer, channel text, schedule_id uuid,
  scheduled_at timestamptz, schedule_status text, publish_attempt_id uuid,
  delivery_status text, provider_post_reference text, published_at timestamptz,
  collection_id uuid, collection_status text, collection_period_start timestamptz,
  collection_period_end timestamptz, collected_at timestamptz, tracking_id text,
  next_collection_at timestamptz, return_visits bigint, reservation_count bigint,
  reservation_value bigint, metrics jsonb
)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_social_post_reports_v075_internal(p_workspace_id, p_period_start, p_period_end, p_content_id);
$$;
revoke all on function private.list_social_post_reports_v075_internal(uuid,timestamptz,timestamptz,uuid) from public, anon;
revoke all on function public.list_social_post_reports_v075(uuid,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function private.list_social_post_reports_v075_internal(uuid,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.list_social_post_reports_v075(uuid,timestamptz,timestamptz,uuid) to authenticated;

comment on table public.social_post_tracking is 'Per-published-post tracking tag. Native reactions stay provider-sourced; first-party attribution events use this tag.';
comment on function public.list_due_social_metric_contexts(timestamptz, integer) is 'Lists published posts whose native metrics are due for a four-hour collection.';
