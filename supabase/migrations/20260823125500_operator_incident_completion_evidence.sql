alter table public.operator_incidents
  add column if not exists assignee_user_id uuid references public.platform_admin_members(user_id) on delete restrict,
  add column if not exists impact_scope text,
  add column if not exists recovery_verified_at timestamptz,
  add column if not exists recovery_evidence_summary text,
  add column if not exists remediation_kind text,
  add column if not exists remediation_result text;

alter table public.operator_incidents
  drop constraint if exists operator_incidents_impact_scope_check,
  add constraint operator_incidents_impact_scope_check check (impact_scope is null or impact_scope ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  drop constraint if exists operator_incidents_recovery_evidence_check,
  add constraint operator_incidents_recovery_evidence_check check (recovery_evidence_summary is null or char_length(recovery_evidence_summary) between 1 and 500 and recovery_evidence_summary = btrim(recovery_evidence_summary)),
  drop constraint if exists operator_incidents_remediation_kind_check,
  add constraint operator_incidents_remediation_kind_check check (remediation_kind is null or remediation_kind in ('rollback', 'prevention')),
  drop constraint if exists operator_incidents_remediation_result_check,
  add constraint operator_incidents_remediation_result_check check (remediation_result is null or char_length(remediation_result) between 1 and 500 and remediation_result = btrim(remediation_result));

alter table public.operator_incident_timeline
  add column if not exists assignee_user_id uuid references public.platform_admin_members(user_id) on delete restrict,
  add column if not exists impact_scope text,
  add column if not exists recovery_verified_at timestamptz,
  add column if not exists recovery_evidence_summary text,
  add column if not exists remediation_kind text,
  add column if not exists remediation_result text;

create or replace function public.list_operator_incidents(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare actor_id uuid := (select auth.uid()); actor_mfa_required boolean; result jsonb;
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
    'assignee_user_id', incident.assignee_user_id,
    'assignee_display', case when auth_user.email is null then null when position('@' in auth_user.email) > 1 then left(split_part(auth_user.email, '@', 1), 1) || '***@' || split_part(auth_user.email, '@', 2) else '***' end,
    'impact_scope', incident.impact_scope, 'recovery_verified_at', incident.recovery_verified_at, 'recovery_evidence_summary', incident.recovery_evidence_summary,
    'remediation_kind', incident.remediation_kind, 'remediation_result', incident.remediation_result, 'recovery_state', incident.recovery_state,
    'opened_at', incident.opened_at, 'updated_at', incident.updated_at, 'freshness', incident.freshness,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('id', event.id, 'event_type', event.event_type, 'fact_kind', event.fact_kind, 'reason', event.reason, 'version', event.version, 'resulting_status', event.resulting_status, 'resulting_recovery_state', event.resulting_recovery_state, 'assignee_user_id', event.assignee_user_id, 'impact_scope', event.impact_scope, 'recovery_verified_at', event.recovery_verified_at, 'recovery_evidence_summary', event.recovery_evidence_summary, 'remediation_kind', event.remediation_kind, 'remediation_result', event.remediation_result, 'occurred_at', event.occurred_at) order by event.occurred_at, event.id) from public.operator_incident_timeline event where event.incident_id = incident.id), '[]'::jsonb)
  ) order by case incident.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end, incident.updated_at desc, incident.id), '[]'::jsonb)) into result
  from (select * from public.operator_incidents order by updated_at desc, id limit p_limit) incident
  left join auth.users auth_user on auth_user.id = incident.assignee_user_id;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'WORKSPACE_SCOPE_DENIED', 'INCIDENT_INPUT_INVALID') then raise; end if;
  raise exception 'INCIDENT_READ_UNAVAILABLE';
end;
$$;

create or replace function public.transition_operator_incident(p_incident_id uuid, p_action text, p_reason text, p_expected_version bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); actor_mfa_required boolean; incident public.operator_incidents%rowtype; next_status text; event_name text; timeline_id uuid; replay_status text; replay_recovery_state text; replay_version bigint;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('incident.manage', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_action not in ('acknowledge', 'resolve', 'reopen') or p_reason is null or btrim(p_reason) = '' or p_expected_version is null or p_expected_version < 1 or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  select event.resulting_status, event.resulting_recovery_state, event.version, event.id into replay_status, replay_recovery_state, replay_version, timeline_id from public.operator_incident_timeline event where event.idempotency_key = p_idempotency_key;
  if timeline_id is not null then return jsonb_build_object('status', replay_status, 'recovery_state', replay_recovery_state, 'version', replay_version, 'timeline_id', timeline_id, 'replayed', true); end if;
  select * into incident from public.operator_incidents where id = p_incident_id for update;
  if incident.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if incident.version <> p_expected_version then raise exception 'INCIDENT_VERSION_CONFLICT'; end if;
  if p_action = 'resolve' then
    if incident.recovery_state <> 'verified' then raise exception 'INCIDENT_RECOVERY_NOT_VERIFIED'; end if;
    if incident.assignee_user_id is null then raise exception 'INCIDENT_ASSIGNEE_REQUIRED'; end if;
    if incident.impact_scope is null then raise exception 'INCIDENT_IMPACT_SCOPE_REQUIRED'; end if;
    if incident.recovery_verified_at is null then raise exception 'INCIDENT_RECOVERY_VERIFIED_AT_REQUIRED'; end if;
    if incident.recovery_evidence_summary is null then raise exception 'INCIDENT_RECOVERY_EVIDENCE_REQUIRED'; end if;
    if incident.remediation_kind is null or incident.remediation_result is null then raise exception 'INCIDENT_REMEDIATION_REQUIRED'; end if;
  end if;
  if (incident.status = 'open' and p_action in ('acknowledge', 'resolve')) or (incident.status = 'acknowledged' and p_action = 'resolve') or (incident.status = 'resolved' and p_action = 'reopen') then
    next_status := case p_action when 'acknowledge' then 'acknowledged' when 'resolve' then 'resolved' else 'open' end;
  else raise exception 'INCIDENT_STATE_CONFLICT'; end if;
  event_name := case p_action when 'acknowledge' then 'acknowledged' when 'resolve' then 'resolved' else 'reopened' end;
  perform set_config('app.operator_incident_write_context', 'transition', true);
  update public.operator_incidents as current_incident set status = next_status, recovery_state = case when p_action = 'reopen' then 'pending' else current_incident.recovery_state end, version = current_incident.version + 1, updated_at = statement_timestamp() where current_incident.id = p_incident_id;
  insert into public.operator_incident_timeline(incident_id, event_type, fact_kind, reason, version, resulting_status, resulting_recovery_state, assignee_user_id, impact_scope, recovery_verified_at, recovery_evidence_summary, remediation_kind, remediation_result, idempotency_key)
  values (p_incident_id, event_name, 'user_claim', btrim(p_reason), incident.version + 1, next_status, case when p_action = 'reopen' then 'pending' else incident.recovery_state end, incident.assignee_user_id, incident.impact_scope, incident.recovery_verified_at, incident.recovery_evidence_summary, incident.remediation_kind, incident.remediation_result, p_idempotency_key) returning id into timeline_id;
  return jsonb_build_object('status', next_status, 'recovery_state', case when p_action = 'reopen' then 'pending' else incident.recovery_state end, 'version', incident.version + 1, 'timeline_id', timeline_id, 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'INCIDENT_INPUT_INVALID', 'INCIDENT_NOT_FOUND', 'INCIDENT_VERSION_CONFLICT', 'INCIDENT_STATE_CONFLICT', 'INCIDENT_RECOVERY_NOT_VERIFIED', 'INCIDENT_ASSIGNEE_REQUIRED', 'INCIDENT_IMPACT_SCOPE_REQUIRED', 'INCIDENT_RECOVERY_VERIFIED_AT_REQUIRED', 'INCIDENT_RECOVERY_EVIDENCE_REQUIRED', 'INCIDENT_REMEDIATION_REQUIRED') then raise; end if;
  raise exception 'INCIDENT_TRANSITION_UNAVAILABLE';
end;
$$;

create or replace function public.record_operator_incident_recovery(p_incident_id uuid, p_recovery_state text, p_rollback_candidate_code text, p_reason text, p_expected_version bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'INCIDENT_RECOVERY_FIELDS_REQUIRED';
end;
$$;

create or replace function public.record_operator_incident_recovery(
  p_incident_id uuid, p_recovery_state text, p_rollback_candidate_code text, p_reason text, p_expected_version bigint, p_idempotency_key text,
  p_assignee_user_id uuid, p_impact_scope text, p_recovery_verified_at timestamptz, p_recovery_evidence_summary text, p_remediation_kind text, p_remediation_result text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); actor_mfa_required boolean; incident public.operator_incidents%rowtype; replay_status text; replay_recovery_state text; replay_version bigint; timeline_id uuid; verified boolean := p_recovery_state = 'verified';
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select member.mfa_required into actor_mfa_required from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active';
  if not found then raise exception 'OPERATOR_DISABLED'; end if;
  if coalesce(actor_mfa_required, true) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('incident.manage', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_recovery_state not in ('pending', 'verified', 'failed') or (p_rollback_candidate_code is not null and p_rollback_candidate_code !~ '^[A-Z][A-Z0-9_]{0,63}$') or p_reason is null or btrim(p_reason) = '' or p_expected_version is null or p_expected_version < 1 or p_idempotency_key !~ '^[a-f0-9]{64}$' or (p_impact_scope is not null and p_impact_scope !~ '^[A-Z][A-Z0-9_]{0,63}$') or (p_recovery_evidence_summary is not null and (char_length(btrim(p_recovery_evidence_summary)) not between 1 and 500)) or (p_remediation_kind is not null and p_remediation_kind not in ('rollback', 'prevention')) or (p_remediation_result is not null and char_length(btrim(p_remediation_result)) not between 1 and 500) then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  if verified and (p_assignee_user_id is null or p_impact_scope is null or p_recovery_verified_at is null or p_recovery_verified_at > statement_timestamp() or p_recovery_evidence_summary is null or p_remediation_kind is null or p_remediation_result is null) then raise exception 'INCIDENT_RECOVERY_FIELDS_REQUIRED'; end if;
  if p_assignee_user_id is not null and not exists (select 1 from public.platform_admin_members member where member.user_id = p_assignee_user_id and member.status = 'active') then raise exception 'INCIDENT_ASSIGNEE_INVALID'; end if;
  select event.resulting_status, event.resulting_recovery_state, event.version, event.id into replay_status, replay_recovery_state, replay_version, timeline_id from public.operator_incident_timeline event where event.idempotency_key = p_idempotency_key;
  if timeline_id is not null then return jsonb_build_object('status', replay_status, 'recovery_state', replay_recovery_state, 'version', replay_version, 'timeline_id', timeline_id, 'replayed', true); end if;
  select * into incident from public.operator_incidents where id = p_incident_id for update;
  if incident.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if incident.version <> p_expected_version then raise exception 'INCIDENT_VERSION_CONFLICT'; end if;
  perform set_config('app.operator_incident_write_context', 'recovery', true);
  update public.operator_incidents set assignee_user_id = coalesce(p_assignee_user_id, assignee_user_id), impact_scope = coalesce(p_impact_scope, impact_scope), recovery_verified_at = case when verified then p_recovery_verified_at else recovery_verified_at end, recovery_evidence_summary = case when verified then btrim(p_recovery_evidence_summary) else recovery_evidence_summary end, remediation_kind = case when verified then p_remediation_kind else remediation_kind end, remediation_result = case when verified then btrim(p_remediation_result) else remediation_result end, rollback_candidate_code = coalesce(p_rollback_candidate_code, rollback_candidate_code), recovery_state = p_recovery_state, version = version + 1, updated_at = statement_timestamp() where id = p_incident_id;
  insert into public.operator_incident_timeline(incident_id, event_type, fact_kind, reason, version, resulting_status, resulting_recovery_state, assignee_user_id, impact_scope, recovery_verified_at, recovery_evidence_summary, remediation_kind, remediation_result, idempotency_key)
  values (p_incident_id, 'recovery_verification_recorded', 'observed', btrim(p_reason), incident.version + 1, incident.status, p_recovery_state, coalesce(p_assignee_user_id, incident.assignee_user_id), coalesce(p_impact_scope, incident.impact_scope), case when verified then p_recovery_verified_at else incident.recovery_verified_at end, case when verified then btrim(p_recovery_evidence_summary) else incident.recovery_evidence_summary end, case when verified then p_remediation_kind else incident.remediation_kind end, case when verified then btrim(p_remediation_result) else incident.remediation_result end, p_idempotency_key) returning id into timeline_id;
  return jsonb_build_object('status', incident.status, 'recovery_state', p_recovery_state, 'version', incident.version + 1, 'timeline_id', timeline_id, 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'INCIDENT_INPUT_INVALID', 'INCIDENT_RECOVERY_FIELDS_REQUIRED', 'INCIDENT_ASSIGNEE_INVALID', 'INCIDENT_NOT_FOUND', 'INCIDENT_VERSION_CONFLICT') then raise; end if;
  raise exception 'INCIDENT_RECOVERY_UNAVAILABLE';
end;
$$;

revoke all on function public.record_operator_incident_recovery(uuid, text, text, text, bigint, text), public.record_operator_incident_recovery(uuid, text, text, text, bigint, text, uuid, text, timestamptz, text, text, text) from public, anon, service_role;
grant execute on function public.record_operator_incident_recovery(uuid, text, text, text, bigint, text), public.record_operator_incident_recovery(uuid, text, text, text, bigint, text, uuid, text, timestamptz, text, text, text) to authenticated;
