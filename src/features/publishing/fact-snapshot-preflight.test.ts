import { describe, expect, it, vi } from 'vitest'
import {
  resolveApprovedFacts,
  type ApprovedFactRow,
} from '@/features/knowledge/approved-fact-resolver'
import { checkMissionFactSnapshot } from './fact-snapshot-preflight'

const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherWorkspaceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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

const promoFactExpiring: ApprovedFactRow = {
  id: 'fact-promo',
  workspace_id: workspaceId,
  category: 'promotion',
  content: '오픈 기념 20% 할인',
  status: 'active',
  source_candidate_id: 'cand-3',
  approved_by_user_id: 'user-1',
  approved_at: '2026-10-01T00:00:00Z',
  valid_from: '2026-10-01T00:00:00Z',
  valid_until: '2026-10-15T00:00:00Z',
  supersedes_fact_id: null,
  created_at: '2026-10-01T00:00:00Z',
}

describe('fact-snapshot-preflight pure contract', () => {
  it('returns 409 FACT_SNAPSHOT_STALE when stored snapshot is missing', async () => {
    const fakeAdmin = { from: vi.fn() } as any
    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_SNAPSHOT_STALE')
      expect(result.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    }
    expect(fakeAdmin.from).not.toHaveBeenCalled()
  })

  it('returns 409 FACT_SNAPSHOT_STALE when stored snapshot workspace does not match authorized workspace', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId: otherWorkspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [{ ...baseFact40k, workspace_id: otherWorkspaceId }],
    })
    const fakeAdmin = { from: vi.fn() } as any
    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: snapshot,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_SNAPSHOT_STALE')
    }
    expect(fakeAdmin.from).not.toHaveBeenCalled()
  })

  it('returns 409 FACT_SNAPSHOT_STALE when price fact changed from 40k to 50k', async () => {
    const oldSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })
    const currentSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-21T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })
    expect(oldSnapshot.hash).not.toBe(currentSnapshot.hash)

    const fakeAdmin = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [baseFact40k, replacementFact50k], error: null, count: 2 }),
        }),
      }),
    } as any

    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: oldSnapshot,
      now: '2026-10-21T00:00:00Z',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_SNAPSHOT_STALE')
      expect(result.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    }
  })

  it('returns 409 FACT_SNAPSHOT_STALE when event promotion fact expired', async () => {
    const activeSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, promoFactExpiring],
    })
    const expiredSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-21T00:00:00Z',
      rows: [baseFact40k, promoFactExpiring],
    })
    expect(activeSnapshot.hash).not.toBe(expiredSnapshot.hash)

    const fakeAdmin = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [baseFact40k, promoFactExpiring], error: null, count: 2 }),
        }),
      }),
    } as any

    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: activeSnapshot,
      now: '2026-10-21T00:00:00Z',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_SNAPSHOT_STALE')
      expect(result.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    }
  })

  it('returns 503 FACT_READ_FAILED when fact ledger query errors', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k],
    })

    const fakeAdmin = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: null, error: new Error('Postgres connection timeout') }),
        }),
      }),
    } as any

    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: snapshot,
      now: '2026-10-21T00:00:00Z',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('FACT_READ_FAILED')
      expect(result.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    }
  })

  it('returns ok: true when facts are completely identical and current', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k],
    })

    const fakeAdmin = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [baseFact40k], error: null, count: 1 }),
        }),
      }),
    } as any

    const result = await checkMissionFactSnapshot({
      admin: fakeAdmin,
      workspaceId,
      storedSnapshot: snapshot,
      now: '2026-10-10T00:00:00Z',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.currentSnapshot.hash).toBe(snapshot.hash)
    }
  })
})
