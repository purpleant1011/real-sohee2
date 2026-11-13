import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const root = resolve(import.meta.dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'sohee-studio-standalone-'))
const cluster = join(temporary, 'cluster')
const db = 'sohee_studio_verify'

function cleanup() {
  if (existsSync(join(cluster, 'postmaster.pid'))) {
    spawnSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  }
  rmSync(temporary, { recursive: true, force: true })
}

function call(name, args) {
  const result = spawnSync(join(bin, name), args, { encoding: 'utf8', env: process.env })
  if (result.status !== 0) {
    throw new Error(`${name} ${args.join(' ')}: ${result.stderr || result.error?.message}`)
  }
  return result.stdout
}

const port = 54000 + Math.floor(Math.random() * 10000)
const env = { ...process.env, LC_ALL: 'C', PGHOST: temporary, PGPORT: String(port), PGDATABASE: db, PGUSER: process.env.USER }
Object.assign(process.env, env)

try {
  call('initdb', ['-D', cluster, '-E', 'UTF8', '--no-locale', '-A', 'trust', '--no-sync'])
  call('pg_ctl', ['-D', cluster, '-o', `-p ${port} -k ${temporary} -h '' -c fsync=off`, '-l', join(temporary, 'pg.log'), '-w', 'start'])
  call('createdb', [db])

  // Minimal pure Supabase fixtures
  const minimalSchema = `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;

    create schema if not exists auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );

    create table public.workspaces (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_by uuid references auth.users(id),
      created_at timestamptz not null default now()
    );

    create table public.conversation_threads (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      kind text not null check (kind in ('operations', 'work', 'customer_summary', 'onboarding')),
      title text not null check (char_length(title) between 1 and 120),
      status text not null default 'active' check (status in ('active', 'archived')),
      last_message_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint conversation_threads_workspace_id_id_key unique (workspace_id, id)
    );

    create table public.messages (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      thread_id uuid not null,
      role text not null check (role in ('user', 'sohee', 'system_event')),
      content text not null check (char_length(content) between 1 and 20000),
      status text not null check (status in ('queued', 'streaming', 'completed', 'failed', 'cancelled')),
      client_message_id uuid,
      reply_to_message_id uuid,
      model_name text check (model_name is null or char_length(model_name) <= 120),
      usage_metadata jsonb not null default '{}'::jsonb,
      created_by_user_id uuid references auth.users(id),
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      constraint messages_workspace_id_id_key unique (workspace_id, id),
      constraint messages_thread_fkey foreign key (workspace_id, thread_id) references public.conversation_threads (workspace_id, id) on delete cascade
    );

    create table public.knowledge_sources (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      source_type text not null check (source_type in ('file', 'url', 'manual')),
      display_name text not null check (char_length(display_name) between 1 and 200),
      status text not null default 'registered',
      created_by_user_id uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint knowledge_sources_workspace_id_id_key unique (workspace_id, id)
    );

    create table public.knowledge_candidates (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      knowledge_source_id uuid not null references public.knowledge_sources(id) on delete restrict,
      category text not null check (char_length(category) between 1 and 120),
      content text not null check (char_length(content) between 1 and 12000),
      source_excerpt text,
      source_location text,
      confidence numeric(4,3),
      status text not null default 'review_required' check (status in ('review_required', 'conflict', 'approved', 'rejected')),
      conflicts_with_fact_id uuid,
      version integer not null default 1,
      reviewed_by_user_id uuid references auth.users(id),
      reviewed_at timestamptz,
      created_by_user_id uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint knowledge_candidates_workspace_id_id_key unique (workspace_id, id),
      constraint knowledge_candidates_review_evidence_check check (
        (status in ('review_required', 'conflict') and reviewed_by_user_id is null and reviewed_at is null)
        or (status in ('approved', 'rejected') and reviewed_by_user_id is not null and reviewed_at is not null)
      )
    );

    create table public.knowledge_facts (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      category text not null check (char_length(category) between 1 and 120),
      content text not null check (char_length(content) between 1 and 12000),
      status text not null default 'active' check (status in ('active', 'superseded', 'expired')),
      source_candidate_id uuid not null,
      approved_by_user_id uuid not null references auth.users(id),
      approved_at timestamptz not null,
      valid_from timestamptz not null default now(),
      valid_until timestamptz,
      supersedes_fact_id uuid,
      created_at timestamptz not null default now(),
      constraint knowledge_facts_workspace_id_id_key unique (workspace_id, id),
      constraint knowledge_facts_source_candidate_key unique (workspace_id, source_candidate_id),
      constraint knowledge_facts_source_candidate_fkey foreign key (workspace_id, source_candidate_id) references public.knowledge_candidates (workspace_id, id) on delete restrict
    );

    alter table public.knowledge_facts
      add constraint knowledge_facts_supersedes_fact_fkey
      foreign key (workspace_id, supersedes_fact_id)
      references public.knowledge_facts (workspace_id, id)
      on delete restrict;

    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant select on all tables in schema auth to service_role;

    -- Pre-migration production row fixture: 1 existing onboarding thread
    insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000001', 'Onboarding Prod WS');
    insert into public.conversation_threads (id, workspace_id, kind, title, status)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'onboarding', '온보딩 기존 대화', 'active');
  `
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', minimalSchema])

  const migrationPath = join(root, 'supabase/migrations/20261016090509_sohee_studio_production.sql')
  console.log('📦 Applying migration 1:', migrationPath)
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', migrationPath])
  console.log('✅ Migration 1 applied successfully.')

  const forwardMigrationPath = join(root, 'supabase/migrations/20261016102015_sohee_studio_fk_column_specific_set_null.sql')
  console.log('📦 Applying forward migration 2:', forwardMigrationPath)
  call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', forwardMigrationPath])
  console.log('✅ Forward migration 2 applied successfully.')

  const testSqlPath = join(root, 'supabase/tests/database/56_sohee_studio_production.test.sql')
  console.log('🧪 Running assertions:', testSqlPath)
  const testOutput = call('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', testSqlPath])
  console.log(testOutput)
  console.log('🎉 All Studio Database Assertion Tests Passed Successfully!')

} finally {
  cleanup()
}
