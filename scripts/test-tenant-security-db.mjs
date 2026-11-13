import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// No DATABASE_URL or remote credentials: this process owns a new socket-only cluster.
const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
if (process.getuid?.() === 0) throw new Error('Run as an unprivileged user')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-tenant-db-'))
const cluster = join(temporary, 'cluster')
const env = { ...process.env, LC_ALL: 'C', PGHOST: temporary, PGPORT: '5432', PGDATABASE: 'tenant_security', PGUSER: process.env.USER }
// libpq hostaddr/service overrides must never redirect the harness remotely.
delete env.PGHOSTADDR
delete env.PGSERVICE
delete env.PGSERVICEFILE
function call(name, args, input) {
  const result = spawnSync(join(bin, name), args, { input, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr?.slice(-4500) || result.error?.message}`)
  return result.stdout
}
function sql(input) { return call('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE], input) }
function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temporary, { recursive: true, force: true })
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => { cleanup(); process.exit(code) })
}
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
  // Emulate Supabase hosted environment default ACL where public tables inherit default grants for anon/authenticated/service_role
  sql("alter default privileges in schema public grant all on tables to anon, authenticated, service_role;")
  const migrations = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  let replayed = 0
  for (const file of migrations) {
    if (process.argv.includes('--sns-release-pipeline') && /^202610272(?:00000|10000|15000|20000)_/.test(file)) continue
    // Hosted ledger predates these two local-only revisions. Exercise forward repair without them.
    if ((process.argv.includes('--sns-forward-only') || process.argv.includes('--sns-release-pipeline')) && [
      '20261027100000_ani1796_mission_events_composite_fk.sql',
      '20261027110000_ani1877_mission_contract_hardening.sql',
    ].includes(file)) continue
    try { call('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', env.PGDATABASE, '-f', join(root, 'supabase/migrations', file)]) }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
    replayed++
  }
  if (process.argv.includes('--sns-release-pipeline')) {
    const { buildReleaseApplySql } = await import('./sns-release-database-gate.mjs')
    sql('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);')
    const historicalLedgerSql = "select md5(coalesce(jsonb_agg(to_jsonb(h) order by version)::text,'')) from supabase_migrations.schema_migrations h where version < '20261027200000';"
    let releaseSql = buildReleaseApplySql()
    if (process.argv.includes('--sns-sql-editor')) {
      const { buildSqlEditorRelease } = await import('./sns-release-sql-editor.mjs')
      const { releasePlanDigest } = await import('./sns-release-database-gate.mjs')
      // Explicit isolated fixture approval; this branch never connects to a hosted database.
      releaseSql = buildSqlEditorRelease({ approvedSha: 'a'.repeat(40), currentMainSha: 'a'.repeat(40), approvedPlan: releasePlanDigest(), confirmation: 'apply-sns-release' }, file => readFileSync(join(root, file), 'utf8')).sql
      sql("insert into supabase_migrations.schema_migrations values ('20200101000000','historical_fixture',ARRAY['SELECT 1;']);")
      const failed = releaseSql.replace('COMMIT;', "DO $fail$ BEGIN RAISE EXCEPTION 'INJECTED_EDITOR_FAILURE'; END $fail$; COMMIT;")
      let rolledBack = false
      try { sql(failed) } catch (error) { rolledBack = error.message.includes('INJECTED_EDITOR_FAILURE') }
      if (!rolledBack || sql("select count(*) from supabase_migrations.schema_migrations where version >= '20261027200000';").trim() !== '0'
          || sql("select to_regprocedure('public.sns_release_readiness()') is null;").trim() !== 't') throw new Error('SNS_EDITOR_ROLLBACK_FAILED')
      console.log('SQL Editor late failure rolls back all four revisions and readiness RPC')
    }
    const historicalLedger = sql(historicalLedgerSql)
    sql(releaseSql)
    sql(releaseSql)
    if (process.argv.includes('--sns-sql-editor')) {
      sql("update supabase_migrations.schema_migrations set name='drift_fixture' where version='20261027210000';")
      let blocked = false
      try { sql(releaseSql) } catch (error) { blocked = error.message.includes('SNS_RELEASE_HISTORY_DRIFT') }
      if (!blocked) throw new Error('SNS_EDITOR_DRIFT_NOT_BLOCKED')
      sql("update supabase_migrations.schema_migrations set name='first_post_atomic_publish_claim' where version='20261027210000';")
      const { releaseContract } = await import('./sns-release-database-gate.mjs')
      const ready = JSON.parse(sql('set role anon; select public.sns_release_readiness(); reset role;').trim())
      if (ready.ready !== true || ready.contract !== releaseContract) throw new Error('SNS_EDITOR_ANON_READINESS_FAILED')
      console.log('SQL Editor ledger drift rejected; exact anon readiness verified')
    }
    if (sql(historicalLedgerSql) !== historicalLedger) throw new Error('SNS_RELEASE_HISTORICAL_LEDGER_CHANGED')
    if (sql("select count(*) from supabase_migrations.schema_migrations where version in ('20261027200000','20261027210000','20261027215000','20261027220000');").trim() !== '4') throw new Error('SNS_RELEASE_LEDGER_MISMATCH')
    console.log('SNS forward-only pipeline and idempotent rerun verified in isolated PostgreSQL')
  }
  // Unlike the replay's constant identity, these stubs model each request's claims.
  sql(`create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create or replace function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' $$;
    grant usage on schema public, auth to anon, authenticated;
    grant usage on schema private to authenticated;`)
  console.log(`Replayed ${replayed} migrations in isolated PostgreSQL.`)
  for (const file of readdirSync(join(root, 'tests/tenant-isolation')).filter(f => f.endsWith('.sql')).sort()) {
    console.log(sql(readFileSync(join(root, 'tests/tenant-isolation', file), 'utf8')).trim())
    console.log(`PASS ${file}`)
  }
  if (process.argv.includes('--firstpost-web')) {
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/tenant-isolation/firstpost-web.test.ts', '--maxWorkers=1'], { cwd: root, env: { ...env, SOHEE_FIRSTPOST_WEB: '1' }, stdio: 'inherit' })
    if (result.status !== 0) throw new Error('First-post isolated web harness failed')
  }
  if (process.argv.includes('--publish-consumption')) {
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/tenant-isolation/publish-consumption-db.test.ts', '--maxWorkers=1'], { cwd: root, env, stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Atomic publish consumption DB verification failed')
  }
  if (process.argv.includes('--mobile-reply')) {
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/tenant-isolation/mobile-reply-db.test.ts', '--maxWorkers=1'], { cwd: root, env, stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Mobile reply draft real DB verification failed')
  }
  if (process.argv.includes('--runtime-control')) {
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/tenant-isolation/runtime-control-db.test.ts', '--maxWorkers=1'], { cwd: root, env, stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Runtime control real PostgreSQL readback failed')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { cleanup() }
