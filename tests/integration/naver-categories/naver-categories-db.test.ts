import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from '../vault/pg-client'

const wsA = '24000000-0000-4000-8000-000000000001'
const ownerA = '14000000-0000-4000-8000-000000000001'
const managerA = '14000000-0000-4000-8000-000000000002'
const reviewerA = '14000000-0000-4000-8000-000000000003'
const viewerA = '14000000-0000-4000-8000-000000000004'

const wsB = '24000000-0000-4000-8000-000000000002'
const ownerB = '14000000-0000-4000-8000-000000000005'

const deviceIdA = '34000000-0000-4000-8000-000000000001'
const connectionIdA = '44000000-0000-4000-8000-000000000001'
const categoryRowIdA = '54000000-0000-4000-8000-000000000001'

const deviceIdB = '34000000-0000-4000-8000-000000000002'
const connectionIdB = '44000000-0000-4000-8000-000000000002'

function execSql(
  statement: string,
  options: {
    role?: 'authenticated' | 'anon' | 'service_role'
    userId?: string | null
    commit?: boolean
  } = {}
) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) {
    throw new Error('naver_blog_categories DB tests require isolated PostgreSQL cluster')
  }
  const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
  const { role, userId, commit = false } = options

  let input = ''
  if (role !== undefined || userId !== undefined) {
    input += 'begin;\n'
    if (role) input += `set local role ${role};\n`
    if (userId !== undefined) {
      input += `select set_config('request.jwt.claim.sub', ${userId === null ? "''" : `'${userId}'`}, true);\n`
    }
    input += `${statement};\n`
    input += commit ? 'commit;\n' : 'rollback;\n'
  } else {
    input = `${statement};`
  }

  return spawnSync(
    `${bin}/psql`,
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE!],
    { input, encoding: 'utf8' }
  )
}

beforeAll(async () => {
  const setup = execSql(`
    -- 1. Users
    insert into auth.users (id, email) values
      ('${ownerA}', 'owner-a@sohee.test.invalid'),
      ('${managerA}', 'manager-a@sohee.test.invalid'),
      ('${reviewerA}', 'reviewer-a@sohee.test.invalid'),
      ('${viewerA}', 'viewer-a@sohee.test.invalid'),
      ('${ownerB}', 'owner-b@sohee.test.invalid');

    -- 2. Workspaces
    insert into public.workspaces (id, name, created_by) values
      ('${wsA}', '매장 A', '${ownerA}'),
      ('${wsB}', '다른 매장 B', '${ownerB}');

    -- 3. Workspace members
    insert into public.workspace_members (workspace_id, user_id, role, status) values
      ('${wsA}', '${managerA}', 'manager', 'active'),
      ('${wsA}', '${reviewerA}', 'reviewer', 'active'),
      ('${wsA}', '${viewerA}', 'viewer', 'active');

    -- 4. Devices & browser connections
    insert into public.connector_devices (
      id, workspace_id, display_name, platform, client_version, token_digest, status, created_by
    ) values
      ('${deviceIdA}', '${wsA}', '기기 A', 'macos', '0.1.0', repeat('a', 64), 'active', '${ownerA}'),
      ('${deviceIdB}', '${wsB}', '기기 B', 'macos', '0.1.0', repeat('b', 64), 'active', '${ownerB}');

    insert into public.browser_channel_connections (
      id, workspace_id, device_id, channel, external_account_label, target_external_id,
      target_url, target_fingerprint, environment, status, verified_at
    ) values
      ('${connectionIdA}', '${wsA}', '${deviceIdA}', 'naver_blog', 'findk_blog', 'findk_blog',
       'https://blog.naver.com/findk_blog/postwrite?categoryNo=1', repeat('1', 64), 'test', 'connected', now()),
      ('${connectionIdB}', '${wsB}', '${deviceIdB}', 'naver_blog', 'other_blog', 'other_blog',
       'https://blog.naver.com/other_blog/postwrite?categoryNo=1', repeat('2', 64), 'test', 'connected', now());

    -- 5. Seed naver_blog_categories via service_role
    insert into public.naver_blog_categories (
      id, workspace_id, browser_channel_connection_id, categories, synced_at, source_device_id
    ) values (
      '${categoryRowIdA}', '${wsA}', '${connectionIdA}',
      '[{"id": "1", "name": "공지사항", "parentId": null}, {"id": "2", "name": "이벤트", "parentId": "1"}]'::jsonb,
      now(), '${deviceIdA}'
    );
  `)

  if (setup.status !== 0) {
    throw new Error(`Fixture setup failed: ${setup.stderr}`)
  }
})

describe('naver_blog_categories DB integration & RLS tests', () => {
  describe('Row Level Security (RLS) on public.naver_blog_categories', () => {
    it('allows workspace owner to select synced categories', () => {
      const rows = query<{ id: string; categories: any }>(
        `select id::text, categories from public.naver_blog_categories where workspace_id = '${wsA}'`,
        ownerA
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(categoryRowIdA)
    })

    it('allows workspace manager to select synced categories', () => {
      const rows = query<{ id: string; categories: any }>(
        `select id::text, categories from public.naver_blog_categories where workspace_id = '${wsA}'`,
        managerA
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(categoryRowIdA)
    })

    it('allows workspace reviewer to select synced categories', () => {
      const rows = query<{ id: string; categories: any }>(
        `select id::text, categories from public.naver_blog_categories where workspace_id = '${wsA}'`,
        reviewerA
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(categoryRowIdA)
    })

    it('denies workspace viewer from selecting synced categories (returns empty)', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_blog_categories where workspace_id = '${wsA}'`,
        viewerA
      )
      expect(rows).toEqual([])
    })

    it('denies member of another workspace from selecting categories (tenant isolation)', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_blog_categories where workspace_id = '${wsA}'`,
        ownerB
      )
      expect(rows).toEqual([])
    })

    it('denies direct insert by authenticated role', () => {
      const run = execSql(
        `insert into public.naver_blog_categories (workspace_id, browser_channel_connection_id, categories)
         values ('${wsA}'::uuid, '${connectionIdB}'::uuid, '[]'::jsonb)`,
        { role: 'authenticated', userId: ownerA, commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/permission denied/i)
    })

    it('denies direct update by authenticated role', () => {
      const run = execSql(
        `update public.naver_blog_categories set categories = '[]'::jsonb where id = '${categoryRowIdA}'::uuid`,
        { role: 'authenticated', userId: ownerA, commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/permission denied/i)
    })

    it('denies direct delete by authenticated role', () => {
      const run = execSql(
        `delete from public.naver_blog_categories where id = '${categoryRowIdA}'::uuid`,
        { role: 'authenticated', userId: ownerA, commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/permission denied/i)
    })
  })

  describe('Integrity & constraints on public.naver_blog_categories', () => {
    it('enforces unique browser_channel_connection_id constraint', () => {
      const run = execSql(
        `insert into public.naver_blog_categories (
           workspace_id, browser_channel_connection_id, categories
         ) values (
           '${wsA}'::uuid, '${connectionIdA}'::uuid, '[]'::jsonb
         )`,
        { role: 'service_role', commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/duplicate key value violates unique constraint/i)
    })

    it('enforces CHECK constraint that categories is array of at most 200 elements', () => {
      // 201 elements should fail
      const oversizedArray = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ id: String(i), name: `Cat ${i}`, parentId: null })))
      const run = execSql(
        `insert into public.naver_blog_categories (
           workspace_id, browser_channel_connection_id, categories
         ) values (
           '${wsB}'::uuid, '${connectionIdB}'::uuid, '${oversizedArray}'::jsonb
         )`,
        { role: 'service_role', commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/violates check constraint/i)
    })

    it('allows inserting valid categories up to 200 elements via service_role', () => {
      const validArray = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: `Cat ${i}`, parentId: null })))
      const run = execSql(
        `insert into public.naver_blog_categories (
           workspace_id, browser_channel_connection_id, categories
         ) values (
           '${wsB}'::uuid, '${connectionIdB}'::uuid, '${validArray}'::jsonb
         )`,
        { role: 'service_role', commit: true }
      )
      expect(run.status).toBe(0)
    })
  })
})
