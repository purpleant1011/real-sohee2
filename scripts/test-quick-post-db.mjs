import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Own throwaway PostgreSQL cluster only; never read application credentials.
const root = resolve(import.meta.dirname, '..')
const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const postgrest = process.env.POSTGREST_BIN
if (!postgrest || !existsSync(postgrest)) throw new Error('Set POSTGREST_BIN to an installed official PostgREST binary')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-quick-post-db-'))
const cluster = join(temporary, 'cluster')
const port = String(54000 + Math.floor(Math.random() * 9000))
const restPort = String(32000 + Math.floor(Math.random() * 9000))
const env = { ...process.env, PGHOST: temporary, PGPORT: port, PGDATABASE: 'sohee_quick_post_test', PGUSER: process.env.USER, LC_ALL: 'C' }
let rest
let test
function call(name, args) {
  const result = spawnSync(join(bin, name), args, { env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
  return result.stdout
}
function cleanup() {
  test?.kill('SIGTERM')
  rest?.kill('SIGTERM')
  if (existsSync(join(cluster, 'postmaster.pid'))) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temporary, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(1) })
try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-p ${port} -k ${temporary} -h ''`, '-l', join(temporary, 'postgres.log'), '-w', 'start'])
  call('createdb', [env.PGDATABASE])
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'create table public.marketing_missions (id uuid primary key, workspace_id uuid not null, status text not null, metadata jsonb not null, created_at timestamptz not null);'])
  rest = spawn(postgrest, [], { env: { ...env, PGRST_DB_URI: `postgresql:///${env.PGDATABASE}?host=${temporary}&port=${port}`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: env.PGUSER, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: restPort, PGRST_LOG_LEVEL: 'error' }, stdio: 'inherit' })
  const url = `http://127.0.0.1:${restPort}`
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${url}/marketing_missions?limit=0`)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Isolated PostgREST failed to start')
  console.log('Isolated PostgreSQL 16 + PostgREST ready; no production database connection.')
  test = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/integration/quick-post/query.test.ts'], { cwd: root, env: { ...env, QUICK_POST_TEST_REST_URL: url }, stdio: 'inherit' })
  process.exitCode = await new Promise((resolve, reject) => { test.on('error', reject); test.on('exit', code => resolve(code ?? 1)) })
  test = null
} finally { cleanup() }
