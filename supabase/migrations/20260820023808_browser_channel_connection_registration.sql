create function public.register_browser_channel_connection(
  p_workspace_id uuid,
  p_device_id uuid,
  p_channel text,
  p_external_account_label text,
  p_target_external_id text,
  p_target_url text,
  p_environment text,
  p_target_fingerprint text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare connection_id uuid;
begin
  if p_channel not in ('naver_blog', 'daangn_business')
    or p_environment not in ('test', 'production')
    or p_target_fingerprint !~ '^[a-f0-9]{64}$'
    or char_length(p_external_account_label) not between 1 and 255
    or char_length(p_target_external_id) not between 1 and 255
    or char_length(p_target_url) not between 1 and 2048
    or (p_channel = 'naver_blog' and p_target_url not like 'https://blog.naver.com/%')
    or (p_channel = 'daangn_business' and p_target_url not like 'https://business.daangn.com/%')
    or not exists (
      select 1 from public.connector_devices as device
      where device.workspace_id = p_workspace_id and device.id = p_device_id and device.status = 'active'
    ) then
    raise exception 'BROWSER_CONNECTION_INVALID';
  end if;

  insert into public.browser_channel_connections (
    workspace_id, device_id, channel, external_account_label, target_external_id,
    target_url, target_fingerprint, environment, status, verified_at, last_seen_at
  ) values (
    p_workspace_id, p_device_id, p_channel, p_external_account_label, p_target_external_id,
    p_target_url, p_target_fingerprint, p_environment, 'connected', statement_timestamp(), statement_timestamp()
  )
  on conflict (workspace_id, channel, target_fingerprint, environment)
  do update set
    device_id = excluded.device_id,
    external_account_label = excluded.external_account_label,
    target_external_id = excluded.target_external_id,
    target_url = excluded.target_url,
    status = 'connected',
    verified_at = statement_timestamp(),
    last_seen_at = statement_timestamp()
  returning id into connection_id;
  return connection_id;
end;
$$;

revoke all on function public.register_browser_channel_connection(uuid,uuid,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.register_browser_channel_connection(uuid,uuid,text,text,text,text,text,text)
  to service_role;
