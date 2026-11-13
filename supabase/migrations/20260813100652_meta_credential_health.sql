alter table public.meta_channel_credentials
  add column key_version smallint not null default 1 check (key_version > 0);

drop function public.load_meta_channel_credential(uuid, uuid);
drop function private.load_meta_channel_credential_internal(uuid, uuid);

create function private.load_meta_channel_credential_internal(
  p_workspace_id uuid,
  p_connection_id uuid
)
returns table (
  workspace_id uuid,
  connection_id uuid,
  provider text,
  external_account_id text,
  encrypted_access_token text,
  access_token_iv text,
  encryption_algorithm text,
  status text,
  token_expires_at timestamptz,
  granted_scopes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    credential.workspace_id,
    connection.id,
    credential.provider,
    connection.external_account_id,
    credential.encrypted_access_token,
    credential.access_token_iv,
    credential.encryption_algorithm,
    credential.status,
    credential.token_expires_at,
    credential.granted_scopes
  from public.meta_channel_credentials as credential
  join public.channel_connections as connection
    on connection.workspace_id = credential.workspace_id
   and connection.id = credential.channel_connection_id
   and connection.channel = credential.provider
  where credential.workspace_id = p_workspace_id
    and credential.channel_connection_id = p_connection_id
    and credential.status = 'active'
    and connection.status = 'connected'
    and connection.external_account_id is not null
    and (
      credential.token_expires_at is null
      or credential.token_expires_at > statement_timestamp() + interval '5 minutes'
    )
    and case credential.provider
      when 'instagram' then array[
        'instagram_business_basic', 'instagram_business_content_publish',
        'instagram_business_manage_comments', 'instagram_business_manage_messages',
        'instagram_business_manage_insights'
      ]::text[] <@ credential.granted_scopes
      when 'threads' then array[
        'threads_basic', 'threads_content_publish',
        'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights'
      ]::text[] <@ credential.granted_scopes
      else false
    end;
$$;

create function public.load_meta_channel_credential(
  p_workspace_id uuid,
  p_connection_id uuid
)
returns table (
  workspace_id uuid,
  connection_id uuid,
  provider text,
  external_account_id text,
  encrypted_access_token text,
  access_token_iv text,
  encryption_algorithm text,
  status text,
  token_expires_at timestamptz,
  granted_scopes text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.load_meta_channel_credential_internal(p_workspace_id, p_connection_id);
$$;

revoke all on function private.load_meta_channel_credential_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.load_meta_channel_credential(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_meta_channel_credential(uuid, uuid)
  to service_role;

create function private.sync_meta_connection_health()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channel_connections
  set status = case when new.status = 'active' then 'connected' else status end,
      token_expires_at = new.token_expires_at,
      last_error_code = new.last_error_code
  where workspace_id = new.workspace_id and id = new.channel_connection_id;
  if new.status = 'active' then
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
    ) values (
      new.workspace_id, 'channel.connection.connected',
      'channel.connection.connected:' || new.channel_connection_id::text || ':' || extract(epoch from statement_timestamp())::bigint::text,
      'channel_connection', new.channel_connection_id,
      jsonb_build_object('channel', new.provider), statement_timestamp()
    );
  end if;
  return new;
end;
$$;

create trigger meta_channel_credentials_sync_connection_health
after insert or update of status, token_expires_at, last_error_code
on public.meta_channel_credentials
for each row execute function private.sync_meta_connection_health();

revoke all on function private.sync_meta_connection_health()
  from public, anon, authenticated;

create function public.mark_meta_channel_unavailable(
  p_workspace_id uuid,
  p_connection_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_name text;
begin
  if p_error_code not in ('TOKEN_EXPIRED', 'MISSING_PERMISSION', 'WRONG_ACCOUNT', 'PROVIDER_ERROR')
  then return false; end if;
  select channel into provider_name from public.channel_connections
  where workspace_id = p_workspace_id and id = p_connection_id and channel in ('instagram', 'threads')
  for update;
  if provider_name is null then return false; end if;
  update public.meta_channel_credentials
  set status = case when p_error_code = 'TOKEN_EXPIRED' then 'refresh_required' else 'error' end,
      last_error_code = p_error_code
  where workspace_id = p_workspace_id and channel_connection_id = p_connection_id;
  update public.channel_connections
  set status = case p_error_code
        when 'TOKEN_EXPIRED' then 'expired'
        when 'MISSING_PERMISSION' then 'missing_permission'
        when 'WRONG_ACCOUNT' then 'wrong_account'
        else 'provider_error' end,
      last_error_code = p_error_code
  where workspace_id = p_workspace_id and id = p_connection_id;
  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    p_workspace_id, 'channel.connection.expired',
    'channel.connection.expired:' || p_connection_id::text || ':' || extract(epoch from statement_timestamp())::bigint::text,
    'channel_connection', p_connection_id,
    jsonb_build_object('channel', provider_name, 'errorCode', p_error_code), statement_timestamp()
  );
  return true;
end;
$$;

revoke all on function public.mark_meta_channel_unavailable(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_meta_channel_unavailable(uuid, uuid, text)
  to service_role;
