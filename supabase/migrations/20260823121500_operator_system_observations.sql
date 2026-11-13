create table public.operator_system_observation_snapshots (
  source text primary key check (source in ('cloudflare', 'queue', 'cron', 'release')),
  state text not null check (state in ('healthy', 'degraded', 'error', 'empty', 'unknown')),
  observed_at timestamptz,
  safe_code text constraint operator_system_observation_snapshots_safe_code_check check (safe_code is null or safe_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  metric_value integer check (metric_value is null or metric_value >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.operator_system_observation_snapshots enable row level security;
revoke all on public.operator_system_observation_snapshots from public, anon, authenticated;
grant select, insert, update on public.operator_system_observation_snapshots to service_role;

create or replace function public.get_operator_system_observations()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required
  from public.platform_admin_members as member
  where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED';
  end if;
  if not private.has_platform_permission('system.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1
    from public.platform_admin_role_assignments as assignment
    join public.platform_role_permissions as permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id
      and assignment.workspace_id is null
      and permission.permission_key = 'system.read'
  ) then raise exception 'PERMISSION_DENIED'; end if;

  with source_rows as (
    select
      'conversation_jobs'::text as source,
      case
        when count(*) = 0 then 'empty'
        when count(*) filter (where job.status = 'needs_attention' or job.dispatch_failed_at is not null) > 0 then 'degraded'
        else 'healthy'
      end as state,
      max(coalesce(job.completed_at, job.heartbeat_at, job.started_at, job.queued_at)) as observed_at,
      case when count(*) filter (where job.status = 'needs_attention' or job.dispatch_failed_at is not null) > 0 then 'NEEDS_ATTENTION' else null end as safe_code,
      count(*)::integer as metric_value
    from public.conversation_jobs as job
    where job.queued_at >= statement_timestamp() - interval '24 hours'
    union all
    select
      'provider_webhooks'::text,
      case
        when count(*) = 0 then 'empty'
        when count(*) filter (where event.status = 'dead_letter') > 0 then 'error'
        when count(*) filter (where event.status in ('received', 'classified')) > 0 then 'degraded'
        else 'healthy'
      end,
      max(coalesce(event.processed_at, event.received_at)),
      case when count(*) filter (where event.status = 'dead_letter') > 0 then 'DEAD_LETTER' when count(*) filter (where event.status in ('received', 'classified')) > 0 then 'PENDING' else null end,
      count(*)::integer
    from public.provider_webhook_events as event
    where event.received_at >= statement_timestamp() - interval '24 hours'
    union all
    select
      'operation_events'::text,
      case when count(*) = 0 then 'empty' when count(*) filter (where event.processed_at is null) > 0 then 'degraded' else 'healthy' end,
      max(event.occurred_at),
      case when count(*) filter (where event.processed_at is null) > 0 then 'UNPROCESSED' else null end,
      count(*)::integer
    from public.operation_events as event
    where event.occurred_at >= statement_timestamp() - interval '24 hours'
    union all
    select snapshot.source, snapshot.state, snapshot.observed_at, snapshot.safe_code, snapshot.metric_value
    from public.operator_system_observation_snapshots as snapshot
  ),
  normalized as (
    select
      row.source,
      row.state,
      case
        when row.state = 'empty' then 'empty'
        when row.observed_at is null or row.observed_at > statement_timestamp() then 'unknown'
        when row.observed_at < statement_timestamp() - interval '1 day' then 'stale'
        else 'fresh'
      end as freshness,
      row.observed_at,
      row.safe_code,
      row.metric_value
    from source_rows as row
  )
  select jsonb_build_object(
    'observation_window', '24h',
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'source', row.source,
      'state', row.state,
      'freshness', row.freshness,
      'observed_at', row.observed_at,
      'safe_code', row.safe_code,
      'metric_value', row.metric_value
    ) order by row.source), '[]'::jsonb)
  ) into result
  from normalized as row;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'WORKSPACE_SCOPE_DENIED') then raise; end if;
  raise exception 'SYSTEM_OBSERVATION_UNAVAILABLE';
end;
$$;

revoke all on function public.get_operator_system_observations() from public, anon, service_role;
grant execute on function public.get_operator_system_observations() to authenticated;
