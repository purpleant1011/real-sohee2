create index meta_channel_credentials_connection_fkey_idx
  on public.meta_channel_credentials (workspace_id, channel_connection_id);

create index provider_webhook_events_connection_fkey_idx
  on public.provider_webhook_events (workspace_id, channel_connection_id);

create index channel_response_jobs_event_fkey_idx
  on public.channel_response_jobs (workspace_id, inbound_event_id);

create index channel_response_jobs_connection_fkey_idx
  on public.channel_response_jobs (workspace_id, channel_connection_id);

create index channel_response_jobs_approved_by_fkey_idx
  on public.channel_response_jobs (approved_by)
  where approved_by is not null;

create index channel_delivery_attempts_response_fkey_idx
  on public.channel_delivery_attempts (workspace_id, response_job_id);

alter function public.list_channel_interactions(uuid) set schema private;
alter function private.list_channel_interactions(uuid)
  rename to list_channel_interactions_internal;

revoke all on function private.list_channel_interactions_internal(uuid)
  from public, anon;
grant execute on function private.list_channel_interactions_internal(uuid)
  to authenticated;

create function public.list_channel_interactions(p_workspace_id uuid)
returns table (
  event_id uuid,
  provider text,
  category text,
  occurred_at timestamptz,
  inbound_text text,
  response_job_id uuid,
  response_kind text,
  response_text text,
  response_status text,
  response_approved_at timestamptz,
  response_provider_reference text,
  delivery_status text,
  delivery_error_code text,
  content_id uuid,
  content_version_id uuid,
  content_title text,
  schedule_id uuid,
  publish_at timestamptz,
  schedule_status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.list_channel_interactions_internal(p_workspace_id);
$$;

revoke all on function public.list_channel_interactions(uuid) from public, anon;
grant execute on function public.list_channel_interactions(uuid) to authenticated;
