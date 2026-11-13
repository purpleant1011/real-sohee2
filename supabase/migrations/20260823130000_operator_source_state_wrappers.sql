create or replace function public.list_operator_channel_connections_v2(p_workspace_id uuid default null, p_channel text default null, p_connection_status text default null, p_delegation_status text default null, p_risk text default null, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.list_operator_channel_connections(p_workspace_id, p_channel, p_connection_status, p_delegation_status, p_risk, p_limit);
  return jsonb_build_object('source_state', case when jsonb_array_length(result -> 'items') = 0 then 'empty' else 'ready' end, 'items', result -> 'items');
end; $$;
create or replace function public.list_operator_support_sessions_v2(p_workspace_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.list_operator_support_sessions(p_workspace_id, p_limit);
  return jsonb_build_object('source_state', case when jsonb_array_length(result) = 0 then 'empty' else 'ready' end, 'items', result);
end; $$;
revoke all on function public.list_operator_channel_connections_v2(uuid,text,text,text,text,integer), public.list_operator_support_sessions_v2(uuid,integer) from public, anon, service_role;
grant execute on function public.list_operator_channel_connections_v2(uuid,text,text,text,text,integer), public.list_operator_support_sessions_v2(uuid,integer) to authenticated;
