create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.role()) = 'service_role'
    or (
      (select auth.uid()) is not null
      and exists (
        select 1
        from public.workspace_members as member
        where member.workspace_id = p_workspace_id
          and member.user_id = (select auth.uid())
          and member.status = 'active'
      )
    );
$$;

revoke all on function public.reserve_workspace_credits(uuid, text, integer, text, uuid) from authenticated;
revoke all on function public.settle_credit_reservation(uuid, uuid, integer, text) from authenticated;
revoke all on function public.release_credit_reservation(uuid, uuid, integer, text) from authenticated;

grant execute on function public.reserve_workspace_credits(uuid, text, integer, text, uuid) to service_role;
grant execute on function public.settle_credit_reservation(uuid, uuid, integer, text) to service_role;
grant execute on function public.release_credit_reservation(uuid, uuid, integer, text) to service_role;
