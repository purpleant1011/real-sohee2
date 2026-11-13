create or replace function public.list_checkout_intents(p_workspace_id uuid, p_state text default null, p_limit integer default 20)
returns table (id uuid, workspace_id uuid, billing_plan_id uuid, state text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_workspace_member(p_workspace_id) then raise exception 'CHECKOUT_FORBIDDEN' using errcode = 'P0001'; end if;
  if p_limit not between 1 and 50 or (p_state is not null and p_state not in ('draft','provider_pending','provider_succeeded','activation_succeeded','failed','cancelled')) then raise exception 'CHECKOUT_HISTORY_INVALID' using errcode = 'P0001'; end if;
  return query select intent.id, intent.workspace_id, intent.billing_plan_id, intent.state, intent.created_at from public.checkout_intents intent where intent.workspace_id = p_workspace_id and (p_state is null or intent.state = p_state) order by intent.created_at desc, intent.id desc limit p_limit;
end; $$;
revoke all on function public.list_checkout_intents(uuid, text, integer) from public, anon;
grant execute on function public.list_checkout_intents(uuid, text, integer) to authenticated, service_role;
