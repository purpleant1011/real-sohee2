create table public.operator_support_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  operator_user_id uuid not null references auth.users(id) on delete restrict,
  mode text not null default 'view_only' check (mode = 'view_only'),
  status text not null default 'active' check (status in ('active', 'ended', 'expired', 'revoked')),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  close_reason text check (close_reason is null or char_length(close_reason) between 1 and 2000 and close_reason = btrim(close_reason)),
  idempotency_key uuid not null unique,
  end_idempotency_key uuid unique,
  expire_idempotency_key uuid unique,
  revoke_idempotency_key uuid unique,
  started_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  closed_at timestamptz,
  constraint operator_support_sessions_exact_ttl check (expires_at = started_at + interval '30 minutes'),
  constraint operator_support_sessions_view_only check (mode = 'view_only'),
  constraint operator_support_sessions_state_fields check (
    (status = 'active' and ended_at is null and closed_at is null)
    or (status in ('ended', 'expired', 'revoked') and closed_at is not null)
  )
);

create index operator_support_sessions_workspace_idx
  on public.operator_support_sessions(workspace_id, started_at desc, id);
create index operator_support_sessions_operator_idx
  on public.operator_support_sessions(operator_user_id, started_at desc, id);

alter table public.operator_support_sessions enable row level security;
revoke all on public.operator_support_sessions from public, anon, authenticated;
grant select, insert, update on public.operator_support_sessions to service_role;

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested', 'agreement.verify.approved',
  'channel.disconnect.requested', 'channel.disconnect.approved',
  'publish.retry.requested', 'publish.retry.approved', 'publish.retry.applied',
  'credit.adjust.requested', 'credit.adjust.approved', 'credit.adjust.applied',
  'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
  'admin.role.change.global.requested', 'admin.role.change.global.approved',
  'audit.export.workspace.requested', 'audit.export.workspace.approved',
  'audit.export.global.requested', 'audit.export.global.approved',
  'admin.account.activated', 'workspace.activation.requested',
  'document.version.draft_created', 'document.version.reviewed', 'document.version.activated',
  'support.session.started', 'support.session.ended', 'support.session.expired', 'support.session.revoked'
));

create or replace function public.start_operator_support_session(
  p_workspace_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  normalized_reason text := btrim(coalesce(p_reason, ''));
  existing public.operator_support_sessions%rowtype;
  created public.operator_support_sessions%rowtype;
  audit_key text;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  if p_workspace_id is null or not private.has_platform_permission('workspace.support_session.create', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) or char_length(normalized_reason) not between 1 and 2000 or p_idempotency_key is null then raise exception 'SUPPORT_SESSION_INPUT_INVALID' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support-session:' || p_idempotency_key::text, 0));
  select * into existing from public.operator_support_sessions where idempotency_key = p_idempotency_key;
  if found then
    if existing.workspace_id <> p_workspace_id or existing.operator_user_id <> actor_id or existing.reason <> normalized_reason then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001'; end if;
    return jsonb_build_object('session_id', existing.id, 'workspace_id', existing.workspace_id, 'mode', existing.mode, 'status', case when existing.status = 'active' and existing.expires_at <= statement_timestamp() then 'expired' else existing.status end, 'reason', existing.reason, 'started_at', existing.started_at, 'expires_at', existing.expires_at, 'replayed', true);
  end if;
  insert into public.operator_support_sessions(workspace_id, operator_user_id, mode, status, reason, idempotency_key, started_at, expires_at)
  values (p_workspace_id, actor_id, 'view_only', 'active', normalized_reason, p_idempotency_key, statement_timestamp(), statement_timestamp() + interval '30 minutes')
  returning * into created;
  audit_key := encode(extensions.digest('support-start:' || p_idempotency_key::text, 'sha256'), 'hex');
  perform private.append_platform_audit_event(actor_id, p_workspace_id, 'support.session.started', 'operator_support_session', created.id::text, normalized_reason, p_idempotency_key::text, 'succeeded', '{}'::jsonb, jsonb_build_object('mode', created.mode, 'status', created.status, 'expires_at', created.expires_at), audit_key, 'observed', null, null);
  return jsonb_build_object('session_id', created.id, 'workspace_id', created.workspace_id, 'mode', created.mode, 'status', created.status, 'reason', created.reason, 'started_at', created.started_at, 'expires_at', created.expires_at, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_SCOPE_DENIED','SUPPORT_SESSION_INPUT_INVALID','IDEMPOTENCY_CONFLICT') then raise; end if;
  raise exception 'SUPPORT_SESSION_WRITE_UNAVAILABLE' using errcode = 'P0001';
end;
$$;

create or replace function public.end_operator_support_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); session_row public.operator_support_sessions%rowtype;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  select * into session_row from public.operator_support_sessions where id = p_session_id for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if not private.has_platform_permission('workspace.support_session.create', session_row.workspace_id) or session_row.operator_user_id <> actor_id then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  if p_idempotency_key is null then raise exception 'SUPPORT_SESSION_INPUT_INVALID' using errcode = 'P0001'; end if;
  if session_row.status <> 'active' then
    if session_row.status = 'ended' and session_row.end_idempotency_key = p_idempotency_key then return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', true); end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  if session_row.expires_at <= statement_timestamp() then raise exception 'SUPPORT_SESSION_EXPIRED' using errcode = 'P0001'; end if;
  update public.operator_support_sessions set status = 'ended', ended_at = statement_timestamp(), closed_at = statement_timestamp(), end_idempotency_key = p_idempotency_key where id = session_row.id returning * into session_row;
  perform private.append_platform_audit_event(actor_id, session_row.workspace_id, 'support.session.ended', 'operator_support_session', session_row.id::text, session_row.reason, p_idempotency_key::text, 'succeeded', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'ended', 'closed_at', session_row.closed_at), encode(extensions.digest('support-end:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','SUPPORT_SESSION_NOT_FOUND','OPERATOR_SCOPE_DENIED','SUPPORT_SESSION_INPUT_INVALID','SUPPORT_SESSION_EXPIRED','IDEMPOTENCY_CONFLICT') then raise; end if;
  raise exception 'SUPPORT_SESSION_WRITE_UNAVAILABLE' using errcode = 'P0001';
end; $$;

create or replace function public.revoke_operator_support_session(p_session_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); session_row public.operator_support_sessions%rowtype; normalized_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  select * into session_row from public.operator_support_sessions where id = p_session_id for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_idempotency_key is null or char_length(normalized_reason) not between 1 and 2000 then raise exception 'SUPPORT_SESSION_INPUT_INVALID' using errcode = 'P0001'; end if;
  if not private.has_platform_permission('workspace.support_session.create', session_row.workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  if session_row.status <> 'active' then
    if session_row.status = 'revoked' and session_row.revoke_idempotency_key = p_idempotency_key then return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', true); end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  update public.operator_support_sessions set status = 'revoked', close_reason = normalized_reason, closed_at = statement_timestamp(), revoke_idempotency_key = p_idempotency_key where id = session_row.id returning * into session_row;
  perform private.append_platform_audit_event(actor_id, session_row.workspace_id, 'support.session.revoked', 'operator_support_session', session_row.id::text, normalized_reason, p_idempotency_key::text, 'succeeded', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'revoked', 'close_reason', normalized_reason), encode(extensions.digest('support-revoke:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','SUPPORT_SESSION_NOT_FOUND','OPERATOR_SCOPE_DENIED','SUPPORT_SESSION_INPUT_INVALID','IDEMPOTENCY_CONFLICT') then raise; end if;
  raise exception 'SUPPORT_SESSION_WRITE_UNAVAILABLE' using errcode = 'P0001';
end; $$;

create or replace function public.expire_operator_support_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); session_row public.operator_support_sessions%rowtype;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  select * into session_row from public.operator_support_sessions where id = p_session_id for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if p_idempotency_key is null then raise exception 'SUPPORT_SESSION_INPUT_INVALID' using errcode = 'P0001'; end if;
  if not private.has_platform_permission('workspace.support_session.create', session_row.workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  if session_row.status <> 'active' then
    if session_row.status = 'expired' and session_row.expire_idempotency_key = p_idempotency_key then return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', true); end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  if session_row.expires_at > statement_timestamp() then raise exception 'SUPPORT_SESSION_NOT_EXPIRED' using errcode = 'P0001'; end if;
  update public.operator_support_sessions set status = 'expired', closed_at = statement_timestamp(), expire_idempotency_key = p_idempotency_key where id = session_row.id returning * into session_row;
  perform private.append_platform_audit_event(actor_id, session_row.workspace_id, 'support.session.expired', 'operator_support_session', session_row.id::text, session_row.reason, p_idempotency_key::text, 'succeeded', jsonb_build_object('status', 'active'), jsonb_build_object('status', 'expired'), encode(extensions.digest('support-expire:' || p_idempotency_key::text, 'sha256'), 'hex'), 'observed', null, null);
  return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'replayed', false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','SUPPORT_SESSION_NOT_FOUND','OPERATOR_SCOPE_DENIED','SUPPORT_SESSION_INPUT_INVALID','IDEMPOTENCY_CONFLICT','SUPPORT_SESSION_NOT_EXPIRED') then raise; end if;
  raise exception 'SUPPORT_SESSION_WRITE_UNAVAILABLE' using errcode = 'P0001';
end; $$;

create or replace function public.list_operator_support_sessions(p_workspace_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); rows jsonb;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED' using errcode = 'P0001'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_workspace_id is not null and not private.has_platform_permission('workspace.support_session.create', p_workspace_id)) then raise exception 'OPERATOR_SCOPE_DENIED' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('session_id', session.id, 'workspace_id', session.workspace_id, 'operator_user_id', session.operator_user_id, 'mode', session.mode, 'status', case when session.status = 'active' and session.expires_at <= statement_timestamp() then 'expired' else session.status end, 'reason', session.reason, 'close_reason', session.close_reason, 'started_at', session.started_at, 'expires_at', session.expires_at, 'closed_at', session.closed_at) order by session.started_at desc, session.id desc), '[]'::jsonb) into rows
  from public.operator_support_sessions session
  where (p_workspace_id is null or session.workspace_id = p_workspace_id)
    and private.has_platform_permission('workspace.support_session.create', session.workspace_id)
    and (session.operator_user_id = actor_id or private.has_platform_permission('workspace.support_session.create', session.workspace_id));
  return rows;
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_SCOPE_DENIED') then raise; end if;
  raise exception 'SUPPORT_SESSION_READ_UNAVAILABLE' using errcode = 'P0001';
end; $$;

revoke all on function public.start_operator_support_session(uuid,text,uuid), public.end_operator_support_session(uuid,uuid), public.revoke_operator_support_session(uuid,text,uuid), public.expire_operator_support_session(uuid,uuid), public.list_operator_support_sessions(uuid,integer) from public, anon, service_role;
grant execute on function public.start_operator_support_session(uuid,text,uuid), public.end_operator_support_session(uuid,uuid), public.revoke_operator_support_session(uuid,text,uuid), public.expire_operator_support_session(uuid,uuid), public.list_operator_support_sessions(uuid,integer) to authenticated;
