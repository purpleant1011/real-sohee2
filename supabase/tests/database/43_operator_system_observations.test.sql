begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

select has_table('public', 'operator_system_observation_snapshots', 'external system observation snapshots exist');
select has_function('public', 'get_operator_system_observations', array[]::text[], 'operator system observation RPC exists');
select ok(
  to_regprocedure('public.get_operator_system_observations()') is not null
    and has_function_privilege('authenticated', 'public.get_operator_system_observations()', 'EXECUTE'),
  'authenticated operators can execute the observation RPC'
);
select ok(
  to_regprocedure('public.get_operator_system_observations()') is null
    or not has_function_privilege('anon', 'public.get_operator_system_observations()', 'EXECUTE'),
  'anonymous users cannot execute the observation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.operator_system_observation_snapshots', 'SELECT'),
  'authenticated users cannot read observation snapshots directly'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.operator_system_observation_snapshots'::regclass),
  'observation snapshots retain RLS'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'operator_system_observation_snapshots_safe_code_check'
      and conrelid = 'public.operator_system_observation_snapshots'::regclass
      and position('[A-Z]' in pg_get_constraintdef(oid)) > 0
  ),
  'snapshot safe codes use a bounded uppercase event-code check'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%system.read%',
  'observation RPC enforces system.read'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%aal2%',
  'observation RPC enforces MFA assurance'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%conversation_jobs%',
  'observation RPC reads safe conversation job state'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%provider_webhook_events%',
  'observation RPC reads safe webhook state'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%operation_events%',
  'observation RPC reads safe operation event state'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%operator_system_observation_snapshots%',
  'observation RPC reads external observation snapshots'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) not like '%payload%'
    and pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) not like '%raw_log%'
    and pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) not like '%secret%',
  'observation RPC does not project raw payloads or secrets'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%freshness%',
  'observation RPC returns freshness'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%unknown%',
  'observation RPC preserves unknown state'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%dead_letter%',
  'observation RPC exposes only dead letter counts'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%needs_attention%',
  'observation RPC exposes only safe job attention state'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%observed_at%',
  'observation RPC includes source timestamp semantics'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%24 hours%',
  'DB observations are limited to the recent 24 hour window'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%observation_window%',
  'observation RPC declares its observation window'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%> statement_timestamp()%',
  'future source timestamps become unknown freshness'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) not like '%cloudflare_api_token%'
    and pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) not like '%wrangler%',
  'observation RPC does not expose deployment credentials or config'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%status = ''active''%',
  'observation RPC rejects inactive operators'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%auth.uid()%',
  'observation RPC binds to the current actor'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%workspace_id is null%',
  'observation RPC requires global system scope'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%metric_value%',
  'observation RPC returns bounded metric values only'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.get_operator_system_observations()')) like '%observed_at%',
  'observation RPC returns observed timestamps'
);
select ok(
  not has_table_privilege('anon', 'public.operator_system_observation_snapshots', 'SELECT'),
  'anonymous users cannot read observation snapshots directly'
);

rollback;
