-- Marketing Connector Sync Queue & Lease Lock Engine (ANI-2152 / F05)
-- Distributed background queue for connector sync jobs with 15-minute lease lock,
-- single-active-collector-per-connector defense, and exponential backoff retry.

create table if not exists public.marketing_connector_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector_id text not null check (
    connector_id in (
      'gmail',
      'google_calendar',
      'apple_calendar',
      'apple_reminders',
      'google_docs',
      'google_sheets',
      'outlook_mail',
      'threads',
      'instagram',
      'instagram_messages',
      'google_drive'
    )
  ),
  source_id text not null check (char_length(source_id) between 1 and 255),
  consent_generation integer not null default 1,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  max_retries integer not null default 5 check (max_retries >= 0),
  locked_by text,
  lease_expires_at timestamptz,
  cursor text,
  next_sync_token text,
  stats jsonb not null default '{}'::jsonb,
  last_error jsonb,
  retry_after timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

-- Index for queue scheduler and claim queries
create index if not exists marketing_connector_sync_jobs_claim_idx
  on public.marketing_connector_sync_jobs (status, retry_after, created_at)
  where status in ('pending', 'running');

-- Index for workspace/connector concurrency checks and status lookups
create index if not exists marketing_connector_sync_jobs_workspace_connector_status_idx
  on public.marketing_connector_sync_jobs (workspace_id, connector_id, status);

-- Row Level Security
alter table public.marketing_connector_sync_jobs enable row level security;

-- Revoke all direct client access (both anon and authenticated)
-- Sync jobs are strictly server-only worker operations with service_role
revoke all on table public.marketing_connector_sync_jobs from public, anon;
revoke all on table public.marketing_connector_sync_jobs from authenticated;

-- Service role has full access
grant select, insert, update, delete on table public.marketing_connector_sync_jobs to service_role;

-- Atomic claim function with 15-minute lease and single-active collector guard
create or replace function public.claim_marketing_connector_sync_job(
  p_worker_id text,
  p_lease_duration_seconds integer default 900
) returns setof public.marketing_connector_sync_jobs as $$
declare
  v_job_id uuid;
begin
  select j.id into v_job_id
  from public.marketing_connector_sync_jobs j
  where (
    (j.status = 'pending' and (j.retry_after is null or j.retry_after <= clock_timestamp()))
    or (j.status = 'running' and j.lease_expires_at is not null and j.lease_expires_at < clock_timestamp())
  )
  and not exists (
    select 1
    from public.marketing_connector_sync_jobs running
    where running.workspace_id = j.workspace_id
      and running.connector_id = j.connector_id
      and running.status = 'running'
      and running.lease_expires_at is not null
      and running.lease_expires_at >= clock_timestamp()
      and running.id != j.id
  )
  order by j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is not null then
    return query
    update public.marketing_connector_sync_jobs
    set
      status = 'running',
      locked_by = p_worker_id,
      lease_expires_at = clock_timestamp() + (p_lease_duration_seconds || ' seconds')::interval,
      updated_at = clock_timestamp()
    where id = v_job_id
    returning *;
  end if;
end;
$$ language plpgsql security definer;
