create or replace function public.list_operator_audit_events(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_workspace_id uuid default null,
  p_actor_user_id uuid default null,
  p_action text default null,
  p_result text default null,
  p_fact_kind text default null,
  p_target_type text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); result jsonb;
begin
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (select 1 from public.platform_admin_role_assignments a join public.platform_role_permissions p on p.role_key = a.role_key where a.user_id = actor_id and p.permission_key = 'audit.read') then raise exception 'PERMISSION_DENIED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_from is not null and p_to is not null and p_from > p_to) then raise exception 'AUDIT_INPUT_INVALID'; end if;
  if p_result is not null and p_result not in ('succeeded','failed','denied') then raise exception 'AUDIT_INPUT_INVALID'; end if;
  if p_fact_kind is not null and p_fact_kind not in ('observed','user_claim','inference','unknown') then raise exception 'AUDIT_INPUT_INVALID'; end if;
  if p_workspace_id is not null and not private.has_platform_permission('audit.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;

  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(row) order by row.created_at desc, row.id desc), '[]'::jsonb), 'next_cursor', null) into result
  from (
    select event.id, event.workspace_id, workspace.name as workspace_name, event.action, event.target_type,
      null::text as target_label, event.result, event.fact_kind, event.reason, event.approval_request_id,
      coalesce((select case when request.status = 'pending' and request.expires_at <= statement_timestamp() then 'expired' else request.status end from public.admin_approval_requests request where request.id = event.approval_request_id), 'none') as approval_status,
      event.before, event.after, event.created_at, 'fresh'::text as freshness,
      (select count(*)::integer from public.platform_audit_events linked where linked.approval_request_id = event.approval_request_id and event.approval_request_id is not null) as linked_event_count
    from public.platform_audit_events event
    left join public.workspaces workspace on workspace.id = event.workspace_id
    where (p_workspace_id is null or event.workspace_id = p_workspace_id)
      and ((event.workspace_id is null and private.has_platform_permission('audit.read', null)) or (event.workspace_id is not null and private.has_platform_permission('audit.read', event.workspace_id)))
      and (p_from is null or event.created_at >= p_from) and (p_to is null or event.created_at < p_to)
      and (p_actor_user_id is null or event.actor_user_id = p_actor_user_id)
      and (p_action is null or event.action = p_action) and (p_result is null or event.result = p_result)
      and (p_fact_kind is null or event.fact_kind = p_fact_kind) and (p_target_type is null or event.target_type = p_target_type)
      and (p_cursor_created_at is null or event.created_at < p_cursor_created_at or (event.created_at = p_cursor_created_at and event.id < p_cursor_id))
    order by event.created_at desc, event.id desc limit p_limit
  ) row;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','AUDIT_INPUT_INVALID') then raise; end if;
  raise exception 'AUDIT_READ_UNAVAILABLE';
end; $$;

create or replace function public.get_operator_audit_event_detail(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb; result jsonb;
begin
  claims := (select auth.jwt());
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (select 1 from public.platform_admin_role_assignments a join public.platform_role_permissions p on p.role_key = a.role_key where a.user_id = actor_id and p.permission_key = 'audit.read') then raise exception 'PERMISSION_DENIED'; end if;
  select jsonb_build_object('id', event.id, 'workspace_id', event.workspace_id, 'workspace_name', workspace.name, 'action', event.action, 'target_type', event.target_type, 'target_label', null, 'result', event.result, 'fact_kind', event.fact_kind, 'reason', event.reason, 'approval_request_id', event.approval_request_id, 'approval_status', coalesce((select request.status from public.admin_approval_requests request where request.id = event.approval_request_id), 'none'), 'before', event.before, 'after', event.after, 'created_at', event.created_at, 'freshness', 'fresh', 'linked_event_count', 0, 'linked_events', '[]'::jsonb) into result
  from public.platform_audit_events event left join public.workspaces workspace on workspace.id = event.workspace_id
  where event.id = p_event_id and ((event.workspace_id is null and private.has_platform_permission('audit.read', null)) or (event.workspace_id is not null and private.has_platform_permission('audit.read', event.workspace_id)));
  if result is null then raise exception 'AUDIT_READ_UNAVAILABLE'; end if;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','AUDIT_READ_UNAVAILABLE') then raise; end if;
  raise exception 'AUDIT_READ_UNAVAILABLE';
end; $$;

revoke all on function public.list_operator_audit_events(timestamptz,timestamptz,uuid,uuid,text,text,text,text,timestamptz,uuid,integer), public.get_operator_audit_event_detail(uuid) from public, anon, service_role;
grant execute on function public.list_operator_audit_events(timestamptz,timestamptz,uuid,uuid,text,text,text,text,timestamptz,uuid,integer), public.get_operator_audit_event_detail(uuid) to authenticated;
