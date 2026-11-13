import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'
import type { ApprovedFactSnapshot } from '@/features/publishing/fact-snapshot-gate'

const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const validSnapshot: ApprovedFactSnapshot = {
  workspaceId,
  resolvedAt: '2026-10-21T00:00:00.000Z',
  facts: [
    {
      id: 'fact-1',
      workspace_id: workspaceId,
      category: 'pricing',
      content: '확인한 가격 40,000원',
      status: 'active',
      source_candidate_id: 'cand-1',
      approved_by_user_id: 'owner',
      approved_at: '2026-10-20T10:00:00.000Z',
      valid_from: '2026-10-20T10:00:00.000Z',
      valid_until: null,
      supersedes_fact_id: null,
      created_at: '2026-10-20T10:00:00.000Z',
    },
  ],
  hash: 'hash-40000',
}

const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.server }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolve }))
import { POST } from './route'
const payload = {
  workspaceId, missionId, channels: [{ provider: 'threads', handle: 'test-store' }],
  copies: { instagram: { caption: '확인한 가격 40,000원' }, threads: { content: '확인한 가격 40,000원' } },
  imageIds: [],
  boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
  rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
}

const baseFact40k: ApprovedFactRow = {
  id: 'fact-1',
  workspace_id: workspaceId,
  category: 'pricing',
  content: '기본 시술 40,000원',
  status: 'active',
  source_candidate_id: 'cand-1',
  approved_by_user_id: 'user-1',
  approved_at: '2026-10-01T00:00:00Z',
  valid_from: '2026-10-01T00:00:00Z',
  valid_until: null,
  supersedes_fact_id: null,
  created_at: '2026-10-01T00:00:00Z',
}

const replacementFact50k: ApprovedFactRow = {
  id: 'fact-2',
  workspace_id: workspaceId,
  category: 'pricing',
  content: '기본 시술 50,000원',
  status: 'active',
  source_candidate_id: 'cand-2',
  approved_by_user_id: 'user-1',
  approved_at: '2026-10-15T00:00:00Z',
  valid_from: '2026-10-15T00:00:00Z',
  valid_until: null,
  supersedes_fact_id: 'fact-1',
  created_at: '2026-10-15T00:00:00Z',
}

function database(changeAfterRead: boolean, options?: { factSnapshot?: any; currentFactRows?: ApprovedFactRow[]; factError?: Error }) {
  const currentFactSnapshot = options?.factSnapshot !== undefined
    ? options.factSnapshot
    : resolveApprovedFacts({
        workspaceId,
        at: new Date().toISOString(),
        rows: options?.currentFactRows ?? [baseFact40k],
      })

  const row: Record<string, any> = {
    id: missionId, workspace_id: workspaceId, status: 'AWAITING_APPROVAL', updated_at: '2026-10-21T00:00:00.000Z',
    metadata: { payload: structuredClone(payload), quick: { revision: 1 }, factSnapshot: currentFactSnapshot },
  }
  let written = false
  const client = { from: (table: string) => {
    if (table === 'knowledge_facts') {
      return {
        select: (_cols?: string, _opts?: { count?: string }) => ({
          eq: async () => {
            if (options?.factError) return { data: null, error: options.factError, count: null }
            const rows = options?.currentFactRows ?? [baseFact40k]
            return { data: rows, error: null, count: rows.length }
          },
        }),
      }
    }
    let columns = ''
    let patch: Record<string, unknown> | undefined
    const filters: Array<[string, unknown]> = []
    const query: any = {
      select: (value: string) => { columns = value; return query },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query },
      update: (value: Record<string, unknown>) => { patch = value; return query },
      maybeSingle: async () => {
        const snapshot = Object.fromEntries(columns.split(',').map((column) => column.trim()).map((column) => [column, structuredClone(row[column])]))
        if (changeAfterRead) {
          row.updated_at = '2026-10-21T00:00:01.000Z'
          row.metadata = { payload: { ...payload, copies: { ...payload.copies, threads: { content: '변경된 가격 50,000원' } } }, quick: { revision: 2 } }
        }
        return { data: snapshot, error: null }
      },
      then: (resolve: (value: unknown) => void) => {
        const matches = filters.every(([key, value]) => {
          if (key === 'metadata') {
            return JSON.stringify(row.metadata) === value || row.metadata === value
          }
          return row[key] === value
        })
        if (matches && patch) { Object.assign(row, patch); written = true }
        return Promise.resolve(resolve({ data: matches ? [{ id: row.id, status: row.status }] : [], error: null }))
      },
    }
    return query
  } }
  return { client, row, wasWritten: () => written }
}

function request() {
  return new Request('http://localhost/api/missions/first-post/approve', { method: 'POST', body: JSON.stringify({
    missionId, fingerprint: calculateApprovalFingerprint(payload), isExplicitlyApproved: true, explicitPhrase: '이 버전 승인하고 발행',
  }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } })
  mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'owner' })
})

describe('first-post exact approval compare-and-swap', () => {
  it('does not overwrite a newer draft with the approval of the version read before a concurrent edit', async () => {
    const db = database(true)
    mocks.admin.mockReturnValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('CONCURRENT_APPROVAL_CONFLICT')
    expect(db.wasWritten()).toBe(false)
    expect(db.row.metadata.quick.revision).toBe(2)
    expect(db.row.metadata.payload.copies.threads.content).toBe('변경된 가격 50,000원')
    expect(db.row.status).toBe('AWAITING_APPROVAL')
  })

  it('approves the same unchanged persisted draft', async () => {
    const db = database(false)
    mocks.admin.mockReturnValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(db.wasWritten()).toBe(true)
    expect(db.row.status).toBe('APPROVED')
    expect(db.row.metadata.approvedFingerprint).toBe(calculateApprovalFingerprint(payload))
  })

  it('rejects with 409 FACT_REVIEW_REQUIRED when fact snapshot is stale before approval CAS', async () => {
    const oldSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })
    const db = database(false, {
      factSnapshot: oldSnapshot,
      currentFactRows: [baseFact40k, replacementFact50k],
    })
    mocks.admin.mockReturnValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('FACTS_CHANGED')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(db.wasWritten()).toBe(false)
  })

  it('rejects with 409 FACT_REVIEW_REQUIRED when fact snapshot is missing', async () => {
    const db = database(false, { factSnapshot: null })
    mocks.admin.mockReturnValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('SNAPSHOT_MISSING')
    expect(db.wasWritten()).toBe(false)
  })

  it('fails closed with 503 FACT_READ_FAILED when fact ledger query errors', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k],
    })
    const db = database(false, {
      factSnapshot: snapshot,
      factError: new Error('DB connection failed'),
    })
    mocks.admin.mockReturnValue(db.client)
    const response = await POST(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('FACT_READ_FAILED')
    expect(body.reason).toBe('READ_FAILED')
    expect(db.wasWritten()).toBe(false)
  })
})
