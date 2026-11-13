import { spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { query } from '../vault/pg-client'

const wsA = '22000000-0000-4000-8000-000000000031'
const ownerA = '12000000-0000-4000-8000-000000000031'
const managerA = '12000000-0000-4000-8000-000000000032'
const viewerA = '12000000-0000-4000-8000-000000000033'

const wsB = '22000000-0000-4000-8000-000000000034'
const ownerB = '12000000-0000-4000-8000-000000000034'

const requestKey1 = '32000000-0000-4000-8000-000000000031'
const requestKey2 = '32000000-0000-4000-8000-000000000032'
const contentId = '42000000-0000-4000-8000-000000000031'
const versionId = '52000000-0000-4000-8000-000000000031'

function execSql(
  statement: string,
  options: {
    role?: 'authenticated' | 'anon' | 'service_role'
    userId?: string | null
    commit?: boolean
  } = {}
) {
  if (!process.env.PGHOST?.includes('sohee-vault-db-')) {
    throw new Error('naver_post_jobs DB tests require isolated PostgreSQL cluster')
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

function callClaimJob(workspaceId: string, requestKey: string, userId: string) {
  const statement = `select public.claim_naver_post_job(
    '${workspaceId}'::uuid,
    '${requestKey}'::uuid,
    '${userId}'::uuid
  )`
  const run = execSql(statement, { role: 'service_role', commit: true })
  if (run.status !== 0) throw new Error(`claim_naver_post_job failed: ${run.stderr}`)
  const line = run.stdout.trim().split('\n').filter(Boolean).find((l) => l.trim().startsWith('{'))
  if (!line) throw new Error(`No JSON result: ${run.stdout}`)
  return JSON.parse(line.trim())
}

function callCompleteJob(workspaceId: string, requestKey: string, cid: string, vid: string, reconcile = false) {
  const statement = `select public.complete_naver_post_job(
    '${workspaceId}'::uuid,
    '${requestKey}'::uuid,
    '${cid}'::uuid,
    '${vid}'::uuid,
    ${reconcile}
  )`
  const run = execSql(statement, { role: 'service_role', commit: true })
  if (run.status !== 0) throw new Error(`complete_naver_post_job failed: ${run.stderr}`)
}

function callFailJob(workspaceId: string, requestKey: string, reconcile = false) {
  const statement = `select public.fail_naver_post_job(
    '${workspaceId}'::uuid,
    '${requestKey}'::uuid,
    ${reconcile}
  )`
  const run = execSql(statement, { role: 'service_role', commit: true })
  if (run.status !== 0) throw new Error(`fail_naver_post_job failed: ${run.stderr}`)
}

beforeAll(async () => {
  const setup = execSql(`
    -- 1. Users
    insert into auth.users (id, email) values
      ('${ownerA}', 'owner-a@sohee.test.invalid'),
      ('${managerA}', 'manager-a@sohee.test.invalid'),
      ('${viewerA}', 'viewer-a@sohee.test.invalid'),
      ('${ownerB}', 'owner-b@sohee.test.invalid');

    -- 2. Workspaces
    insert into public.workspaces (id, name, created_by) values
      ('${wsA}', '매장 A', '${ownerA}'),
      ('${wsB}', '다른 매장 B', '${ownerB}');

    -- 3. Workspace members
    insert into public.workspace_members (workspace_id, user_id, role, status) values
      ('${wsA}', '${managerA}', 'manager', 'active'),
      ('${wsA}', '${viewerA}', 'viewer', 'active');

    -- 4. Content items & versions for complete tests
    insert into public.content_items (id, workspace_id, channel, title, created_by) values
      ('${contentId}', '${wsA}', 'naver_blog', '테스트 글', '${ownerA}');

    insert into public.content_versions (
      id, workspace_id, content_id, version_number, caption, fingerprint, created_by
    ) values (
      '${versionId}', '${wsA}', '${contentId}', 1, '본문', repeat('0', 64), '${ownerA}'
    );
  `)
  if (setup.status !== 0) {
    throw new Error(`Fixture setup failed: ${setup.stderr}`)
  }
})

describe('naver_post_jobs DB integration & RLS tests (F3)', () => {
  describe('atomic claim helper (claim_naver_post_job)', () => {
    it('claims a new job atomically with acquired status', () => {
      const claim1 = callClaimJob(wsA, requestKey1, ownerA)
      expect(claim1.kind).toBe('acquired')
      expect(claim1.jobId).toMatch(/^[0-9a-f-]{36}$/)

      const [row] = query<{ status: string; workspace_id: string; user_id: string }>(
        `select status, workspace_id::text, user_id::text from public.naver_post_jobs where request_key = '${requestKey1}'`
      )
      expect(row).toBeDefined()
      expect(row.status).toBe('running')
      expect(row.workspace_id).toBe(wsA)
      expect(row.user_id).toBe(ownerA)
    })

    it('returns running when claimed again while previous job is running', () => {
      const claim2 = callClaimJob(wsA, requestKey1, managerA)
      expect(claim2.kind).toBe('running')
      expect(claim2.jobId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('transitions to succeeded on completion and returns succeeded with stored ids', () => {
      callCompleteJob(wsA, requestKey1, contentId, versionId, false)

      const claim3 = callClaimJob(wsA, requestKey1, ownerA)
      expect(claim3.kind).toBe('succeeded')
      expect(claim3.contentId).toBe(contentId)
      expect(claim3.versionId).toBe(versionId)

      const [row] = query<{ status: string; content_id: string; version_id: string }>(
        `select status, content_id::text, version_id::text from public.naver_post_jobs where request_key = '${requestKey1}'`
      )
      expect(row.status).toBe('succeeded')
      expect(row.content_id).toBe(contentId)
      expect(row.version_id).toBe(versionId)
    })

    it('allows fresh attempt with same requestKey if previous job failed without saved version', () => {
      // First attempt on requestKey2
      const claimA = callClaimJob(wsA, requestKey2, ownerA)
      expect(claimA.kind).toBe('acquired')

      // Mark as failed
      callFailJob(wsA, requestKey2, false)

      const [failedRow] = query<{ status: string }>(
        `select status from public.naver_post_jobs where request_key = '${requestKey2}'`
      )
      expect(failedRow.status).toBe('failed')

      // Retry attempt re-acquires job
      const claimB = callClaimJob(wsA, requestKey2, ownerA)
      expect(claimB.kind).toBe('acquired')

      const [runningRow] = query<{ status: string }>(
        `select status from public.naver_post_jobs where request_key = '${requestKey2}'`
      )
      expect(runningRow.status).toBe('running')
    })
  })

  describe('Row Level Security (RLS) on public.naver_post_jobs', () => {
    it('allows owner to select jobs in own workspace', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_post_jobs where workspace_id = '${wsA}'`,
        ownerA
      )
      expect(rows.length).toBeGreaterThan(0)
    })

    it('allows manager to select jobs in own workspace', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_post_jobs where workspace_id = '${wsA}'`,
        managerA
      )
      expect(rows.length).toBeGreaterThan(0)
    })

    it('hides jobs from viewer in the same workspace (RLS returns empty)', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_post_jobs where workspace_id = '${wsA}'`,
        viewerA
      )
      expect(rows).toEqual([])
    })

    it('hides jobs from owner of another workspace (tenant isolation)', () => {
      const rows = query<{ id: string }>(
        `select id::text from public.naver_post_jobs where workspace_id = '${wsA}'`,
        ownerB
      )
      expect(rows).toEqual([])
    })

    it('blocks direct insert by authenticated role (writes must go through service_role)', () => {
      const run = execSql(
        `insert into public.naver_post_jobs (workspace_id, request_key, user_id, status)
         values ('${wsA}'::uuid, gen_random_uuid(), '${ownerA}'::uuid, 'running')`,
        { role: 'authenticated', userId: ownerA, commit: true }
      )
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/permission denied|violates row-level security/i)
    })
  })

  describe('reconciliation queries & lifecycle in PostgreSQL (reconcileNaverPostJobs)', () => {
    const stuckReqKey = '32000000-0000-4000-8000-000000000088'
    const recentReqKey = '32000000-0000-4000-8000-000000000089'
    const flaggedReqKey = '32000000-0000-4000-8000-000000000090'

    it('identifies running jobs older than 15 minutes and ignores recently updated jobs', () => {
      // Setup stuck job (> 15m) and fresh job (< 15m)
      const res = execSql(`
        insert into public.naver_post_jobs
          (workspace_id, request_key, user_id, status, updated_at)
        values
          ('${wsA}'::uuid, '${stuckReqKey}'::uuid, '${ownerA}'::uuid, 'running', now() - interval '20 minutes'),
          ('${wsA}'::uuid, '${recentReqKey}'::uuid, '${ownerA}'::uuid, 'running', now() - interval '5 minutes');
      `, { role: 'service_role', commit: true })
      expect(res.status).toBe(0)

      const stuckRows = query<{ request_key: string }>(`
        select request_key::text from public.naver_post_jobs
        where status = 'running' and updated_at <= now() - interval '15 minutes'
        order by updated_at asc
      `)
      const keys = stuckRows.map((r) => r.request_key)
      expect(keys).toContain(stuckReqKey)
      expect(keys).not.toContain(recentReqKey)
    })

    it('identifies jobs with credit_reconcile_needed = true across statuses', () => {
      const res = execSql(`
        insert into public.naver_post_jobs
          (workspace_id, request_key, user_id, status, credit_reconcile_needed)
        values
          ('${wsA}'::uuid, '${flaggedReqKey}'::uuid, '${ownerA}'::uuid, 'failed', true);
      `, { role: 'service_role', commit: true })
      expect(res.status).toBe(0)

      const flaggedRows = query<{ request_key: string }>(`
        select request_key::text from public.naver_post_jobs
        where credit_reconcile_needed = true
      `)
      const keys = flaggedRows.map((r) => r.request_key)
      expect(keys).toContain(flaggedReqKey)
    })

    it('marks stuck job as failed with reconcile flag and clears flag atomically', () => {
      callFailJob(wsA, stuckReqKey, true)

      const [failed] = query<{ status: string; credit_reconcile_needed: boolean }>(`
        select status, credit_reconcile_needed from public.naver_post_jobs
        where request_key = '${stuckReqKey}'
      `)
      expect(failed.status).toBe('failed')
      expect(failed.credit_reconcile_needed).toBe(true)

      // Service role clears flag once reconciliation succeeds
      const clearRun = execSql(`
        update public.naver_post_jobs
        set credit_reconcile_needed = false, updated_at = now()
        where request_key = '${stuckReqKey}'
      `, { role: 'service_role', commit: true })
      expect(clearRun.status).toBe(0)

      const [cleared] = query<{ credit_reconcile_needed: boolean }>(`
        select credit_reconcile_needed from public.naver_post_jobs
        where request_key = '${stuckReqKey}'
      `)
      expect(cleared.credit_reconcile_needed).toBe(false)
    })

    it('completes stuck job from saved version with stored content and version ids', () => {
      callCompleteJob(wsA, recentReqKey, contentId, versionId, false)

      const [completed] = query<{ status: string; content_id: string; version_id: string; credit_reconcile_needed: boolean }>(`
        select status, content_id::text, version_id::text, credit_reconcile_needed
        from public.naver_post_jobs
        where request_key = '${recentReqKey}'
      `)
      expect(completed.status).toBe('succeeded')
      expect(completed.content_id).toBe(contentId)
      expect(completed.version_id).toBe(versionId)
      expect(completed.credit_reconcile_needed).toBe(false)
    })
  })
})
