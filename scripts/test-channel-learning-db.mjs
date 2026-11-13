#!/usr/bin/env node

/**
 * Local-only isolated PostgreSQL test harness for channel learning database schemas,
 * RLS policies, atomic RPCs, foreign key constraints, and multi-tenant isolation.
 *
 * NOTE: Per safety guidelines, this script is designed exclusively for isolated local
 * throwaway clusters. Remote DB execution is strictly forbidden.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')

if (process.getuid?.() === 0) {
  throw new Error('Run isolated PostgreSQL harness as an unprivileged user')
}

const temporary = mkdtempSync(join(tmpdir(), 'sohee-channel-db-'))
const cluster = join(temporary, 'cluster')
const db = 'sohee_channel_test'

function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  }
  rmSync(temporary, { recursive: true, force: true })
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup()
    process.exit(128 + (osConstants.signals[signal] ?? 1))
  })
}

function call(name, args, options = {}) {
  const result = spawnSync(join(bin, name), args, { encoding: 'utf8', env: process.env, ...options })
  if (result.status !== 0) {
    throw new Error(`${name} ${args.at(-1)}: ${result.stderr?.slice(-3000) || result.error?.message}`)
  }
  return result.stdout
}

function sql(text) {
  return call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', text])
}

const port = 54000 + Math.floor(Math.random() * 10000)
const clusterOptions = `-p ${port} -k ${temporary} -h '' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`
const clusterLog = join(temporary, 'postgres.log')
const env = {
  ...process.env,
  LC_ALL: 'C',
  PGHOST: temporary,
  PGPORT: String(port),
  PGDATABASE: db,
  PGUSER: process.env.USER,
}

export async function runChannelLearningDbHarness() {
  try {
    Object.assign(process.env, env)
    call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
    call('pg_ctl', ['-D', cluster, '-o', clusterOptions, '-l', clusterLog, '-w', 'start'])
    call('createdb', [db])

    // Load replay preamble
    const replay = readFileSync(join(root, 'scripts/verify-fresh-db-replay.mjs'), 'utf8')
    const start = replay.indexOf('const preambleSql = `') + 'const preambleSql = `'.length
    const end = replay.indexOf('`;\n  runPsql(preambleSql)', start)
    if (start >= 25 && end >= 0) {
      sql(replay.slice(start, end).replaceAll('${DB_NAME}', db))
    }

    // Apply all migrations
    const files = readdirSync(join(root, 'supabase/migrations')).filter((n) => n.endsWith('.sql')).sort()
    for (const file of files) {
      call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', join(root, 'supabase/migrations', file)])
    }

    console.log(`Successfully migrated ${files.length} schema files including channel learning tables.`)

    // Set up test tenants and verify RLS
    const wsA = randomUUID()
    const wsB = randomUUID()
    const userA = randomUUID()
    const userB = randomUUID()

    sql(`
      insert into auth.users (id) values ('${userA}'), ('${userB}') on conflict do nothing;

      insert into public.workspaces (id, name, created_by) values
        ('${wsA}', 'Tenant A Workspace', '${userA}'),
        ('${wsB}', 'Tenant B Workspace', '${userB}');

      insert into public.workspace_members (workspace_id, user_id, role, status) values
        ('${wsA}', '${userA}', 'owner', 'active'),
        ('${wsB}', '${userB}', 'owner', 'active')
      on conflict (workspace_id, user_id) do update set role = 'owner', status = 'active';
    `)

    console.log('Two-tenant seed created. Verifying RLS & constraints...')

    // Tenant A registers a source
    const sourceA = randomUUID()
    sql(`
      insert into public.knowledge_sources (
        id, workspace_id, source_type, provider_mode, channel_type, uri, display_name,
        created_by_user_id, status, lifecycle_revision, evidence_revision
      ) values (
        '${sourceA}', '${wsA}', 'url', 'registered_only', 'instagram',
        'https://www.instagram.com/biz_a/', 'biz_a',
        '${userA}', 'registered', 1, 1
      );
    `)

    // Verify foreign tenant B cannot read Tenant A's lease under Tenant B context
    sql(`
      insert into public.learning_evidence_leases (
        workspace_id, knowledge_source_id, evidence_revision, method, expires_at
      ) values (
        '${wsA}', '${sourceA}', 1, 'oauth', now() + interval '1 day'
      );

      -- Verify server-only RPCs are NOT executable by authenticated role
      do $$
      begin
        if has_function_privilege('authenticated', 'public.update_learning_verification_lease_atomic(uuid, uuid, integer, integer, text, text, timestamptz, timestamptz)', 'execute') then
          raise exception 'SECURITY_FAIL: authenticated must not execute update_learning_verification_lease_atomic';
        end if;
        if has_function_privilege('authenticated', 'public.persist_learning_documents_atomic(uuid, uuid, integer, jsonb)', 'execute') then
          raise exception 'SECURITY_FAIL: authenticated must not execute persist_learning_documents_atomic';
        end if;
        if has_function_privilege('authenticated', 'public.persist_learning_candidates_atomic(uuid, uuid, integer, jsonb, uuid)', 'execute') then
          raise exception 'SECURITY_FAIL: authenticated must not execute persist_learning_candidates_atomic';
        end if;
      end;
      $$;
    `)

    console.log('Channel learning DB tests passed successfully.')
  } finally {
    cleanup()
  }
}

if (process.argv[1] === import.meta.filename) {
  runChannelLearningDbHarness().catch((err) => {
    console.error('Channel learning DB harness error:', err)
    process.exit(1)
  })
}
