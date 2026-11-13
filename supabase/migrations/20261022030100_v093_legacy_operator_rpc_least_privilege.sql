-- ANI-1591: raw replay still creates two obsolete V0.2 operator aggregators.
-- They have no caller authorization and inherit PUBLIC EXECUTE by default.
-- Current production has neither function; never recreate them there.
begin;
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.get_operator_control_tower_summary()',
    'public.get_operator_agent_runs(integer,integer,text,uuid)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', signature);
      execute format('grant execute on function %s to service_role', signature);
      execute format('alter function %s set search_path = %L', signature, '');
    end if;
  end loop;
end $$;
commit;
-- Rollback: retain least-privilege grants. Restoring PUBLIC EXECUTE is unsafe.
-- Server callers continue to work through service_role; no table/data changes.
