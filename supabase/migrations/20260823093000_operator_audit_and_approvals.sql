create table public.admin_approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete restrict,
  action_type text not null check (action_type in (
    'agreement.verify',
    'channel.disconnect',
    'publish.retry',
    'credit.adjust',
    'admin.role.change.workspace',
    'admin.role.change.global',
    'audit.export.workspace',
    'audit.export.global'
  )),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id text not null check (char_length(target_id) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  requested_by uuid not null references auth.users (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete restrict,
  status text not null check (status in ('pending', 'approved', 'rejected', 'applied', 'cancelled', 'expired')),
  expected_version bigint check (expected_version is null or expected_version >= 0),
  request_payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(request_payload) = 'object'
    and octet_length(request_payload::text) <= 16000
  ),
  result_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(result_summary) = 'object'
    and octet_length(result_summary::text) <= 16000
  ),
  semantic_fingerprint text not null check (semantic_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  approved_at timestamptz,
  applied_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  constraint admin_approval_exact_expiry check (expires_at = requested_at + interval '24 hours'),
  constraint admin_approval_task3_state_fields check (
    (status = 'pending' and approved_by is null and approved_at is null)
    or (status in ('approved', 'applied') and approved_by is not null and approved_at is not null)
    or status in ('rejected', 'cancelled', 'expired')
  )
);

create table public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  workspace_id uuid references public.workspaces (id) on delete restrict,
  action text not null check (action in (
    'agreement.verify.requested', 'agreement.verify.approved',
    'channel.disconnect.requested', 'channel.disconnect.approved',
    'publish.retry.requested', 'publish.retry.approved',
    'credit.adjust.requested', 'credit.adjust.approved',
    'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
    'admin.role.change.global.requested', 'admin.role.change.global.approved',
    'audit.export.workspace.requested', 'audit.export.workspace.approved',
    'audit.export.global.requested', 'audit.export.global.approved'
  )),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id text not null check (char_length(target_id) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  request_id text not null check (char_length(request_id) between 1 and 128),
  result text not null check (result in ('succeeded', 'failed', 'denied')),
  fact_kind text not null check (fact_kind in ('observed', 'user_claim', 'inference', 'unknown')),
  before jsonb not null default '{}'::jsonb check (
    jsonb_typeof(before) = 'object' and octet_length(before::text) <= 16000
  ),
  after jsonb not null default '{}'::jsonb check (
    jsonb_typeof(after) = 'object' and octet_length(after::text) <= 16000
  ),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  approval_request_id uuid references public.admin_approval_requests (id) on delete restrict,
  actor_role_snapshot jsonb check (
    actor_role_snapshot is null
    or (jsonb_typeof(actor_role_snapshot) = 'object' and octet_length(actor_role_snapshot::text) <= 16000)
  ),
  created_at timestamptz not null default statement_timestamp()
);

create index admin_approval_requests_workspace_requested_idx
  on public.admin_approval_requests (workspace_id, requested_at desc, id);
create index admin_approval_requests_status_expires_idx
  on public.admin_approval_requests (status, expires_at, id)
  where status in ('pending', 'approved');
create index platform_audit_events_workspace_created_idx
  on public.platform_audit_events (workspace_id, created_at desc, id);
create index platform_audit_events_approval_idx
  on public.platform_audit_events (approval_request_id, created_at, id)
  where approval_request_id is not null;

alter table public.admin_approval_requests enable row level security;
alter table public.platform_audit_events enable row level security;

revoke all on public.admin_approval_requests from public, anon, authenticated;
revoke all on public.platform_audit_events from public, anon, authenticated;
grant select on public.admin_approval_requests to service_role;
grant select on public.platform_audit_events to service_role;

create or replace function private.prevent_platform_audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'PLATFORM_AUDIT_IMMUTABLE';
end;
$$;

create trigger platform_audit_events_immutable
before update or delete on public.platform_audit_events
for each row execute function private.prevent_platform_audit_change();

create or replace function private.prevent_admin_approval_expiry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'APPROVAL_EXPIRY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger admin_approval_requests_immutable_expiry
before update on public.admin_approval_requests
for each row execute function private.prevent_admin_approval_expiry_change();

create or replace function private.lock_platform_owner_quorum()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-owner-quorum', 0)
  );
end;
$$;

create or replace function private.require_current_operator_aal2_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if claims is null or jsonb_typeof(claims) <> 'object' then
    raise exception 'MFA_REQUIRED';
  end if;
  if claims ->> 'sub' is distinct from actor_id::text then
    raise exception 'AUTH_REQUIRED';
  end if;
  if claims ->> 'aal' is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED';
  end if;
  return actor_id;
end;
$$;

create or replace function private.admin_audit_value_is_safe(p_value jsonb, p_depth integer default 0)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  item record;
  text_value text;
  normalized_key text;
begin
  if p_value is null or p_depth > 6 or octet_length(p_value::text) > 16000 then
    return false;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      if (select count(*) from jsonb_object_keys(p_value)) > 64 then
        return false;
      end if;
      for item in select key, value from jsonb_each(p_value)
      loop
        normalized_key := lower(regexp_replace(item.key, '[^a-zA-Z0-9]', '', 'g'));
        if normalized_key in (
          'password', 'secret', 'token', 'accesstoken', 'refreshtoken', 'cookie',
          'authorization', 'invitelink', 'recoverycode', 'exactpayload', 'providerbody',
          'message', 'details', 'hint', 'stack'
        ) then
          return false;
        end if;
        if not private.admin_audit_value_is_safe(item.value, p_depth + 1) then
          return false;
        end if;
      end loop;
    when 'array' then
      if jsonb_array_length(p_value) > 64 then
        return false;
      end if;
      for item in select value from jsonb_array_elements(p_value)
      loop
        if not private.admin_audit_value_is_safe(item.value, p_depth + 1) then
          return false;
        end if;
      end loop;
    when 'string' then
      text_value := p_value #>> '{}';
      if char_length(text_value) > 2000
        or text_value ~ '[[:cntrl:]]'
        or text_value ~ '[‪-‮⁦-⁩]'
        or text_value ~* '\mbearer[[:space:]]+[^[:space:]]+'
        or text_value ~ '\meyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\M'
        or text_value ~* 'https?://[^[:space:]/:]+:[^[:space:]/@]+@'
        or text_value ~* 'https?://[^[:space:]]+(access[_-]?token|refresh[_-]?token|secret|password|invite[_-]?link|recovery[_-]?code)='
        or text_value ~* '\m(sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9_-]+)\M'
      then
        return false;
      end if;
    when 'number', 'boolean', 'null' then
      null;
    else
      return false;
  end case;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.append_platform_audit_event(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_request_id text,
  p_result text,
  p_before jsonb,
  p_after jsonb,
  p_idempotency_key text,
  p_fact_kind text,
  p_approval_request_id uuid,
  p_actor_role_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  if p_actor_user_id is null
    or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or not private.admin_audit_value_is_safe(coalesce(p_before, '{}'::jsonb))
    or not private.admin_audit_value_is_safe(coalesce(p_after, '{}'::jsonb))
    or (
      p_actor_role_snapshot is not null
      and not private.admin_audit_value_is_safe(p_actor_role_snapshot)
    )
  then
    raise exception 'AUDIT_INPUT_INVALID';
  end if;

  insert into public.platform_audit_events (
    actor_user_id, workspace_id, action, target_type, target_id, reason,
    request_id, result, fact_kind, before, after, idempotency_key,
    approval_request_id, actor_role_snapshot
  )
  values (
    p_actor_user_id, p_workspace_id, p_action, p_target_type, p_target_id,
    p_reason, p_request_id, p_result, p_fact_kind, coalesce(p_before, '{}'::jsonb),
    coalesce(p_after, '{}'::jsonb), p_idempotency_key,
    p_approval_request_id, p_actor_role_snapshot
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.request_admin_approval(
  p_workspace_id uuid,
  p_action_type text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_idempotency_key text,
  p_expected_version bigint default null,
  p_request_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  request_permission text;
  expected_target_type text;
  expected_scope text;
  payload_limit integer;
  normalized_reason text;
  semantic_fingerprint text;
  requested_at_value timestamptz;
  request_row public.admin_approval_requests%rowtype;
  existing_row public.admin_approval_requests%rowtype;
  actor_role_snapshot jsonb;
  export_from timestamptz;
  export_to timestamptz;
  audit_key text;
begin
  actor_id := private.require_current_operator_aal2_actor();

  if not exists (
    select 1 from public.platform_admin_members
    where user_id = actor_id and status = 'active'
  ) then
    raise exception 'OPERATOR_DISABLED';
  end if;

  perform private.lock_platform_owner_quorum();

  if (
    select count(distinct member.user_id)
    from public.platform_admin_members as member
    join public.platform_admin_role_assignments as assignment
      on assignment.user_id = member.user_id
    where member.status = 'active'
      and assignment.role_key = 'platform_owner'
      and assignment.workspace_id is null
  ) < 2 then
    raise exception 'OWNER_QUORUM_REQUIRED';
  end if;

  case p_action_type
    when 'agreement.verify' then
      request_permission := 'agreement.request'; expected_target_type := 'agreement'; expected_scope := 'workspace'; payload_limit := 2;
    when 'channel.disconnect' then
      request_permission := 'channel.disconnect.request'; expected_target_type := 'channel_connection'; expected_scope := 'workspace'; payload_limit := 2;
    when 'publish.retry' then
      request_permission := 'publish.retry.request'; expected_target_type := 'publish_attempt'; expected_scope := 'workspace'; payload_limit := 32;
    when 'credit.adjust' then
      request_permission := 'credit.adjust.request'; expected_target_type := 'credit_account'; expected_scope := 'workspace'; payload_limit := 256;
    when 'admin.role.change.workspace' then
      request_permission := 'admin.role.change.request'; expected_target_type := 'platform_admin_role_assignment'; expected_scope := 'workspace'; payload_limit := 128;
    when 'admin.role.change.global' then
      request_permission := 'admin.role.change.request'; expected_target_type := 'platform_admin_role_assignment'; expected_scope := 'global'; payload_limit := 128;
    when 'audit.export.workspace' then
      request_permission := 'audit.export.request'; expected_target_type := 'platform_audit_export'; expected_scope := 'workspace'; payload_limit := 512;
    when 'audit.export.global' then
      request_permission := 'audit.export.request'; expected_target_type := 'platform_audit_export'; expected_scope := 'global'; payload_limit := 512;
    else
      raise exception 'AUDIT_INPUT_INVALID';
  end case;

  if (expected_scope = 'workspace' and p_workspace_id is null)
    or (expected_scope = 'global' and p_workspace_id is not null)
    or (p_action_type not like 'audit.export.%' and p_expected_version is null)
    or (p_action_type like 'audit.export.%' and p_expected_version is not null)
    or (p_expected_version is not null and p_expected_version < 0)
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[a-f0-9]{64}$'
  then
    raise exception 'AUDIT_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.platform_admin_role_assignments as assignment
    join public.platform_role_permissions as permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = request_permission
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not private.has_platform_permission(request_permission, p_workspace_id) then
    raise exception 'WORKSPACE_SCOPE_DENIED';
  end if;

  if expected_scope = 'workspace'
    and not exists (select 1 from public.workspaces where id = p_workspace_id)
  then
    raise exception 'AUDIT_INPUT_INVALID';
  end if;

  normalized_reason := btrim(coalesce(p_reason, ''));
  if p_target_type is distinct from expected_target_type
    or p_target_id is null
    or p_target_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(normalized_reason) not between 1 and 2000
    or p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object'
    or octet_length(p_request_payload::text) > payload_limit
    or not private.admin_audit_value_is_safe(to_jsonb(normalized_reason))
    or not private.admin_audit_value_is_safe(p_request_payload)
  then
    raise exception 'AUDIT_INPUT_INVALID';
  end if;

  if p_action_type in ('agreement.verify', 'channel.disconnect') and p_request_payload <> '{}'::jsonb then
    raise exception 'AUDIT_INPUT_INVALID';
  elsif p_action_type = 'publish.retry' and p_request_payload <> '{"retry_mode":"no_post"}'::jsonb then
    raise exception 'AUDIT_INPUT_INVALID';
  elsif p_action_type = 'credit.adjust' and not (
    (select count(*) from jsonb_object_keys(p_request_payload)) = 3
    and p_request_payload ?& array['direction', 'amount', 'reason_code']
    and p_request_payload ->> 'direction' in ('credit', 'debit')
    and p_request_payload ->> 'reason_code' in ('billing_correction', 'service_recovery', 'manual_promotion')
    and jsonb_typeof(p_request_payload -> 'amount') = 'number'
    and p_request_payload ->> 'amount' ~ '^[0-9]{1,6}$'
    and (p_request_payload ->> 'amount')::integer between 1 and 100000
  ) then
    raise exception 'AUDIT_INPUT_INVALID';
  elsif p_action_type in ('admin.role.change.workspace', 'admin.role.change.global') and not (
    (select count(*) from jsonb_object_keys(p_request_payload)) = 1
    and p_request_payload ? 'next_role_key'
    and p_request_payload ->> 'next_role_key' in (
      'platform_owner', 'operations_admin', 'customer_support', 'content_operator',
      'billing_admin', 'system_admin', 'audit_viewer'
    )
  ) then
    raise exception 'AUDIT_INPUT_INVALID';
  elsif p_action_type in ('audit.export.workspace', 'audit.export.global') then
    if not (
      (select count(*) from jsonb_object_keys(p_request_payload)) = 3
      and p_request_payload ?& array['from', 'to', 'format']
      and p_request_payload ->> 'format' = 'csv'
      and p_request_payload ->> 'from' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      and p_request_payload ->> 'to' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    ) then
      raise exception 'AUDIT_INPUT_INVALID';
    end if;
    begin
      export_from := (p_request_payload ->> 'from')::timestamptz;
      export_to := (p_request_payload ->> 'to')::timestamptz;
    exception when others then
      raise exception 'AUDIT_INPUT_INVALID';
    end;
    if export_from >= export_to or export_to - export_from > interval '31 days' then
      raise exception 'AUDIT_INPUT_INVALID';
    end if;
  end if;

  semantic_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'workspace_id', p_workspace_id,
      'action_type', p_action_type,
      'target_type', p_target_type,
      'target_id', p_target_id,
      'reason', normalized_reason,
      'expected_version', p_expected_version,
      'request_payload', p_request_payload
    )::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-approval:' || p_idempotency_key, 0)
  );

  select * into existing_row
  from public.admin_approval_requests
  where idempotency_key = p_idempotency_key;
  if found then
    if existing_row.semantic_fingerprint <> semantic_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'approval_request_id', existing_row.id,
      'workspace_id', existing_row.workspace_id,
      'action_type', existing_row.action_type,
      'status', 'pending',
      'effective_status', 'pending',
      'requested_at', existing_row.requested_at,
      'expires_at', existing_row.expires_at,
      'semantic_fingerprint', existing_row.semantic_fingerprint
    );
  end if;

  requested_at_value := statement_timestamp();
  begin
    insert into public.admin_approval_requests (
      workspace_id, action_type, target_type, target_id, reason, requested_by,
      status, expected_version, request_payload, result_summary,
      semantic_fingerprint, idempotency_key, requested_at, expires_at
    ) values (
      p_workspace_id, p_action_type, p_target_type, p_target_id, normalized_reason,
      actor_id, 'pending', p_expected_version, p_request_payload, '{}'::jsonb,
      semantic_fingerprint, p_idempotency_key, requested_at_value,
      requested_at_value + interval '24 hours'
    ) returning * into request_row;
  exception when others then
    raise exception 'AUDIT_WRITE_UNAVAILABLE';
  end;

  select jsonb_build_object(
    'roles', coalesce(jsonb_agg(role_key order by role_key), '[]'::jsonb)
  ) into actor_role_snapshot
  from (
    select distinct assignment.role_key
    from public.platform_admin_role_assignments as assignment
    where assignment.user_id = actor_id
  ) as roles;

  audit_key := encode(extensions.digest('approval-requested:' || p_idempotency_key, 'sha256'), 'hex');
  begin
    perform private.append_platform_audit_event(
      actor_id, p_workspace_id, p_action_type || '.requested', p_target_type,
      p_target_id, normalized_reason, request_row.id::text, 'succeeded',
      '{}'::jsonb,
      jsonb_build_object('status', 'pending', 'semantic_fingerprint', semantic_fingerprint),
      audit_key, 'observed', request_row.id, actor_role_snapshot
    );
  exception when others then
    raise exception 'AUDIT_WRITE_UNAVAILABLE';
  end;

  return jsonb_build_object(
    'approval_request_id', request_row.id,
    'workspace_id', request_row.workspace_id,
    'action_type', request_row.action_type,
    'status', request_row.status,
    'effective_status', request_row.status,
    'requested_at', request_row.requested_at,
    'expires_at', request_row.expires_at,
    'semantic_fingerprint', request_row.semantic_fingerprint
  );
end;
$$;

create or replace function public.approve_admin_approval_request(p_approval_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  request_row public.admin_approval_requests%rowtype;
  approve_permission text;
  actor_role_snapshot jsonb;
  audit_key text;
begin
  actor_id := private.require_current_operator_aal2_actor();

  if not exists (
    select 1 from public.platform_admin_members
    where user_id = actor_id and status = 'active'
  ) then
    raise exception 'OPERATOR_DISABLED';
  end if;
  perform private.lock_platform_owner_quorum();
  if (
    select count(distinct member.user_id)
    from public.platform_admin_members as member
    join public.platform_admin_role_assignments as assignment on assignment.user_id = member.user_id
    where member.status = 'active' and assignment.role_key = 'platform_owner' and assignment.workspace_id is null
  ) < 2 then
    raise exception 'OWNER_QUORUM_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.platform_admin_members as member
    join public.platform_admin_role_assignments as assignment on assignment.user_id = member.user_id
    where member.user_id = actor_id and member.status = 'active'
      and assignment.role_key = 'platform_owner' and assignment.workspace_id is null
  ) then
    raise exception 'PLATFORM_OWNER_REQUIRED';
  end if;

  select * into request_row
  from public.admin_approval_requests
  where id = p_approval_request_id
  for update;
  if not found then
    raise exception 'APPROVAL_NOT_FOUND';
  end if;
  if request_row.requested_by = actor_id then
    raise exception 'APPROVER_MUST_DIFFER';
  end if;

  approve_permission := case request_row.action_type
    when 'agreement.verify' then 'agreement.verify'
    when 'credit.adjust' then 'credit.adjust.approve'
    when 'channel.disconnect' then 'channel.disconnect.request'
    when 'publish.retry' then 'publish.retry.request'
    when 'admin.role.change.workspace' then 'admin.role.change.request'
    when 'admin.role.change.global' then 'admin.role.change.request'
    when 'audit.export.workspace' then 'audit.export.request'
    when 'audit.export.global' then 'audit.export.request'
    else null
  end;
  if approve_permission is null or not private.has_platform_permission(approve_permission, request_row.workspace_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'APPROVAL_STATE_CONFLICT';
  end if;
  if statement_timestamp() >= request_row.expires_at then
    raise exception 'APPROVAL_EXPIRED';
  end if;

  begin
    update public.admin_approval_requests
    set status = 'approved', approved_by = actor_id, approved_at = statement_timestamp()
    where id = request_row.id
    returning * into request_row;
  exception when others then
    raise exception 'AUDIT_WRITE_UNAVAILABLE';
  end;

  select jsonb_build_object(
    'roles', coalesce(jsonb_agg(role_key order by role_key), '[]'::jsonb)
  ) into actor_role_snapshot
  from (
    select distinct assignment.role_key
    from public.platform_admin_role_assignments as assignment
    where assignment.user_id = actor_id
  ) as roles;

  audit_key := encode(extensions.digest('approval-approved:' || request_row.id::text, 'sha256'), 'hex');
  begin
    perform private.append_platform_audit_event(
      actor_id, request_row.workspace_id, request_row.action_type || '.approved',
      request_row.target_type, request_row.target_id, request_row.reason,
      request_row.id::text, 'succeeded', jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'approved'), audit_key, 'observed',
      request_row.id, actor_role_snapshot
    );
  exception when others then
    raise exception 'AUDIT_WRITE_UNAVAILABLE';
  end;

  return jsonb_build_object(
    'approval_request_id', request_row.id,
    'workspace_id', request_row.workspace_id,
    'action_type', request_row.action_type,
    'status', request_row.status,
    'effective_status', request_row.status,
    'requested_at', request_row.requested_at,
    'expires_at', request_row.expires_at,
    'approved_at', request_row.approved_at
  );
end;
$$;

create or replace function private.mark_admin_approval_applied(
  p_approval_request_id uuid,
  p_result_summary jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_idempotency_key !~ '^[a-f0-9]{64}$'
    or p_result_summary is null
    or jsonb_typeof(p_result_summary) <> 'object'
    or not private.admin_audit_value_is_safe(p_result_summary)
  then
    raise exception 'AUDIT_INPUT_INVALID';
  end if;
  raise exception 'APPROVAL_STATE_CONFLICT';
end;
$$;

revoke all on function private.prevent_platform_audit_change() from public, anon, authenticated, service_role;
revoke all on function private.prevent_admin_approval_expiry_change() from public, anon, authenticated, service_role;
revoke all on function private.lock_platform_owner_quorum() from public, anon, authenticated, service_role;
revoke all on function private.require_current_operator_aal2_actor() from public, anon, authenticated, service_role;
revoke all on function private.admin_audit_value_is_safe(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function private.append_platform_audit_event(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.mark_admin_approval_applied(uuid, jsonb, text) from public, anon, authenticated, service_role;

revoke all on function public.request_admin_approval(uuid, text, text, text, text, text, bigint, jsonb) from public, anon, service_role;
grant execute on function public.request_admin_approval(uuid, text, text, text, text, text, bigint, jsonb) to authenticated;
revoke all on function public.approve_admin_approval_request(uuid) from public, anon, service_role;
grant execute on function public.approve_admin_approval_request(uuid) to authenticated;
