create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  request_origin text not null check (request_origin in ('authenticated', 'meta')),
  scope text not null check (scope in ('member', 'workspace', 'provider')),
  provider text check (provider is null or provider in ('instagram', 'threads')),
  external_subject_sha256 text check (
    external_subject_sha256 is null or external_subject_sha256 ~ '^[a-f0-9]{64}$'
  ),
  confirmation_code_sha256 text not null
    constraint data_deletion_requests_confirmation_code_check
    check (confirmation_code_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint data_deletion_requests_confirmation_code_key
    unique (confirmation_code_sha256),
  constraint data_deletion_requests_origin_scope_check check (
    (
      request_origin = 'authenticated'
      and scope in ('member', 'workspace')
      and provider is null
      and external_subject_sha256 is null
    ) or (
      request_origin = 'meta'
      and scope = 'provider'
      and provider is not null
      and external_subject_sha256 is not null
      and requested_by_user_id is null
    )
  ),
  constraint data_deletion_requests_completion_check check (
    (status in ('pending', 'in_progress') and completed_at is null)
    or (status in ('completed', 'rejected') and completed_at is not null)
  )
);

create index data_deletion_requests_operations_idx
  on public.data_deletion_requests (status, requested_at, id)
  where status in ('pending', 'in_progress');
create index data_deletion_requests_workspace_idx
  on public.data_deletion_requests (workspace_id, requested_at desc)
  where workspace_id is not null;
create index data_deletion_requests_requester_idx
  on public.data_deletion_requests (requested_by_user_id, requested_at desc)
  where requested_by_user_id is not null;

create trigger data_deletion_requests_set_updated_at
before update on public.data_deletion_requests
for each row execute function private.set_updated_at();

alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from public, anon, authenticated;
grant select, insert, update, delete on public.data_deletion_requests to service_role;

create function public.create_data_deletion_request(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_scope text,
  p_confirmation_code_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  actor_role text;
begin
  if p_scope not in ('member', 'workspace')
    or p_confirmation_code_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'DATA_DELETION_REQUEST_INVALID';
  end if;

  select member.role into actor_role
  from public.workspace_members as member
  where member.workspace_id = p_workspace_id
    and member.user_id = p_actor_user_id
    and member.status = 'active';

  if actor_role is null or (p_scope = 'workspace' and actor_role <> 'owner') then
    raise exception 'DATA_DELETION_FORBIDDEN';
  end if;

  insert into public.data_deletion_requests (
    workspace_id, requested_by_user_id, request_origin, scope,
    confirmation_code_sha256
  ) values (
    p_workspace_id, p_actor_user_id, 'authenticated', p_scope,
    p_confirmation_code_sha256
  )
  returning id into request_id;

  return request_id;
exception
  when unique_violation then
    raise exception 'DATA_DELETION_CONFIRMATION_REUSED';
end;
$$;

create function public.request_meta_data_deletion(
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

  if not public.disconnect_meta_channel_by_provider_account(
    p_provider, p_external_account_id, 'provider_deletion'
  ) then
    raise exception 'META_DATA_DELETION_FAILED';
  end if;

  update public.data_deletion_requests
  set status = 'completed', completed_at = statement_timestamp()
  where id = request_id;

  return request_id;
exception
  when unique_violation then
    raise exception 'DATA_DELETION_CONFIRMATION_REUSED';
end;
$$;

create function public.get_data_deletion_request_status(
  p_confirmation_code_sha256 text
)
returns table (
  status text,
  request_origin text,
  scope text,
  provider text,
  requested_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.status,
    request.request_origin,
    request.scope,
    request.provider,
    request.requested_at,
    request.updated_at,
    request.completed_at
  from public.data_deletion_requests as request
  where p_confirmation_code_sha256 ~ '^[a-f0-9]{64}$'
    and request.confirmation_code_sha256 = p_confirmation_code_sha256;
$$;

create function public.claim_data_deletion_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  update public.data_deletion_requests
  set status = 'in_progress', claimed_at = statement_timestamp()
  where id = p_request_id and status = 'pending'
  returning id into claimed_id;
  return claimed_id is not null;
end;
$$;

create function public.resolve_data_deletion_request(
  p_request_id uuid,
  p_resolution text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_id uuid;
begin
  if p_resolution not in ('completed', 'rejected') then return false; end if;
  update public.data_deletion_requests
  set status = p_resolution, completed_at = statement_timestamp()
  where id = p_request_id and status in ('pending', 'in_progress')
  returning id into resolved_id;
  return resolved_id is not null;
end;
$$;

revoke all on function public.create_data_deletion_request(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.request_meta_data_deletion(text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_data_deletion_request_status(text)
  from public, anon, authenticated;
revoke all on function public.claim_data_deletion_request(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_data_deletion_request(uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_data_deletion_request(uuid, uuid, text, text)
  to service_role;
grant execute on function public.request_meta_data_deletion(text, text, text)
  to service_role;
grant execute on function public.get_data_deletion_request_status(text)
  to service_role;
grant execute on function public.claim_data_deletion_request(uuid)
  to service_role;
grant execute on function public.resolve_data_deletion_request(uuid, text)
  to service_role;
