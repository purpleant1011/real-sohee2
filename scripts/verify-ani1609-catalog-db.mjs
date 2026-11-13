// RED probe: proves the catalog columns/FK do not exist before 20261022090300, then checks them after.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-ani1609-db-'))
const cluster = join(temporary, 'cluster')
const env = { ...process.env, LC_ALL: 'C', PGHOST: temporary, PGPORT: '5432', PGDATABASE: 'ani1609', PGUSER: process.env.USER }
delete env.PGHOSTADDR; delete env.PGSERVICE; delete env.PGSERVICEFILE

function call(name, args, input) {
  const result = spawnSync(join(bin, name), args, { input, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr?.slice(-4000) || result.error?.message}`)
  return result.stdout
}
function sql(input) { return call('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE], input) }
function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temporary, { recursive: true, force: true })
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(signal, () => { cleanup(); process.exit(code) })

const TARGET = '20261022090300_workspace_products_services_catalog_editor.sql'
let redExit = 0, greenExit = 0
try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-k ${temporary} -h '' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, '-l', join(temporary, 'postgres.log'), '-w', 'start'])
  call('createdb', [env.PGDATABASE])
  const replay = readFileSync(join(root, 'scripts/verify-fresh-db-replay.mjs'), 'utf8')
  const marker = 'const preambleSql = `'
  const start = replay.indexOf(marker)
  const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
  if (start < 0 || end < 0) throw new Error('Replay preamble changed')
  sql(replay.slice(start + marker.length, end).replaceAll('${DB_NAME}', env.PGDATABASE))

  const migrations = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  // Apply everything before the catalog editor migration: this is the RED baseline.
  for (const file of migrations) {
    if (file === TARGET) break
    sql(readFileSync(join(root, 'supabase/migrations', file), 'utf8'))
  }
  console.log(`RED baseline: replayed ${migrations.indexOf(TARGET)} migrations (before ${TARGET})`)

  // RED: the five columns and the composite FK must be absent.
  const before = sql(`
    select count(*) from information_schema.columns
    where table_schema='public' and table_name='workspace_products_services'
      and column_name in ('resource_name','cancellation_policy','valid_from','valid_until','knowledge_fact_id');`).trim()
  const fkBefore = sql(`
    select count(*) from pg_constraint where conname='workspace_products_services_knowledge_fact_fkey';`).trim()
  console.log(`RED columns_present=${before} (expect 0), fk_present=${fkBefore} (expect 0)`)
  if (before !== '0' || fkBefore !== '0') { console.error('RED FAILED: catalog columns already existed before the migration'); redExit = 1 }
  else console.log('RED PASS: catalog columns absent before migration (exit 0)')

  // Apply the target migration.
  call('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE, '-f', join(root, 'supabase/migrations', TARGET)])
  console.log(`GREEN: applied ${TARGET}`)

  const after = sql(`
    select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='workspace_products_services'
      and column_name in ('resource_name','cancellation_policy','valid_from','valid_until','knowledge_fact_id','duration_minutes');`).trim()
  const fkAfter = sql(`
    select pg_get_constraintdef(oid) from pg_constraint where conname='workspace_products_services_knowledge_fact_fkey';`).trim()
  const checks = sql(`
    select string_agg(conname, ',' order by conname) from pg_constraint
    where conrelid='public.workspace_products_services'::regclass and conname like 'workspace_products_services_%_check';`).trim()
  console.log(`GREEN columns=${after}`)
  console.log(`GREEN fk=${fkAfter}`)
  console.log(`GREEN checks=${checks}`)

  // duration_minutes must come from W5 (090100), not be re-added here: assert it is a single column and nullable.
  const dupCheck = sql(`
    select count(*) from information_schema.columns
    where table_schema='public' and table_name='workspace_products_services' and column_name='duration_minutes';`).trim()

  // --- Behavioural checks: composite FK + CHECKs, then RLS isolation.
  // Phase A commits its fixtures into the disposable cluster (the whole cluster is deleted at the end),
  // so Phase B can run each RLS probe in its own session as the `authenticated` role.
  const behaviour = sql(`
    \\set ON_ERROR_STOP on
    -- Results go through a temp table: psql sends NOTICE to stderr, and this harness reads stdout.
    create temp table check_results (name text primary key, value text not null);
    insert into auth.users (id, email) values
      ('aaaaaaaa-1111-4111-8111-111111111111','owner-a@example.test'),
      ('bbbbbbbb-2222-4222-8222-222222222222','owner-b@example.test');
    insert into public.workspaces (id, name, created_by) values
      ('11111111-1111-4111-8111-111111111111','A','aaaaaaaa-1111-4111-8111-111111111111'),
      ('22222222-2222-4222-8222-222222222222','B','bbbbbbbb-2222-4222-8222-222222222222');
    insert into public.workspace_members (workspace_id, user_id, role) values
      ('11111111-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111','owner'),
      ('22222222-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-222222222222','owner')
    on conflict (workspace_id, user_id) do nothing;
    insert into public.knowledge_sources (id, workspace_id, source_type, display_name, created_by_user_id) values
      ('dddddddd-4444-4444-8444-444444444401','11111111-1111-4111-8111-111111111111','manual','A 수기','aaaaaaaa-1111-4111-8111-111111111111'),
      ('dddddddd-4444-4444-8444-444444444402','22222222-2222-4222-8222-222222222222','manual','B 수기','bbbbbbbb-2222-4222-8222-222222222222');
    insert into public.knowledge_candidates
      (id, workspace_id, knowledge_source_id, category, content, status, created_by_user_id, reviewed_by_user_id, reviewed_at) values
      ('cccccccc-3333-4333-8333-333333333301','11111111-1111-4111-8111-111111111111','dddddddd-4444-4444-8444-444444444401','MENU','A 컷 30,000원 60분','approved','aaaaaaaa-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111', now()),
      ('cccccccc-3333-4333-8333-333333333302','22222222-2222-4222-8222-222222222222','dddddddd-4444-4444-8444-444444444402','MENU','B 컷 40,000원 90분','approved','bbbbbbbb-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-222222222222', now());
    insert into public.knowledge_facts (id, workspace_id, category, content, status, source_candidate_id, approved_by_user_id, approved_at) values
      ('eeeeeeee-5555-4555-8555-555555555501','11111111-1111-4111-8111-111111111111','MENU','A 컷 30,000원 60분','active','cccccccc-3333-4333-8333-333333333301','aaaaaaaa-1111-4111-8111-111111111111', now()),
      ('eeeeeeee-5555-4555-8555-555555555502','22222222-2222-4222-8222-222222222222','MENU','B 컷 40,000원 90분','active','cccccccc-3333-4333-8333-333333333302','bbbbbbbb-2222-4222-8222-222222222222', now());
    insert into public.workspace_products_services (id, workspace_id, name, price, duration_minutes) values
      ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','컷',30000,60),
      ('33333333-3333-4333-8333-333333333334','22222222-2222-4222-8222-222222222222','B 컷',40000,90);

    do $$ begin
      if (select count(*) from public.workspace_products_services
          where resource_name is null and cancellation_policy is null and valid_from is null
            and valid_until is null and knowledge_fact_id is null) = 2
      then insert into check_results values ('no_backfill', 'PASS');
      else insert into check_results values ('no_backfill', 'FAIL'); end if;
    end $$;

    do $$ begin
      update public.workspace_products_services
        set knowledge_fact_id = 'eeeeeeee-5555-4555-8555-555555555501'
        where id = '33333333-3333-4333-8333-333333333333';
      insert into check_results values ('same_workspace_fact_link', 'ACCEPTED');
    exception when others then
      insert into check_results values ('same_workspace_fact_link', 'REJECTED ' || sqlerrm);
    end $$;

    do $$ begin
      update public.workspace_products_services
        set knowledge_fact_id = 'eeeeeeee-5555-4555-8555-555555555502'
        where id = '33333333-3333-4333-8333-333333333333';
      insert into check_results values ('cross_tenant_fact_link', 'ACCEPTED');
    exception when others then
      insert into check_results values ('cross_tenant_fact_link', 'REJECTED ' || sqlerrm);
    end $$;

    do $$ begin
      update public.workspace_products_services
        set valid_from = '2026-12-01T00:00:00Z', valid_until = '2026-11-01T00:00:00Z'
        where id = '33333333-3333-4333-8333-333333333333';
      insert into check_results values ('valid_range', 'ACCEPTED');
    exception when others then
      insert into check_results values ('valid_range', 'REJECTED ' || sqlerrm);
    end $$;

    do $$ begin
      update public.workspace_products_services set resource_name = ''
        where id = '33333333-3333-4333-8333-333333333333';
      insert into check_results values ('empty_resource_name', 'ACCEPTED');
    exception when others then
      insert into check_results values ('empty_resource_name', 'REJECTED ' || sqlerrm);
    end $$;

    do $$ begin
      update public.workspace_products_services set cancellation_policy = repeat('가', 501)
        where id = '33333333-3333-4333-8333-333333333333';
      insert into check_results values ('long_cancellation_policy', 'ACCEPTED');
    exception when others then
      insert into check_results values ('long_cancellation_policy', 'REJECTED ' || sqlerrm);
    end $$;

    select 'CHECK ' || name || '=' || value from check_results order by name;
  `)

  const lines = behaviour.split('\n').filter((line) => line.startsWith('CHECK '))
  for (const line of lines) console.log(line)
  const check = (name) => lines.find((line) => line.startsWith(`CHECK ${name}=`))?.slice(`CHECK ${name}=`.length) ?? 'MISSING'

  // Phase B: RLS probes, each in its own session as `authenticated`.
  sql(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated;
  `)
  const rlsQuery = (sub, sqlText) => sql(`
    set role authenticated;
    set request.jwt.claim.sub = '${sub}';
    ${sqlText}
  `).trim()
  const seenA = rlsQuery('aaaaaaaa-1111-4111-8111-111111111111',
    `select coalesce(string_agg(workspace_id::text, ',' order by workspace_id), 'NONE') from public.workspace_products_services;`)
  const seenB = rlsQuery('bbbbbbbb-2222-4222-8222-222222222222',
    `select coalesce(string_agg(workspace_id::text, ',' order by workspace_id), 'NONE') from public.workspace_products_services;`)
  const crossWrite = rlsQuery('bbbbbbbb-2222-4222-8222-222222222222',
    `with touched as (update public.workspace_products_services set name='B가 A를 덮어씀'
       where id='33333333-3333-4333-8333-333333333333' returning 1)
     select count(*) from touched;`)
  console.log(`CHECK rls_visible_to_owner_a=${seenA}`)
  console.log(`CHECK rls_visible_to_owner_b=${seenB}`)
  console.log(`CHECK rls_cross_tenant_write_rows=${crossWrite}`)

  const greenOk =
    after === 'cancellation_policy,duration_minutes,knowledge_fact_id,resource_name,valid_from,valid_until' &&
    fkAfter.includes('FOREIGN KEY (workspace_id, knowledge_fact_id)') &&
    dupCheck === '1' &&
    check('no_backfill') === 'PASS' &&
    check('same_workspace_fact_link') === 'ACCEPTED' &&
    check('cross_tenant_fact_link').startsWith('REJECTED') &&
    check('valid_range').startsWith('REJECTED') &&
    check('empty_resource_name').startsWith('REJECTED') &&
    check('long_cancellation_policy').startsWith('REJECTED') &&
    seenA === '11111111-1111-4111-8111-111111111111' &&
    seenB === '22222222-2222-4222-8222-222222222222' &&
    crossWrite === '0'
  if (!greenOk) { console.error('GREEN FAILED: see CHECK lines above'); greenExit = 1 }
  else console.log('GREEN PASS: composite FK + CHECKs + RLS isolation behave as specified (exit 0)')
} catch (error) {
  console.error(`FATAL: ${error.message}`)
  greenExit = 1
} finally {
  cleanup()
}
console.log(`RESULT red_exit=${redExit} green_exit=${greenExit}`)
process.exit(redExit || greenExit)
