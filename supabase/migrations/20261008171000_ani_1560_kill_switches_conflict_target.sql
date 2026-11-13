-- apply_safety_intervention_ani1560 upserts with ON CONFLICT (scope, target_id).
-- Production only had the COALESCE expression index, which that clause cannot infer, so the
-- function would fail at first use there. kill_switches was empty at deploy time and the
-- upserted rows always carry a non-null target_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kill_switches'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (scope, target_id)'
  ) then
    alter table public.kill_switches
      add constraint kill_switches_scope_target_id_key unique (scope, target_id);
  end if;
end $$;

-- Rollback (manual only): alter table public.kill_switches drop constraint if exists kill_switches_scope_target_id_key;
