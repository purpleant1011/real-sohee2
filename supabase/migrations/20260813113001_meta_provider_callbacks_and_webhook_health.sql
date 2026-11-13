create function public.record_meta_webhook_health(
  p_workspace_id uuid,
  p_connection_id uuid,
  p_provider_event_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare updated_id uuid;
begin
  if p_provider_event_at is null
    or p_provider_event_at > statement_timestamp() + interval '10 minutes'
    or p_provider_event_at < statement_timestamp() - interval '365 days'
  then return false; end if;
  update public.channel_connections
  set webhook_status = 'healthy',
      last_webhook_at = statement_timestamp(),
      last_provider_event_at = greatest(coalesce(last_provider_event_at, p_provider_event_at), p_provider_event_at)
  where workspace_id = p_workspace_id
    and id = p_connection_id
    and channel in ('instagram', 'threads')
  returning id into updated_id;
  return updated_id is not null;
end;
$$;

create function public.disconnect_meta_channel_by_provider_account(
  p_provider text,
  p_external_account_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
  target_workspace_id uuid;
begin
  if p_provider not in ('instagram', 'threads')
    or p_reason not in ('provider_removal', 'provider_deletion')
    or p_external_account_id is null
    or char_length(p_external_account_id) not between 1 and 255
  then return false; end if;

  select connection.id, connection.workspace_id into connection_id, target_workspace_id
  from public.channel_connections as connection
  where connection.channel = p_provider
    and connection.external_account_id = p_external_account_id
  for update;

  if connection_id is null then return true; end if;

  delete from public.provider_webhook_events
  where provider_webhook_events.workspace_id = target_workspace_id
    and provider_webhook_events.channel_connection_id = connection_id;
  delete from public.meta_channel_credentials
  where meta_channel_credentials.workspace_id = target_workspace_id
    and meta_channel_credentials.channel_connection_id = connection_id;
  update public.channel_connections
  set status = 'disconnected', external_account_id = null, account_label = null,
      token_expires_at = null, webhook_status = 'pending', last_error_code = null
  where channel_connections.workspace_id = target_workspace_id and channel_connections.id = connection_id;
  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    target_workspace_id,
    'channel.connection.disconnected',
    'channel.connection.disconnected:' || connection_id::text || ':' || extract(epoch from statement_timestamp())::bigint::text,
    'channel_connection', connection_id,
    jsonb_build_object('channel', p_provider, 'reason', p_reason),
    statement_timestamp()
  );
  return true;
end;
$$;

revoke all on function public.record_meta_webhook_health(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.disconnect_meta_channel_by_provider_account(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_meta_webhook_health(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.disconnect_meta_channel_by_provider_account(text, text, text)
  to service_role;
