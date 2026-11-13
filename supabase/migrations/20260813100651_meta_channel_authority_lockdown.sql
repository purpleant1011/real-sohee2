alter table public.channel_connections
  drop constraint channel_connections_status_check;
alter table public.channel_connections
  add constraint channel_connections_status_check check (
    status in (
      'disconnected', 'connecting', 'connected', 'expired',
      'missing_permission', 'wrong_account', 'provider_error', 'error'
    )
  );

alter table public.channel_connections
  add column token_expires_at timestamptz,
  add column webhook_status text not null default 'pending'
    check (webhook_status in ('pending', 'healthy', 'stale', 'error')),
  add column last_webhook_at timestamptz,
  add column last_provider_event_at timestamptz,
  add column last_error_code text
    check (last_error_code is null or char_length(last_error_code) <= 120);

drop policy if exists "workspace managers can insert channel connections"
  on public.channel_connections;
drop policy if exists "workspace managers can update channel connections"
  on public.channel_connections;
drop policy if exists "workspace owners can delete channel connections"
  on public.channel_connections;
revoke insert, update, delete on public.channel_connections from authenticated;

alter table public.operation_events
  drop constraint operation_events_event_type_check;
alter table public.operation_events
  add constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created', 'content.version.created', 'content.review.requested',
      'content.approved', 'content.approval.invalidated', 'schedule.suggested',
      'schedule.confirmed', 'publish.succeeded', 'publish.failed', 'report.snapshot.ready',
      'customer.conversation.needs_attention', 'knowledge.conflict.detected',
      'harness.rule.candidate_created', 'channel.response.created',
      'channel.response.approved', 'channel.response.sent', 'channel.response.failed',
      'channel.connection.connected', 'channel.connection.disconnected',
      'channel.connection.expired', 'channel.webhook.received',
      'publish.claimed', 'publish.lease_expired'
    )
  );

create table public.oauth_state_nonces (
  nonce_sha256 text primary key check (nonce_sha256 ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram', 'threads')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_state_nonces_expiry_idx
  on public.oauth_state_nonces (expires_at) where consumed_at is null;
alter table public.oauth_state_nonces enable row level security;
revoke all on public.oauth_state_nonces from public, anon, authenticated;
grant select, insert, update, delete on public.oauth_state_nonces to service_role;

create function public.register_oauth_state_nonce(
  p_nonce_sha256 text,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_nonce_sha256 !~ '^[a-f0-9]{64}$'
    or p_provider not in ('instagram', 'threads')
    or p_expires_at <= now()
    or p_expires_at > now() + interval '15 minutes'
    or not exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = p_actor_user_id
        and member.status = 'active'
        and member.role in ('owner', 'manager')
    ) then
    return false;
  end if;
  insert into public.oauth_state_nonces (
    nonce_sha256, workspace_id, actor_user_id, provider, expires_at
  ) values (
    p_nonce_sha256, p_workspace_id, p_actor_user_id, p_provider, p_expires_at
  );
  return true;
exception when unique_violation then
  return false;
end;
$$;

create function public.consume_oauth_state_nonce(
  p_nonce_sha256 text,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_provider text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed_digest text;
begin
  update public.oauth_state_nonces
  set consumed_at = statement_timestamp()
  where nonce_sha256 = p_nonce_sha256
    and workspace_id = p_workspace_id
    and actor_user_id = p_actor_user_id
    and provider = p_provider
    and consumed_at is null
    and expires_at > statement_timestamp()
  returning nonce_sha256 into consumed_digest;
  return consumed_digest is not null;
end;
$$;

create function public.disconnect_meta_channel(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_provider text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
begin
  if p_provider not in ('instagram', 'threads') or not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then return false; end if;

  select id into connection_id from public.channel_connections
  where workspace_id = p_workspace_id and channel = p_provider for update;
  if connection_id is null then return false; end if;
  delete from public.meta_channel_credentials
  where workspace_id = p_workspace_id and channel_connection_id = connection_id;
  update public.channel_connections
  set status = 'disconnected', external_account_id = null, account_label = null,
      token_expires_at = null, last_error_code = null
  where workspace_id = p_workspace_id and id = connection_id;
  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    p_workspace_id, 'channel.connection.disconnected',
    'channel.connection.disconnected:' || connection_id::text || ':' || extract(epoch from statement_timestamp())::bigint::text,
    'channel_connection', connection_id, jsonb_build_object('channel', p_provider), statement_timestamp()
  );
  return true;
end;
$$;

revoke all on function public.register_oauth_state_nonce(text, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_oauth_state_nonce(text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.disconnect_meta_channel(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_oauth_state_nonce(text, uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.consume_oauth_state_nonce(text, uuid, uuid, text)
  to service_role;
grant execute on function public.disconnect_meta_channel(uuid, uuid, text)
  to service_role;
