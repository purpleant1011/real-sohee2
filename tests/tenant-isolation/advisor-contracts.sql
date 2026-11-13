-- ANI-1591: warning != exploit. Validate effective grants and real guard execution.
begin;
create function pg_temp.check_security(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'SECURITY CONTRACT FAILED: %',label; end if; end $$;

do $$ declare relation_name text; role_name text; view_row record; begin
 foreach relation_name in array array[
 'private.connector_execution_scope_state','private.local_publish_execution_scopes',
 'public.credit_grant_campaigns','public.quick_post_credit_reservations',
 'public.safety_intervention_executions','public.sohee_curiosity_decisions',
 'public.sohee_goals','public.sohee_studio_proposals'] loop
  perform pg_temp.check_security((select relrowsecurity from pg_class where oid=relation_name::regclass),relation_name||' RLS');
  foreach role_name in array array['anon','authenticated'] loop
   perform pg_temp.check_security(not has_table_privilege(role_name,relation_name,'SELECT,INSERT,UPDATE,DELETE'),relation_name||' no client grants');
  end loop;
  perform pg_temp.check_security(has_table_privilege('service_role',relation_name,'SELECT'),relation_name||' intended server access');
 end loop;
 for view_row in select c.oid,c.relname,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='v' and n.nspname='public' and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT')) loop
  perform pg_temp.check_security(view_row.reloptions @> array['security_invoker=true'],view_row.relname||' invoker view');
 end loop;
end $$;

-- Non-operator authenticated callers must not retrieve any operator projection.
-- Context/setup endpoints intentionally return a non-operator context, so they
-- are separately classified rather than mistakenly revoked with admin APIs.
insert into auth.users(id) values ('d3999999-9999-4999-8999-999999999999');
select set_config('request.jwt.claim.sub','d3999999-9999-4999-8999-999999999999',true);
select set_config('request.jwt.claims','{"sub":"d3999999-9999-4999-8999-999999999999","role":"authenticated","aal":"aal2"}',true);
do $$ declare f record; args text; rejected boolean; count_checked int:=0; begin
 for f in select p.oid,p.proname,p.proargtypes,p.proconfig,p.pronargs,p.pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')
 and (p.proname like 'list_operator_%' or p.proname like 'get_operator_%') loop
  count_checked:=count_checked+1;
  perform pg_temp.check_security(f.proconfig is not null and exists(select 1 from unnest(f.proconfig) setting where setting like 'search_path=%'),f.proname||' fixed search_path');
  perform pg_temp.check_security(not has_function_privilege('anon',f.oid,'EXECUTE'),f.proname||' anon denied');
  -- Omit optional arguments so real endpoint defaults (e.g. limit=100) apply.
  select string_agg('null::'||format_type(typ,null),',') into args
  from unnest(f.proargtypes::oid[]) with ordinality arg(typ,position)
  where position <= f.pronargs-f.pronargdefaults;
  set local role authenticated;
  rejected:=false;
  begin execute format('select public.%I(%s)',f.proname,args);
  exception when raise_exception then
   if sqlerrm not in ('OPERATOR_DISABLED','OPERATOR_UNAUTHENTICATED','AUTH_REQUIRED','MFA_REQUIRED','PERMISSION_DENIED','OPERATOR_PERMISSION_DENIED') then raise; end if;
   rejected:=true;
  end;
  reset role;
  perform pg_temp.check_security(rejected,f.proname||' real non-operator call');
 end loop;
 perform pg_temp.check_security(count_checked>=19,'operator function coverage');
end $$;
-- Obsolete raw-replay RPCs: deny actual client calls but preserve server reads.
do $$ declare signature text; role_name text; rejected boolean; result jsonb; begin
 foreach signature in array array['get_operator_control_tower_summary()', 'get_operator_agent_runs()'] loop
  foreach role_name in array array['anon','authenticated'] loop
   execute format('set local role %I',role_name);
   rejected:=false;
   begin execute 'select public.'||signature into result;
   exception when insufficient_privilege then rejected:=true; end;
   reset role;
   perform pg_temp.check_security(rejected,signature||' legacy actual client denied');
  end loop;
  set local role service_role;
  execute 'select public.'||signature into result;
  reset role;
  perform pg_temp.check_security(result is not null,signature||' server positive read');
 end loop;
end $$;

-- ANI-1591 least privilege: anon and authenticated must never hold TRUNCATE, TRIGGER, or REFERENCES on public tables.
-- TRUNCATE is not guarded by Row-Level Security.
do $$ declare r record; count_tables int := 0; begin
 for r in select tablename from pg_tables where schemaname = 'public' and tablename not in ('spatial_ref_sys') loop
  count_tables := count_tables + 1;
  perform pg_temp.check_security(not has_table_privilege('anon', 'public.'||r.tablename, 'TRUNCATE'), 'public.'||r.tablename||' anon TRUNCATE denied');
  perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.'||r.tablename, 'TRUNCATE'), 'public.'||r.tablename||' authenticated TRUNCATE denied');
  perform pg_temp.check_security(not has_table_privilege('anon', 'public.'||r.tablename, 'TRIGGER'), 'public.'||r.tablename||' anon TRIGGER denied');
  perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.'||r.tablename, 'TRIGGER'), 'public.'||r.tablename||' authenticated TRIGGER denied');
  perform pg_temp.check_security(not has_table_privilege('anon', 'public.'||r.tablename, 'REFERENCES'), 'public.'||r.tablename||' anon REFERENCES denied');
  perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.'||r.tablename, 'REFERENCES'), 'public.'||r.tablename||' authenticated REFERENCES denied');
 end loop;
 perform pg_temp.check_security(count_tables >= 10, 'public table truncate coverage');
end $$;

-- ANI-1591 Invariant 1: service_role and cluster owner retain TRUNCATE and DML capabilities
do $$ begin
 perform pg_temp.check_security(has_table_privilege('service_role', 'public.reservations', 'TRUNCATE'), 'service_role reservations TRUNCATE preserved');
 perform pg_temp.check_security(has_table_privilege('service_role', 'public.reservations', 'SELECT,INSERT,UPDATE,DELETE'), 'service_role reservations DML preserved');
 perform pg_temp.check_security(has_table_privilege(current_user, 'public.reservations', 'TRUNCATE'), 'cluster owner reservations TRUNCATE preserved');
 -- Execute real TRUNCATE under service_role
 set local role service_role;
 truncate table public.reservations restart identity cascade;
 reset role;
end $$;

-- ANI-1591 Invariant 2 & 3: authenticated retains normal RLS DML, and absence of REFERENCES does NOT break FK checks or DML
do $$ declare ws_id uuid := 'a0000000-0000-4000-8000-000000000001'::uuid; u_id uuid := 'd1000000-0000-4000-8000-000000000001'::uuid; res_id text; rejected_fk boolean; begin
 -- Seed test workspace and membership
 insert into auth.users (id) values (u_id) on conflict do nothing;
 insert into public.workspaces (id, name, created_by) values (ws_id, 'Test WS', u_id) on conflict do nothing;
 insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, u_id, 'owner') on conflict do nothing;

 -- Set claims as authenticated user
 perform set_config('request.jwt.claim.sub', u_id::text, true);
 perform set_config('request.jwt.claims', jsonb_build_object('sub', u_id::text, 'role', 'authenticated')::text, true);

 set local role authenticated;

 -- Normal SELECT/INSERT/UPDATE/DELETE (RLS allowed path)
 perform pg_temp.check_security(has_table_privilege('authenticated', 'public.reservations', 'SELECT'), 'authenticated SELECT preserved');
 perform pg_temp.check_security(has_table_privilege('authenticated', 'public.reservations', 'INSERT'), 'authenticated INSERT preserved');
 perform pg_temp.check_security(has_table_privilege('authenticated', 'public.reservations', 'UPDATE'), 'authenticated UPDATE preserved');
 perform pg_temp.check_security(has_table_privilege('authenticated', 'public.reservations', 'DELETE'), 'authenticated DELETE preserved');

 -- Insert valid row referencing parent workspace (FK integrity passes without client REFERENCES privilege)
 insert into public.reservations (id, workspace_id, slot_id, customer_id, customer_name, status)
 values ('bk_test_invar_001', ws_id, 'slot_invar_001', 'cust_001', '홍길동', 'CONFIRMED')
 returning id into res_id;
 perform pg_temp.check_security(res_id = 'bk_test_invar_001', 'authenticated valid FK insert succeeded');

 -- Verify update under RLS
 update public.reservations set customer_name = '김철수' where id = 'bk_test_invar_001';
 perform pg_temp.check_security((select customer_name from public.reservations where id = 'bk_test_invar_001') = '김철수', 'authenticated update succeeded');

 -- Verify invalid FK insertion (non-existent mission_id under valid workspace) is properly rejected by FK constraint
 rejected_fk := false;
 begin
  insert into public.reservations (id, workspace_id, slot_id, customer_id, customer_name, status, mission_id)
  values ('bk_test_invar_bad', ws_id, 'slot_invar_bad', 'cust_001', '악성FK', 'CONFIRMED', 'd9999999-9999-4999-8999-999999999999'::uuid);
 exception when foreign_key_violation then
  rejected_fk := true;
 end;
 perform pg_temp.check_security(rejected_fk, 'invalid FK rejected by FK trigger');

 -- Delete under RLS
 delete from public.reservations where id = 'bk_test_invar_001';
 perform pg_temp.check_security(not exists(select 1 from public.reservations where id = 'bk_test_invar_001'), 'authenticated delete succeeded');

 reset role;
end $$;

-- ANI-1591 Invariant 4: Future tables created after migration inherit least privilege via ALTER DEFAULT PRIVILEGES
do $$ begin
 create table public.future_test_least_priv (id serial primary key, name text);
 perform pg_temp.check_security(not has_table_privilege('anon', 'public.future_test_least_priv', 'TRUNCATE'), 'future table anon TRUNCATE denied');
 perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.future_test_least_priv', 'TRUNCATE'), 'future table authenticated TRUNCATE denied');
 perform pg_temp.check_security(not has_table_privilege('anon', 'public.future_test_least_priv', 'TRIGGER'), 'future table anon TRIGGER denied');
 perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.future_test_least_priv', 'TRIGGER'), 'future table authenticated TRIGGER denied');
 perform pg_temp.check_security(not has_table_privilege('anon', 'public.future_test_least_priv', 'REFERENCES'), 'future table anon REFERENCES denied');
 perform pg_temp.check_security(not has_table_privilege('authenticated', 'public.future_test_least_priv', 'REFERENCES'), 'future table authenticated REFERENCES denied');
 perform pg_temp.check_security(has_table_privilege('service_role', 'public.future_test_least_priv', 'TRUNCATE'), 'future table service_role TRUNCATE preserved');
 drop table public.future_test_least_priv;
end $$;

select 'Internal grants, exposed invoker views and non-operator RPC guards verified';
select case when to_regclass('public.waitlist_signups') is null
 then 'NOT_VERIFIED: production-only waitlist table/RPC is absent from raw migration history'
 else 'waitlist present: classify public entry point separately' end;
rollback;
