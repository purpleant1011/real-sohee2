import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Own UNIX-socket-only throwaway cluster. Never reads production connection variables.
const bin = '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-connectors-db-'))
const cluster = join(temporary, 'cluster')
const env = { ...process.env, PGHOST: temporary, PGPORT: '55973', PGDATABASE: 'postgres', PGUSER: process.env.USER, LC_ALL: 'C' }
let started = false
function call(name, args) {
  const result = spawnSync(join(bin, name), args, { encoding: 'utf8', env, timeout: 60000 })
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr || result.error?.message || result.stdout}`)
  return result.stdout
}
function sql(text) { return call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-c', text]) }
function cleanup() {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'ignore' })
  rmSync(temporary, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.exit(1) })
try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-p 55973 -k ${temporary} -h '' -c fsync=off`, '-l', join(temporary, 'postgres.log'), '-w', 'start'])
  started = true
  sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users(id uuid primary key);
    create table public.workspaces(id uuid primary key, created_by uuid references auth.users(id));
    create table public.workspace_members(workspace_id uuid references public.workspaces(id), user_id uuid references auth.users(id) on delete cascade, role text, status text);
    grant usage on schema public, auth to authenticated, service_role;
    grant select on public.workspace_members, public.workspaces to authenticated;
  `)
  const migration = join(root, 'supabase/migrations/20261110160000_marketing_connectors_foundation.sql')
  if (!existsSync(migration)) throw new Error('Connector migration missing')
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migration])
  const assertions = join(root, 'supabase/tests/database/marketing-connectors-foundation.sql')
  if (!existsSync(assertions)) throw new Error('Connector DB assertions missing')
  console.log(sql(readFileSync(assertions, 'utf8')))
  console.log('Connector migration and RLS/RPC assertions PASS (isolated PostgreSQL 16).')
} finally { cleanup() }
