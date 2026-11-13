create function private.save_meta_channel_connection_internal(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_external_account_id text,
  p_account_label text,
  p_encrypted_access_token text,
  p_access_token_iv text,
  p_granted_scopes text[],
  p_token_expires_at timestamptz,
  p_refresh_after timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
begin
  if p_provider not in ('instagram', 'threads') then
    raise exception 'INVALID_PROVIDER';
  end if;
  if not exists (
    select 1
    from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.channel_connections (
    workspace_id, channel, status, account_label, external_account_id
  ) values (
    p_workspace_id, p_provider, 'connected', p_account_label, p_external_account_id
  )
  on conflict (workspace_id, channel) do update
  set status = 'connected',
      account_label = excluded.account_label,
      external_account_id = excluded.external_account_id
  returning id into connection_id;

  insert into public.meta_channel_credentials (
    workspace_id, channel_connection_id, provider,
    encrypted_access_token, access_token_iv, encryption_algorithm,
    granted_scopes, token_expires_at, refresh_after, status, last_error_code
  ) values (
    p_workspace_id, connection_id, p_provider,
    p_encrypted_access_token, p_access_token_iv, 'AES-GCM-256',
    coalesce(p_granted_scopes, '{}'::text[]), p_token_expires_at, p_refresh_after,
    'active', null
  )
  on conflict (channel_connection_id) do update
  set provider = excluded.provider,
      encrypted_access_token = excluded.encrypted_access_token,
      access_token_iv = excluded.access_token_iv,
      encryption_algorithm = excluded.encryption_algorithm,
      granted_scopes = excluded.granted_scopes,
      token_expires_at = excluded.token_expires_at,
      refresh_after = excluded.refresh_after,
      status = 'active',
      last_error_code = null;

  return connection_id;
end;
$$;

create function public.save_meta_channel_connection(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_external_account_id text,
  p_account_label text,
  p_encrypted_access_token text,
  p_access_token_iv text,
  p_granted_scopes text[],
  p_token_expires_at timestamptz,
  p_refresh_after timestamptz
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.save_meta_channel_connection_internal(
    p_workspace_id, p_actor_user_id, p_provider, p_external_account_id,
    p_account_label, p_encrypted_access_token, p_access_token_iv,
    p_granted_scopes, p_token_expires_at, p_refresh_after
  );
$$;

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
  token_expires_at timestamptz
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
    credential.token_expires_at
  from public.meta_channel_credentials as credential
  join public.channel_connections as connection
    on connection.workspace_id = credential.workspace_id
   and connection.id = credential.channel_connection_id
  where credential.workspace_id = p_workspace_id
    and credential.channel_connection_id = p_connection_id
    and credential.status = 'active'
    and connection.status = 'connected';
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
  token_expires_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.load_meta_channel_credential_internal(p_workspace_id, p_connection_id);
$$;

revoke all on function private.save_meta_channel_connection_internal(
  uuid, uuid, text, text, text, text, text, text[], timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.save_meta_channel_connection(
  uuid, uuid, text, text, text, text, text, text[], timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_meta_channel_connection(
  uuid, uuid, text, text, text, text, text, text[], timestamptz, timestamptz
) to service_role;

revoke all on function private.load_meta_channel_credential_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.load_meta_channel_credential(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_meta_channel_credential(uuid, uuid)
  to service_role;

create function private.load_approved_meta_publish_payload_internal(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', schedule.workspace_id,
    'content_id', schedule.content_id,
    'schedule_id', schedule.id,
    'schedule_status', schedule.status,
    'version_id', version.id,
    'current_version_id', content.current_version_id,
    'approval_version_id', approval.version_id,
    'version_fingerprint', version.fingerprint,
    'approval_fingerprint', approval.fingerprint,
    'approval_status', approval.status,
    'disclosure_confirmed', approval.disclosure_confirmed,
    'rights_confirmed', approval.rights_confirmed,
    'connection_status', connection.status,
    'channel', content.channel,
    'connection_channel', connection.channel,
    'external_account_id', connection.external_account_id,
    'caption', version.caption,
    'hashtags', to_jsonb(version.hashtags),
    'disclosure', version.disclosure,
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', link.position,
        'media_asset_id', link.media_asset_id,
        'bucket_id', asset.bucket_id,
        'object_path', asset.object_path,
        'mime_type', asset.mime_type,
        'rights_status', asset.rights_status
      ) order by link.position)
      from public.content_version_media as link
      join public.media_assets as asset
        on asset.workspace_id = link.workspace_id
       and asset.id = link.media_asset_id
      where link.workspace_id = schedule.workspace_id
        and link.version_id = version.id
    ), '[]'::jsonb)
  )
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
   and content.current_version_id = schedule.version_id
  join public.content_versions as version
    on version.workspace_id = schedule.workspace_id
   and version.id = schedule.version_id
  join public.approvals as approval
    on approval.workspace_id = schedule.workspace_id
   and approval.id = schedule.approval_id
   and approval.content_id = schedule.content_id
   and approval.version_id = version.id
   and approval.fingerprint = version.fingerprint
   and approval.status = 'approved'
   and approval.disclosure_confirmed
   and approval.rights_confirmed
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
   and connection.id = schedule.channel_connection_id
   and connection.channel = content.channel
   and connection.status = 'connected'
   and connection.external_account_id is not null
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'publishing';
$$;

create function public.load_approved_meta_publish_payload(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.load_approved_meta_publish_payload_internal(p_workspace_id, p_schedule_id);
$$;

revoke all on function private.load_approved_meta_publish_payload_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.load_approved_meta_publish_payload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_approved_meta_publish_payload(uuid, uuid)
  to service_role;
