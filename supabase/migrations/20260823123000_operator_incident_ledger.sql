create table public.operator_incidents (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('conversation_jobs', 'provider_webhooks', 'operation_events', 'cloudflare', 'queue', 'cron', 'release')),
  source_state text not null check (source_state in ('healthy', 'degraded', 'error', 'empty', 'unknown')),
  source_freshness text not null check (source_freshness in ('fresh', 'stale', 'empty', 'unknown', 'error')),
  source_observed_at timestamptz,
  title text not null check (char_length(title) between 1 and 200),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  version bigint not null default 1 check (version > 0),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  fact_kind text not null check (fact_kind in ('observed', 'user_claim', 'inference', 'unknown')),
  rollback_candidate_code text check (rollback_candidate_code is null or rollback_candidate_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  recovery_state text not null default 'unknown' check (recovery_state in ('unknown', 'pending', 'verified', 'failed')),
  opened_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  freshness text not null check (freshness in ('fresh', 'stale', 'unknown', 'empty', 'error'))
);

create table public.operator_incident_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.operator_incidents(id) on delete restrict,
  event_type text not null check (event_type in ('opened', 'acknowledged', 'resolved', 'reopened', 'rollback_candidate_identified', 'recovery_verification_recorded')),
  fact_kind text not null check (fact_kind in ('observed', 'user_claim', 'inference', 'unknown')),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  version bigint not null check (version > 0),
  resulting_status text not null check (resulting_status in ('open', 'acknowledged', 'resolved')),
  resulting_recovery_state text not null check (resulting_recovery_state in ('unknown', 'pending', 'verified', 'failed')),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default statement_timestamp(),
  unique (idempotency_key)
);

create index operator_incidents_status_updated_idx on public.operator_incidents(status, updated_at desc, id);
create index operator_incident_timeline_incident_time_idx on public.operator_incident_timeline(incident_id, occurred_at, id);

alter table public.operator_incidents enable row level security;
alter table public.operator_incident_timeline enable row level security;
revoke all on public.operator_incidents, public.operator_incident_timeline from public, anon, authenticated;
grant select, insert, update on public.operator_incidents, public.operator_incident_timeline to service_role;

create or replace function private.prevent_operator_incident_timeline_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if current_setting('app.operator_incident_write_context', true) not in ('create', 'transition', 'recovery') then raise exception 'INCIDENT_TIMELINE_WRITE_FORBIDDEN'; end if;
    return new;
  end if;
  raise exception 'INCIDENT_TIMELINE_IMMUTABLE';
end;
$$;

create trigger operator_incident_timeline_immutable_update
before update or delete on public.operator_incident_timeline
for each row execute function private.prevent_operator_incident_timeline_mutation();

create or replace function private.prevent_operator_incident_direct_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.operator_incident_write_context', true) <> 'create' then raise exception 'INCIDENT_CREATE_FORBIDDEN'; end if;
  return new;
end;
$$;

create trigger operator_incidents_guard_insert
before insert on public.operator_incidents
for each row execute function private.prevent_operator_incident_direct_insert();

create trigger operator_incident_timeline_guard_insert
before insert on public.operator_incident_timeline
for each row execute function private.prevent_operator_incident_timeline_mutation();

create or replace function public.list_operator_incidents(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('system.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (select 1 from public.platform_admin_role_assignments assignment join public.platform_role_permissions permission on permission.role_key = assignment.role_key where assignment.user_id = actor_id and assignment.workspace_id is null and permission.permission_key = 'system.read') then raise exception 'PERMISSION_DENIED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'INCIDENT_INPUT_INVALID'; end if;

  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'id', incident.id, 'source', incident.source, 'source_state', incident.source_state, 'source_freshness', incident.source_freshness,
    'source_observed_at', incident.source_observed_at, 'title', incident.title, 'severity', incident.severity, 'status', incident.status,
    'version', incident.version, 'reason', incident.reason, 'fact_kind', incident.fact_kind, 'rollback_candidate_code', incident.rollback_candidate_code,
    'recovery_state', incident.recovery_state, 'opened_at', incident.opened_at, 'updated_at', incident.updated_at, 'freshness', incident.freshness,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('id', event.id, 'event_type', event.event_type, 'fact_kind', event.fact_kind, 'reason', event.reason, 'version', event.version, 'resulting_status', event.resulting_status, 'resulting_recovery_state', event.resulting_recovery_state, 'occurred_at', event.occurred_at) order by event.occurred_at, event.id) from public.operator_incident_timeline event where event.incident_id = incident.id), '[]'::jsonb)
  ) order by case incident.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end, incident.updated_at desc, incident.id), '[]'::jsonb)) into result
  from (select * from public.operator_incidents order by updated_at desc, id limit p_limit) incident;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'WORKSPACE_SCOPE_DENIED', 'INCIDENT_INPUT_INVALID') then raise; end if;
  raise exception 'INCIDENT_READ_UNAVAILABLE';
end;
$$;

create or replace function public.transition_operator_incident(p_incident_id uuid, p_action text, p_reason text, p_expected_version bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  incident public.operator_incidents%rowtype;
  next_status text;
  event_name text;
  timeline_id uuid;
  replay_status text;
  replay_recovery_state text;
  replay_version bigint;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('incident.manage', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_action not in ('acknowledge', 'resolve', 'reopen') or p_reason is null or btrim(p_reason) = '' or p_expected_version is null or p_expected_version < 1 or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  select event.resulting_status, event.resulting_recovery_state, event.version, event.id
  into replay_status, replay_recovery_state, replay_version, timeline_id
  from public.operator_incident_timeline event
  where event.idempotency_key = p_idempotency_key;
  if timeline_id is not null then return jsonb_build_object('status', replay_status, 'recovery_state', replay_recovery_state, 'version', replay_version, 'timeline_id', timeline_id, 'replayed', true); end if;
  select * into incident from public.operator_incidents where id = p_incident_id for update;
  if incident.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if incident.version <> p_expected_version then raise exception 'INCIDENT_VERSION_CONFLICT'; end if;
  if (incident.status = 'open' and p_action in ('acknowledge', 'resolve')) or (incident.status = 'acknowledged' and p_action = 'resolve') or (incident.status = 'resolved' and p_action = 'reopen') then
    if p_action = 'resolve' and incident.recovery_state <> 'verified' then raise exception 'INCIDENT_RECOVERY_NOT_VERIFIED'; end if;
    next_status := case p_action when 'acknowledge' then 'acknowledged' when 'resolve' then 'resolved' else 'open' end;
  else raise exception 'INCIDENT_STATE_CONFLICT'; end if;
  event_name := case p_action when 'acknowledge' then 'acknowledged' when 'resolve' then 'resolved' else 'reopened' end;
  perform set_config('app.operator_incident_write_context', 'transition', true);
  update public.operator_incidents as incident set status = next_status, recovery_state = case when p_action = 'reopen' then 'pending' else incident.recovery_state end, version = version + 1, updated_at = statement_timestamp() where id = p_incident_id;
  insert into public.operator_incident_timeline(incident_id, event_type, fact_kind, reason, version, resulting_status, resulting_recovery_state, idempotency_key) values (p_incident_id, event_name, 'user_claim', btrim(p_reason), incident.version + 1, next_status, case when p_action = 'reopen' then 'pending' else incident.recovery_state end, p_idempotency_key) returning id into timeline_id;
  return jsonb_build_object('status', next_status, 'recovery_state', case when p_action = 'reopen' then 'pending' else incident.recovery_state end, 'version', incident.version + 1, 'timeline_id', timeline_id, 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'INCIDENT_INPUT_INVALID', 'INCIDENT_NOT_FOUND', 'INCIDENT_VERSION_CONFLICT', 'INCIDENT_STATE_CONFLICT') then raise; end if;
  raise exception 'INCIDENT_TRANSITION_UNAVAILABLE';
end;
$$;

create or replace function public.create_operator_incident(
  p_source text, p_source_state text, p_source_freshness text, p_source_observed_at timestamptz,
  p_title text, p_severity text, p_reason text, p_fact_kind text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  incident_id uuid;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('incident.manage', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_source not in ('conversation_jobs', 'provider_webhooks', 'operation_events', 'cloudflare', 'queue', 'cron', 'release') or p_source_state not in ('healthy', 'degraded', 'error', 'empty', 'unknown') or p_source_freshness not in ('fresh', 'stale', 'empty', 'unknown', 'error') or p_title is null or btrim(p_title) = '' or p_severity not in ('low', 'medium', 'high', 'critical') or p_reason is null or btrim(p_reason) = '' or p_fact_kind not in ('observed', 'user_claim', 'inference', 'unknown') or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  select timeline.incident_id into incident_id from public.operator_incident_timeline timeline where timeline.idempotency_key = p_idempotency_key;
  if incident_id is not null then return jsonb_build_object('incident_id', incident_id, 'version', (select incident.version from public.operator_incidents incident where incident.id = incident_id), 'replayed', true); end if;
  perform set_config('app.operator_incident_write_context', 'create', true);
  insert into public.operator_incidents(source, source_state, source_freshness, source_observed_at, title, severity, reason, fact_kind, freshness)
  values (p_source, p_source_state, p_source_freshness, p_source_observed_at, btrim(p_title), p_severity, btrim(p_reason), p_fact_kind, case when p_source_observed_at is null then 'unknown' when p_source_observed_at > statement_timestamp() then 'unknown' when p_source_observed_at < statement_timestamp() - interval '1 day' then 'stale' else 'fresh' end)
  returning id into incident_id;
  insert into public.operator_incident_timeline(incident_id, event_type, fact_kind, reason, version, resulting_status, resulting_recovery_state, idempotency_key)
  values (incident_id, 'opened', p_fact_kind, btrim(p_reason), 1, 'open', 'unknown', p_idempotency_key);
  return jsonb_build_object('incident_id', incident_id, 'version', 1, 'status', 'open', 'recovery_state', 'unknown', 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'INCIDENT_INPUT_INVALID') then raise; end if;
  raise exception 'INCIDENT_CREATE_UNAVAILABLE';
end;
$$;

create or replace function public.record_operator_incident_recovery(
  p_incident_id uuid, p_recovery_state text, p_rollback_candidate_code text, p_reason text, p_expected_version bigint, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  incident public.operator_incidents%rowtype;
  replay_status text;
  replay_recovery_state text;
  replay_version bigint;
  timeline_id uuid;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('incident.manage', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_recovery_state not in ('pending', 'verified', 'failed') or (p_rollback_candidate_code is not null and p_rollback_candidate_code !~ '^[A-Z][A-Z0-9_]{0,63}$') or p_reason is null or btrim(p_reason) = '' or p_expected_version is null or p_expected_version < 1 or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  select event.resulting_status, event.resulting_recovery_state, event.version, event.id into replay_status, replay_recovery_state, replay_version, timeline_id from public.operator_incident_timeline event where event.idempotency_key = p_idempotency_key;
  if timeline_id is not null then return jsonb_build_object('status', replay_status, 'recovery_state', replay_recovery_state, 'version', replay_version, 'timeline_id', timeline_id, 'replayed', true); end if;
  select * into incident from public.operator_incidents where id = p_incident_id for update;
  if incident.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if incident.version <> p_expected_version then raise exception 'INCIDENT_VERSION_CONFLICT'; end if;
  perform set_config('app.operator_incident_write_context', 'recovery', true);
  update public.operator_incidents as incident set rollback_candidate_code = coalesce(p_rollback_candidate_code, incident.rollback_candidate_code), recovery_state = p_recovery_state, version = version + 1, updated_at = statement_timestamp() where id = p_incident_id;
  insert into public.operator_incident_timeline(incident_id, event_type, fact_kind, reason, version, resulting_status, resulting_recovery_state, idempotency_key) values (p_incident_id, 'recovery_verification_recorded', 'observed', btrim(p_reason), incident.version + 1, incident.status, p_recovery_state, p_idempotency_key) returning id into timeline_id;
  return jsonb_build_object('status', incident.status, 'recovery_state', p_recovery_state, 'version', incident.version + 1, 'timeline_id', timeline_id, 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'INCIDENT_INPUT_INVALID', 'INCIDENT_NOT_FOUND', 'INCIDENT_VERSION_CONFLICT') then raise; end if;
  raise exception 'INCIDENT_RECOVERY_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_incidents(integer), public.create_operator_incident(text, text, text, timestamptz, text, text, text, text, text), public.transition_operator_incident(uuid, text, text, bigint, text), public.record_operator_incident_recovery(uuid, text, text, text, bigint, text) from public, anon, service_role;
grant execute on function public.list_operator_incidents(integer), public.create_operator_incident(text, text, text, timestamptz, text, text, text, text, text), public.transition_operator_incident(uuid, text, text, bigint, text), public.record_operator_incident_recovery(uuid, text, text, text, bigint, text) to authenticated;
