import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveApprovedFacts } from '@/features/knowledge/approved-fact-resolver'
import {
  revalidateApprovedFactSnapshot,
  getDefaultFactSnapshotResolver,
  createWorkspaceFactReader,
  type ApprovedFactSnapshot,
  type FactSnapshotResolver,
  type FactReader,
} from '../fact-snapshot-gate'

describe('Approved Fact Snapshot Gate (Core)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'

  const validSnapshot: ApprovedFactSnapshot = {
    workspaceId,
    resolvedAt: '2026-10-21T00:00:00.000Z',
    facts: [
      {
        id: 'fact-1',
        workspace_id: workspaceId,
        category: 'pricing',
        content: '기본 펌 40,000원',
        status: 'active',
        source_candidate_id: 'cand-1',
        approved_by_user_id: 'user-1',
        approved_at: '2026-10-20T10:00:00.000Z',
        valid_from: '2026-10-20T10:00:00.000Z',
        valid_until: null,
        supersedes_fact_id: null,
        created_at: '2026-10-20T10:00:00.000Z',
      },
    ],
    hash: 'hash-40000',
  }

  const fakeAdmin: FactReader = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }

  const fakeResolver: FactSnapshotResolver = {
    loadApprovedFactSnapshot: vi.fn(),
    assertFactSnapshotCurrent: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies static adapter returns real W8 resolver without mutable globals', () => {
    const resolver = getDefaultFactSnapshotResolver()
    expect(resolver).not.toBeNull()
    expect(typeof resolver?.loadApprovedFactSnapshot).toBe('function')
    expect(typeof resolver?.assertFactSnapshotCurrent).toBe('function')
  })

  it('fails with 409 SNAPSHOT_MISSING when previous is null EVEN IF resolver is null (evaluation order)', async () => {
    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: null,
      resolver: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_REVIEW_REQUIRED')
      expect(result.reason).toBe('SNAPSHOT_MISSING')
    }
  })

  it('fails with 409 WORKSPACE_MISMATCH when previous has wrong workspace EVEN IF resolver is null', async () => {
    const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'
    const otherSnapshot: ApprovedFactSnapshot = {
      ...validSnapshot,
      workspaceId: otherWorkspaceId,
      facts: validSnapshot.facts.map((f) => ({ ...f, workspace_id: otherWorkspaceId })),
    }
    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: otherSnapshot,
      resolver: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_REVIEW_REQUIRED')
      expect(result.reason).toBe('WORKSPACE_MISMATCH')
    }
  })

  it('fails closed with 503 FACT_SOURCE_UNAVAILABLE when previous is valid but resolver is null/unavailable', async () => {
    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_SOURCE_UNAVAILABLE')
      expect(result.reason).toBe('RESOLVER_UNAVAILABLE')
      expect(result.error).toContain('가게 정보 확인 서비스')
    }
  })

  it('fails with 409 FACT_REVIEW_REQUIRED when stored snapshot envelope is corrupted (missing facts/hash/invalid date)', async () => {
    const corruptedSnapshots = [
      { workspaceId, resolvedAt: 'invalid-date', hash: 'h', facts: [] },
      { workspaceId, resolvedAt: '2026-10-21T00:00:00.000Z', hash: '', facts: [] }, // empty hash
      { workspaceId, resolvedAt: '2026-10-21T00:00:00.000Z', hash: 'h', facts: 'not-array' },
      {
        workspaceId,
        resolvedAt: '2026-10-21T00:00:00.000Z',
        hash: 'h',
        facts: [{ ...validSnapshot.facts[0], workspace_id: 'other' }], // row workspace mismatch
      },
    ]

    for (const corrupted of corruptedSnapshots) {
      const result = await revalidateApprovedFactSnapshot({
        admin: fakeAdmin,
        workspaceId,
        previousSnapshot: corrupted,
        resolver: fakeResolver,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.code).toBe('FACT_REVIEW_REQUIRED')
        expect(result.reason).toBe('SNAPSHOT_MISSING')
      }
    }
  })

  it('fails with 503 FACT_READ_FAILED when loader throws an error', async () => {
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockRejectedValue(new Error('FACT_READ_FAILED'))

    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_READ_FAILED')
      expect(result.reason).toBe('READ_FAILED')
    }
  })

  it('fails with 503 FACT_READ_FAILED when current snapshot envelope is malformed or hash is empty', async () => {
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue({
      workspaceId,
      resolvedAt: '2026-10-21T00:00:00.000Z',
      facts: [],
      hash: '', // empty hash
    })

    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_READ_FAILED')
      expect(result.reason).toBe('READ_FAILED')
    }
  })

  it('fails with 503 when current snapshot workspace differs from expected workspace even if fake assert is permissive', async () => {
    const wrongWorkspaceSnapshot: ApprovedFactSnapshot = {
      ...validSnapshot,
      workspaceId: 'other-ws',
      facts: validSnapshot.facts.map((f) => ({ ...f, workspace_id: 'other-ws' })),
    }
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(wrongWorkspaceSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {
      // Permissive fake assert that forgets to check workspace
    })

    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_READ_FAILED')
      expect(result.reason).toBe('READ_FAILED')
    }
    // assertFactSnapshotCurrent was never called because envelope validation caught it
    expect(fakeResolver.assertFactSnapshotCurrent).not.toHaveBeenCalled()
  })

  it('passes when price/hash is unchanged and passes server clock at to loader', async () => {
    const currentSnapshot: ApprovedFactSnapshot = {
      ...validSnapshot,
      resolvedAt: '2026-10-21T12:00:00.000Z',
    }
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(currentSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {})

    const serverAt = '2026-10-21T15:00:00.000Z'
    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
      at: serverAt,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.currentSnapshot).toEqual(currentSnapshot)
    }
    expect(fakeResolver.loadApprovedFactSnapshot).toHaveBeenCalledWith(fakeAdmin, workspaceId, serverAt)
    expect(fakeResolver.assertFactSnapshotCurrent).toHaveBeenCalledWith(validSnapshot, currentSnapshot)
  })

  it('fails with 409 FACTS_CHANGED when assert throws FACT_SNAPSHOT_STALE (price 40k -> 50k)', async () => {
    const updatedSnapshot: ApprovedFactSnapshot = {
      workspaceId,
      resolvedAt: '2026-10-21T12:00:00.000Z',
      facts: [{ ...validSnapshot.facts[0], content: '기본 펌 50,000원' }],
      hash: 'hash-50000',
    }
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(updatedSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {
      throw new Error('FACT_SNAPSHOT_STALE')
    })

    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_REVIEW_REQUIRED')
      expect(result.reason).toBe('FACTS_CHANGED')
      expect(result.error).toContain('가게 정보를 다시 확인해야 해요')
      // No raw content or hash in error DTO
      expect(JSON.stringify(result)).not.toContain('50,000')
      expect(JSON.stringify(result)).not.toContain('hash-50000')
    }
  })

  it('fails with 503 UNKNOWN_VERIFIER_ERROR when assert throws unexpected exception', async () => {
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(validSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {
      throw new Error('UNEXPECTED_SYSTEM_CRASH')
    })

    const result = await revalidateApprovedFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      previousSnapshot: validSnapshot,
      resolver: fakeResolver,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_READ_FAILED')
      expect(result.reason).toBe('UNKNOWN_VERIFIER_ERROR')
    }
  })

  describe('createWorkspaceFactReader (Thin Gateway Protection)', () => {
    it('throws when initialized with empty workspaceId', () => {
      expect(() => createWorkspaceFactReader('', vi.fn())).toThrow('INVALID_FACT_READER_WORKSPACE')
      expect(() => createWorkspaceFactReader('   ', vi.fn())).toThrow('INVALID_FACT_READER_WORKSPACE')
    })

    it('delegates to readRows when table and workspace_id match exact server context', async () => {
      const readRows = vi.fn().mockResolvedValue({ data: [{ id: 'fact-1' }], error: null, count: 1 })
      const reader = createWorkspaceFactReader(workspaceId, readRows)

      const result = await reader.from('knowledge_facts').select('id,content', { count: 'exact' }).eq('workspace_id', workspaceId)
      expect(result).toEqual({ data: [{ id: 'fact-1' }], error: null, count: 1 })
      expect(readRows).toHaveBeenCalledWith('id,content', { count: 'exact' })
    })

    it('passes options { count: exact } to readRows handler', async () => {
      const readRows = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
      const reader = createWorkspaceFactReader(workspaceId, readRows)

      await reader.from('knowledge_facts').select('id', { count: 'exact' }).eq('workspace_id', workspaceId)
      expect(readRows).toHaveBeenCalledWith('id', { count: 'exact' })
    })

    it('fails closed with 503 FACT_READ_FAILED when count is missing or mismatches data length via real W8 loader', async () => {
      const resolver = getDefaultFactSnapshotResolver()
      expect(resolver).not.toBeNull()

      // 1. Missing count
      const missingCountReader = createWorkspaceFactReader(workspaceId, async () => ({
        data: [validSnapshot.facts[0]],
        error: null,
      }))
      const res1 = await revalidateApprovedFactSnapshot({
        admin: missingCountReader,
        workspaceId,
        previousSnapshot: validSnapshot,
        resolver,
      })
      expect(res1.ok).toBe(false)
      if (!res1.ok) {
        expect(res1.status).toBe(503)
        expect(res1.code).toBe('FACT_READ_FAILED')
        expect(res1.reason).toBe('READ_FAILED')
      }

      // 2. Count mismatch (count=2 but data.length=1)
      const mismatchCountReader = createWorkspaceFactReader(workspaceId, async () => ({
        data: [validSnapshot.facts[0]],
        error: null,
        count: 2,
      }))
      const res2 = await revalidateApprovedFactSnapshot({
        admin: mismatchCountReader,
        workspaceId,
        previousSnapshot: validSnapshot,
        resolver,
      })
      expect(res2.ok).toBe(false)
      if (!res2.ok) {
        expect(res2.status).toBe(503)
        expect(res2.code).toBe('FACT_READ_FAILED')
        expect(res2.reason).toBe('READ_FAILED')
      }
    })

    it('integrates cleanly with real W8 resolver: passes when price matches, 409 when price changes', async () => {
      const resolver = getDefaultFactSnapshotResolver()
      expect(resolver).not.toBeNull()

      const baseRow = validSnapshot.facts[0]
      const realSnapshot = resolveApprovedFacts({
        workspaceId,
        at: '2026-10-21T00:00:00.000Z',
        rows: [baseRow],
      })

      // Case A: Price matches (200 OK / ok: true)
      const matchingReader = createWorkspaceFactReader(workspaceId, async () => ({
        data: [baseRow],
        error: null,
        count: 1,
      }))
      const resOk = await revalidateApprovedFactSnapshot({
        admin: matchingReader,
        workspaceId,
        previousSnapshot: realSnapshot,
        resolver,
      })
      expect(resOk.ok).toBe(true)

      // Case B: Price changes 40,000 -> 50,000 (409 FACTS_CHANGED)
      const changedReader = createWorkspaceFactReader(workspaceId, async () => ({
        data: [{ ...baseRow, id: 'fact-2', content: '기본 펌 50,000원' }],
        error: null,
        count: 1,
      }))
      const resChanged = await revalidateApprovedFactSnapshot({
        admin: changedReader,
        workspaceId,
        previousSnapshot: realSnapshot,
        resolver,
      })
      expect(resChanged.ok).toBe(false)
      if (!resChanged.ok) {
        expect(resChanged.status).toBe(409)
        expect(resChanged.code).toBe('FACT_REVIEW_REQUIRED')
        expect(resChanged.reason).toBe('FACTS_CHANGED')
      }
    })

    it('throws UNAUTHORIZED_FACT_TABLE and does 0 readRows on unauthorized table query', () => {
      const readRows = vi.fn()
      const reader = createWorkspaceFactReader(workspaceId, readRows)

      expect(() => reader.from('marketing_missions')).toThrow('UNAUTHORIZED_FACT_TABLE: marketing_missions')
      expect(() => reader.from('users')).toThrow('UNAUTHORIZED_FACT_TABLE: users')
      expect(readRows).not.toHaveBeenCalled()
    })

    it('throws UNAUTHORIZED_FACT_QUERY and does 0 readRows on unauthorized column or workspace mismatch', () => {
      const readRows = vi.fn()
      const reader = createWorkspaceFactReader(workspaceId, readRows)

      const query = reader.from('knowledge_facts').select('id')
      // Mismatched column
      expect(() => query.eq('id', 'fact-1')).toThrow('UNAUTHORIZED_FACT_QUERY: id=fact-1')
      // Mismatched workspace
      expect(() => query.eq('workspace_id', 'other-workspace')).toThrow('UNAUTHORIZED_FACT_QUERY: workspace_id=other-workspace')
      expect(readRows).not.toHaveBeenCalled()
    })
  })
})
