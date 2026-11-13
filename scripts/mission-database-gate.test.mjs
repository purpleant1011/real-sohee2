import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { allowedVersions, baselineVersions, buildGateSql, connectionEnvironment, loadMigrations, planDigest, validateApplyApproval } from './mission-database-gate.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Exercise the complete repository inventory, without excluding conflicting files.
const directory = join(root, 'supabase/migrations')
const migrations = readdirSync(directory).filter(file => file.endsWith('.sql')).sort().map(file => ({
  version: file.split('_')[0], name: file.replace(/^\d+_/, '').replace(/\.sql$/, ''), sql: readFileSync(join(directory, file), 'utf8'),
}))
const quote = text => `'${text.replaceAll("'", "''")}'`
const digest = planDigest(migrations)
const approval = {
  GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40),
  MISSION_MIGRATION_APPLY_ENABLED: 'true', MISSION_MIGRATION_APPROVAL: 'apply-mission-contract',
  MISSION_APPROVED_SHA: 'a'.repeat(40), MISSION_APPROVED_PLAN: digest,
}

describe('mission database offline policy', () => {
  it('loads the actual repository history with unique versions and the exact allowlisted names', () => {
    const actual = loadMigrations()
    expect(new Set(actual.map(m => m.version)).size).toBe(actual.length)
    expect(actual.filter(m => allowedVersions.includes(m.version)).map(m => m.name)).toEqual([
      'ani1796_mission_events_composite_fk', 'ani1877_mission_contract_hardening',
    ])
  })
  it('still fails before any connection on a new timestamp collision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sohee-gate-collision-'))
    try {
      writeFileSync(join(directory, '20270101000000_a.sql'), 'select 1;')
      writeFileSync(join(directory, '20270101000000_b.sql'), 'select 2;')
      expect(() => loadMigrations(directory)).toThrow('LOCAL_HISTORY_CONFLICT')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('defaults to read-only SQL without migration execution or history writes', () => {
    const sql = buildGateSql('preflight', migrations)
    expect(sql).toMatch(/^BEGIN READ ONLY;/)
    expect(sql).not.toContain('INSERT INTO supabase_migrations')
    expect(sql).not.toContain('\\\\if :pending') // migration SQL appears only as an inert comparison literal
    expect(buildGateSql('ready', migrations)).toMatch(/^BEGIN READ ONLY;/)
    expect(() => buildGateSql('push', migrations)).toThrow('INVALID_GATE_MODE')
  })
  it('pins only the two allowed revisions, never a pending glob or baseline replay', () => {
    const sql = buildGateSql('apply', migrations)
    expect(allowedVersions).toEqual(['20261027100000', '20261027110000'])
    expect((sql.match(/INSERT INTO supabase_migrations/g) || [])).toHaveLength(2)
    expect(sql).toContain('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE')
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS public.marketing_missions')
    expect(sql.indexOf('RPC_CONTRACT_OR_PRIVILEGE_DRIFT')).toBeLessThan(sql.lastIndexOf('COMMIT;'))
    expect(planDigest([...migrations].reverse())).not.toBe(digest)
  })
  it.each(Object.keys(approval))('requires each independent apply approval: %s', key => {
    expect(() => validateApplyApproval({ ...approval, [key]: '' }, digest)).toThrow('MANUAL_APPROVAL_REQUIRED')
  })
  it('accepts only a fully pinned manual approval', () => {
    expect(() => validateApplyApproval(approval, digest)).not.toThrow()
    expect(() => validateApplyApproval({ ...approval, GITHUB_REF: 'refs/heads/feature' }, digest)).toThrow()
  })
  it('never discovers credentials, inherits PG options, or puts secrets in argv', () => {
    expect(() => connectionEnvironment({})).toThrow('DATABASE_CONFIGURATION_REQUIRED')
    const env = connectionEnvironment({ MISSION_DATABASE_URL: 'postgresql://test:secret@127.0.0.1/test', MISSION_DATABASE_HOST: '127.0.0.1', MISSION_DATABASE_NAME: 'test', PGOPTIONS: '-c dangerous=on' })
    expect(env.PGOPTIONS).toBeUndefined()
    expect(env.PGSSLMODE).toBe('disable')
    expect(() => connectionEnvironment({ MISSION_DATABASE_URL: 'postgresql://test:secret@other/test', MISSION_DATABASE_HOST: 'expected', MISSION_DATABASE_NAME: 'test' })).toThrow('DATABASE_TARGET_MISMATCH')
    expect(() => connectionEnvironment({ MISSION_DATABASE_URL: 'postgresql://test:secret@expected/test?sslmode=disable', MISSION_DATABASE_HOST: 'expected', MISSION_DATABASE_NAME: 'test' })).toThrow()
    expect(connectionEnvironment({ MISSION_DATABASE_URL: 'postgresql://test:secret@expected/test', MISSION_DATABASE_HOST: 'expected', MISSION_DATABASE_NAME: 'test' }).PGSSLMODE).toBe('verify-full')
  })
  it('keeps workflow manual, separate protected approval and deploy readiness before build', () => {
    const workflow = readFileSync(join(root, '.github/workflows/mission-database-migration.yml'), 'utf8')
    expect(workflow).not.toMatch(/\n  (push|pull_request|workflow_run):/)
    expect(workflow).toContain('default: false')
    expect(workflow).toContain('.prevent_self_review == true')
    expect(workflow).toContain('.can_admins_bypass == false')
    expect(workflow).toContain('environment: production-migrations')
    expect(workflow).toContain('needs: preflight')
    expect(workflow).toContain('origin/main')
    const deploy = readFileSync(join(root, 'scripts/deploy-cloudflare-production.mjs'), 'utf8')
    expect(deploy.indexOf("['scripts/sns-release-database-gate.mjs', 'ready']")).toBeLessThan(deploy.indexOf("['scripts/cloudflare-build.mjs']"))
  })
})

// Explicit opt-in only: starts a NEW isolated PG16 cluster; never reads production env/files.
const local = process.env.MISSION_GATE_LOCAL_PG16 === '1'
describe.skipIf(!local)('isolated PG16 migration execution', () => {
  let temporary
  let bin
  let env
  let sequence = 0
  function command(name, args, input) {
    return spawnSync(join(bin, name), args, { env, input, encoding: 'utf8', timeout: 30_000 })
  }
  function execute(sql, database = 'postgres') {
    return command('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', '-'], sql)
  }
  function requireSuccess(result) {
    expect(result.stderr, 'isolated PostgreSQL SQL error').not.toMatch(/ERROR|FATAL/)
    expect(result.status, `${result.error?.message || ''}\n${result.stderr}\n${result.stdout}`).toBe(0)
  }
  beforeAll(() => {
    bin = process.env.MISSION_GATE_PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
    // macOS tmpdir paths can exceed PostgreSQL's Unix socket path limit.
    temporary = mkdtempSync('/tmp/sohee-mission-gate-')
    env = { PATH: bin, HOME: temporary, LC_ALL: 'C', LANG: 'C', PGHOST: temporary, PGPORT: '55487', PGUSER: 'postgres', PGSSLMODE: 'disable', PGPASSFILE: '/nonexistent' }
    requireSuccess(command('initdb', ['-D', join(temporary, 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale']))
    const started = command('pg_ctl', ['-D', join(temporary, 'data'), '-l', join(temporary, 'server.log'), '-o', `-k ${temporary} -p 55487 -c listen_addresses=''`, '-w', 'start'])
    if (started.status !== 0) throw new Error(readFileSync(join(temporary, 'server.log'), 'utf8'))
    requireSuccess(started)
    requireSuccess(execute(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`))
    expect(execute('SHOW server_version_num;').stdout.trim()).toMatch(/^16\d{4}$/)
  }, 60_000)
  afterAll(() => {
    if (temporary) {
      command('pg_ctl', ['-D', join(temporary, 'data'), '-m', 'immediate', '-w', 'stop'])
      rmSync(temporary, { recursive: true, force: true })
    }
  })
  function fixture() {
    const database = `gate_${++sequence}`
    requireSuccess(execute(`CREATE DATABASE ${database};`))
    const baseline = `
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE public.workspaces(id uuid PRIMARY KEY, created_by uuid);
      CREATE TABLE public.workspace_members(workspace_id uuid, user_id uuid, status text);
      ${['messages', 'conversation_jobs', 'content_items', 'content_versions', 'approvals'].map(table => `CREATE TABLE public.${table}(id uuid PRIMARY KEY);`).join('\n')}
      CREATE TABLE public.external_action_requests(id uuid PRIMARY KEY, workspace_id uuid, exact_payload jsonb, UNIQUE(workspace_id,id));
      CREATE TABLE public.external_action_receipts(id uuid PRIMARY KEY, workspace_id uuid, action_request_id uuid, receipt_kind text, observed_payload jsonb, status text, verified_at timestamptz, recorded_at timestamptz, created_at timestamptz, UNIQUE(workspace_id,id));
      ALTER TABLE public.external_action_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.external_action_receipts ENABLE ROW LEVEL SECURITY;
      ${migrations.find(m => m.version === '20260910080000').sql}
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
      ${baselineVersions.map(version => `INSERT INTO supabase_migrations.schema_migrations VALUES ('${version}',${quote(migrations.find(m => m.version === version).name)},ARRAY['baseline fixture']);`).join('\n')}
    `
    requireSuccess(execute(baseline, database))
    return database
  }
  it('preflight reads only; ready blocks missing RPCs; apply/ready/reapply succeed atomically', () => {
    const db = fixture()
    requireSuccess(execute(buildGateSql('preflight', migrations), db))
    expect(execute(buildGateSql('ready', migrations), db).status).not.toBe(0)
    requireSuccess(execute(buildGateSql('apply', migrations), db))
    requireSuccess(execute(buildGateSql('ready', migrations), db))
    requireSuccess(execute(buildGateSql('preflight', migrations), db))
    requireSuccess(execute(buildGateSql('apply', migrations), db))
    expect(execute('SELECT count(*) FROM supabase_migrations.schema_migrations;', db).stdout.trim()).toBe('5')
  })
  it('rolls back first revision DDL and ledger when the later revision fails', () => {
    const db = fixture()
    const broken = migrations.map(m => m.version === allowedVersions[1] ? { ...m, sql: m.sql + '\nSELECT 1/0;' } : m)
    expect(execute(buildGateSql('apply', broken), db).status).not.toBe(0)
    expect(execute("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20261027%';", db).stdout.trim()).toBe('0')
    expect(execute("SELECT to_regclass('public.mission_action_receipts') IS NULL;", db).stdout.trim()).toBe('t')
    expect(execute("SELECT to_regprocedure('public.update_mission_snapshot_atomic(uuid,uuid,integer,jsonb,text,text,uuid,text,text,text,jsonb,jsonb)') IS NULL;", db).stdout.trim()).toBe('t')
  })
  it('accepts a known first revision and applies only the second', () => {
    const db = fixture()
    const first = migrations.find(m => m.version === allowedVersions[0])
    requireSuccess(execute(`${first.sql}\nINSERT INTO supabase_migrations.schema_migrations VALUES ('${first.version}',${quote(first.name)},ARRAY[${quote(first.sql)}]);`, db))
    requireSuccess(execute(buildGateSql('preflight', migrations), db))
    requireSuccess(execute(buildGateSql('apply', migrations), db))
    requireSuccess(execute(buildGateSql('ready', migrations), db))
  })
  it.each([
    ['missing baseline column', 'ALTER TABLE public.external_action_receipts DROP COLUMN verified_at;'],
    ['wrong baseline type', 'ALTER TABLE public.external_action_receipts ALTER COLUMN status TYPE integer USING NULL;'],
    ['untracked partial schema', 'ALTER TABLE public.external_action_requests ADD COLUMN mission_id uuid;'],
    ['ledger alias', "UPDATE supabase_migrations.schema_migrations SET version = '19990101000000' WHERE version = '20260910080000';"],
    ['name conflict', "UPDATE supabase_migrations.schema_migrations SET name = 'wrong' WHERE version = '20260910080000';"],
    ['cross-tenant event data', "INSERT INTO public.workspaces(id) VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'); INSERT INTO public.marketing_missions(id,workspace_id,trace_id,goal) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','t','test'); INSERT INTO public.mission_events(workspace_id,mission_id,trace_id,to_status,actor_type,event_name) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','t','RECEIVED','agent','test');"],
  ])('blocks %s without applying any revision', (_name, mutation) => {
    const db = fixture()
    requireSuccess(execute(mutation, db))
    expect(execute(buildGateSql('preflight', migrations), db).status).not.toBe(0)
    expect(execute(buildGateSql('apply', migrations), db).status).not.toBe(0)
    expect(execute("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20261027%';", db).stdout.trim()).toBe('0')
  })
  it.each([
    ['public execution', 'GRANT EXECUTE ON FUNCTION public.create_mission_with_contract_atomic TO PUBLIC;'],
    ['authenticated execution', 'GRANT EXECUTE ON FUNCTION public.update_mission_snapshot_atomic TO authenticated;'],
    ['missing service execution', 'REVOKE EXECUTE ON FUNCTION public.create_mission_with_contract_atomic FROM service_role;'],
    ['RPC missing', "ALTER FUNCTION public.create_mission_with_contract_atomic RENAME TO unexpected;"],
    ['RPC body drift', migrations.find(m => m.version === allowedVersions[1]).sql.match(/CREATE OR REPLACE FUNCTION public\.create_mission_with_contract_atomic[\s\S]*?\$\$;/)[0].replace('[INVALID_TRACE]', '[CHANGED_TRACE]')],
    ['RPC overload', "CREATE FUNCTION public.create_mission_with_contract_atomic(integer) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';"],
    ['FK drift', 'ALTER TABLE public.external_action_requests DROP CONSTRAINT external_action_requests_workspace_mission_fkey;'],
    ['unique index drift', 'DROP INDEX public.idx_mission_action_receipts_workspace_receipt_unique;'],
    ['empty ledger statements', "UPDATE supabase_migrations.schema_migrations SET statements = ARRAY[]::text[] WHERE version = '20261027110000';"],
  ])('ready blocks %s', (_name, mutation) => {
    const db = fixture()
    requireSuccess(execute(buildGateSql('apply', migrations), db))
    requireSuccess(execute(mutation, db))
    expect(execute(buildGateSql('ready', migrations), db).status).not.toBe(0)
    expect(execute(buildGateSql('preflight', migrations), db).status).not.toBe(0)
  })
})
