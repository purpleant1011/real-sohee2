create or replace function public.list_operator_channel_connections(
  p_workspace_id uuid default null,
  p_channel text default null,
  p_connection_status text default null,
  p_delegation_status text default null,
  p_risk text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  result jsonb;
begin
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if claims ->> 'aal' is distinct from 'aal2'
    and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true)
  then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'CHANNEL_INPUT_INVALID'; end if;
  if p_channel is not null and p_channel not in ('instagram', 'threads') then raise exception 'CHANNEL_INPUT_INVALID'; end if;
  if p_connection_status is not null and p_connection_status not in ('disconnected','connecting','connected','expired','missing_permission','wrong_account','provider_error','error') then raise exception 'CHANNEL_INPUT_INVALID'; end if;
  if p_delegation_status is not null and p_delegation_status not in ('accepted','withdrawn','expired','unknown') then raise exception 'CHANNEL_INPUT_INVALID'; end if;
  if p_risk is not null and p_risk not in ('normal','attention') then raise exception 'CHANNEL_INPUT_INVALID'; end if;
  if p_workspace_id is not null and not private.has_platform_permission('channel.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if p_workspace_id is null and not exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'channel.read'
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(row) order by row.workspace_name, row.channel), '[]'::jsonb))
    into result
  from (
    select connection.workspace_id,
      workspace.name as workspace_name,
      connection.channel,
      connection.account_label,
      connection.status as connection_status,
      coalesce(delegation.status, 'unknown') as delegation_status,
      case connection.status
        when 'connected' then 'ready'
        when 'missing_permission' then 'missing'
        when 'expired' then 'expired'
        when 'wrong_account' then 'wrong_account'
        when 'provider_error' then 'provider_error'
        when 'error' then 'provider_error'
        else 'unknown'
      end as technical_permission_status,
      connection.token_expires_at,
      connection.webhook_status,
      connection.last_webhook_at,
      connection.last_provider_event_at,
      connection.last_error_code,
      connection.updated_at,
      case
        when connection.updated_at > statement_timestamp() then 'unknown'
        when greatest(connection.updated_at, coalesce(connection.last_webhook_at, connection.updated_at), coalesce(connection.last_provider_event_at, connection.updated_at)) < statement_timestamp() - interval '24 hours' then 'stale'
        else 'fresh'
      end as freshness
    from public.channel_connections connection
    join public.workspaces workspace on workspace.id = connection.workspace_id
    left join lateral (
      select case
        when delegation_row.status = 'accepted' and delegation_row.expires_at is not null and delegation_row.expires_at <= statement_timestamp() then 'expired'
        else delegation_row.status
      end as status
      from public.channel_delegations delegation_row
      where delegation_row.workspace_id = connection.workspace_id
        and delegation_row.channel = connection.channel
        and delegation_row.created_at <= statement_timestamp()
      order by delegation_row.created_at desc
      limit 1
    ) delegation on true
    where connection.channel in ('instagram', 'threads')
      and (p_workspace_id is null or connection.workspace_id = p_workspace_id)
      and (p_workspace_id is not null or private.has_platform_permission('channel.read', connection.workspace_id))
      and (p_channel is null or connection.channel = p_channel)
      and (p_connection_status is null or connection.status = p_connection_status)
      and (p_delegation_status is null or coalesce(delegation.status, 'unknown') = p_delegation_status)
      and (p_risk is null or p_risk = case when connection.status in ('connected', 'disconnected') and connection.webhook_status in ('healthy', 'pending') then 'normal' else 'attention' end)
    order by connection.updated_at desc, connection.id
    limit p_limit
  ) row;
  return result;
exception when others then
  if SQLERRM in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED', 'CHANNEL_INPUT_INVALID') then raise; end if;
  raise exception 'CHANNEL_LIST_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_channel_connections(uuid, text, text, text, text, integer) from public, anon, service_role;
grant execute on function public.list_operator_channel_connections(uuid, text, text, text, text, integer) to authenticated;
