create or replace function public.request_meta_data_deletion(
  p_provider text,
  p_external_account_id text,
  p_confirmation_code_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  target_workspace_id uuid;
begin
  if p_provider not in ('instagram', 'threads')
    or p_external_account_id is null
    or char_length(p_external_account_id) not between 1 and 255
    or p_confirmation_code_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'META_DATA_DELETION_REQUEST_INVALID';
  end if;

  select connection.workspace_id into target_workspace_id
  from public.channel_connections as connection
  where connection.channel = p_provider
    and connection.external_account_id = p_external_account_id;

  insert into public.data_deletion_requests (
    workspace_id, request_origin, scope, provider,
    external_subject_sha256, confirmation_code_sha256
  ) values (
    target_workspace_id, 'meta', 'provider', p_provider,
    encode(extensions.digest(p_provider || ':' || p_external_account_id, 'sha256'), 'hex'),
    p_confirmation_code_sha256
  )
  returning id into request_id;

  return request_id;
exception
  when unique_violation then
    raise exception 'DATA_DELETION_CONFIRMATION_REUSED';
end;
$$;

comment on function public.request_meta_data_deletion(text, text, text) is
  'Queues a signed Meta data-deletion request for manual review without disconnecting channels or deleting credentials.';

revoke all on function public.request_meta_data_deletion(text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_meta_data_deletion(text, text, text)
  to service_role;
