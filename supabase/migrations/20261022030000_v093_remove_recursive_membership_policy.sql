-- ANI-1587 / ANI-1591: legacy replay creates a second, recursive membership
-- SELECT policy. It references workspace_members from workspace_members RLS,
-- causing 42P17 for authenticated queries (including reservations/funnel joins).
-- Production already lacks this obsolete policy; this is a drift-safe no-op there.
-- Retain the original active-peer policy and its fixed-search_path private helper.
begin;
drop policy if exists "Members view own workspace_members" on public.workspace_members;

-- Fail closed if the intended active membership policy has unexpectedly vanished.
do $$ begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.workspace_members'::regclass
      and polname = 'workspace members can read active peers'
  ) then
    raise exception 'Active workspace membership policy missing; review schema drift before applying';
  end if;
end $$;
commit;
-- Rollback: do not recreate the recursive policy. If deployment has to stop,
-- keep this no-op/security correction and roll back the application independently.
