import { describe, expect, it, vi } from 'vitest'
import { consumePublishApproval, persistPublishResult } from './publish-consumption'
const input = { workspaceId: 'workspace', missionId: 'mission', fingerprint: 'a'.repeat(64), payload: {} as never, claimToken: 'token', expectedMetadata: { snapshot_version: 3 }, expectedUpdatedAt: '2026-10-27T00:00:00Z' }
describe('publish consumption gate', () => {
  it('RPC 없음/오류/깨진 응답은 비원자적 fallback 없이 503이다', async () => {
    for (const admin of [{}, { rpc: async () => ({ error: { message: 'missing migration' } }) }, { rpc: async () => ({ data: { claimed: 'yes' } }) }]) expect(await consumePublishApproval(admin, input)).toMatchObject({ status: 503 })
  })
  it('DB 중복 판정은 409이고 새 claim은 진행한다', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { claimed: false, code: 'PUBLISH_CONTENT_ALREADY_CLAIMED' } }).mockResolvedValueOnce({ data: { claimed: true } })
    expect(await consumePublishApproval({ rpc }, input)).toMatchObject({ status: 409 })
    expect(await consumePublishApproval({ rpc }, input)).toBeNull()
    expect(rpc).toHaveBeenCalledWith('claim_first_post_publish', expect.objectContaining({ p_fingerprint: input.fingerprint, p_mission_id: input.missionId, p_expected_metadata: input.expectedMetadata, p_expected_updated_at: input.expectedUpdatedAt, p_idempotency_key: null }))
  })

  describe('persistPublishResult verified execution_state transition', () => {
    function createMockAdmin(latestRow: any, onUpdate?: (payload: any) => void) {
      return {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: latestRow, error: null })),
              })),
            })),
          })),
          update: vi.fn((updatePayload: any) => {
            if (onUpdate) onUpdate(updatePayload)
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              select: vi.fn(async () => ({ data: [{ id: latestRow.id }], error: null })),
            }
            return query
          }),
        })),
      }
    }

    const baseContract = { goal: '첫 게시물' }
    const baseClaimedMetadata = {
      control_epoch: 1,
      contract: baseContract,
    }

    it('PUBLISHED_VERIFIED 승격 시 contract가 있으면 execution_state가 OBSERVING으로 전이된다', async () => {
      let savedPayload: any = null
      const admin = createMockAdmin({
        id: 'mission-1',
        status: 'EXECUTING',
        metadata: {
          retryLock: 'lock-1',
          execution_state: 'RUNNING',
          control_epoch: 1,
          contract: baseContract,
          snapshot_version: 1,
        },
        updated_at: '2026-10-27T00:00:00.000Z',
      }, (p) => { savedPayload = p })

      const res = await persistPublishResult(admin, {
        missionId: 'mission-1',
        workspaceId: 'ws-1',
        lock: 'lock-1',
        result: { overallStatus: 'ALL_VERIFIED' },
        finalStatus: 'PUBLISHED_VERIFIED',
        claimedMetadata: baseClaimedMetadata,
      })

      expect(res).toEqual({ status: 'PUBLISHED_VERIFIED' })
      expect(savedPayload.status).toBe('PUBLISHED_VERIFIED')
      expect(savedPayload.metadata.execution_state).toBe('OBSERVING')
    })

    it('COMPLETED 승격 시 contract가 있으면 execution_state가 OBSERVING으로 전이된다', async () => {
      let savedPayload: any = null
      const admin = createMockAdmin({
        id: 'mission-1',
        status: 'EXECUTING',
        metadata: {
          retryLock: 'lock-1',
          execution_state: 'RUNNING',
          control_epoch: 1,
          contract: baseContract,
          snapshot_version: 1,
        },
      }, (p) => { savedPayload = p })

      const res = await persistPublishResult(admin, {
        missionId: 'mission-1',
        workspaceId: 'ws-1',
        lock: 'lock-1',
        result: { overallStatus: 'ALL_VERIFIED' },
        finalStatus: 'COMPLETED',
        claimedMetadata: baseClaimedMetadata,
      })

      expect(res).toEqual({ status: 'COMPLETED' })
      expect(savedPayload.metadata.execution_state).toBe('OBSERVING')
    })

    it('FAILED, UNKNOWN, PENDING 등 미검증 상태는 OBSERVING으로 승격 금지한다', async () => {
      for (const unverifiedStatus of ['FAILED', 'UNKNOWN', 'PENDING', 'EXECUTING']) {
        let savedPayload: any = null
        const admin = createMockAdmin({
          id: 'mission-1',
          status: 'EXECUTING',
          metadata: {
            retryLock: 'lock-1',
            execution_state: 'RUNNING',
            control_epoch: 1,
            contract: baseContract,
            snapshot_version: 1,
          },
        }, (p) => { savedPayload = p })

        await persistPublishResult(admin, {
          missionId: 'mission-1',
          workspaceId: 'ws-1',
          lock: 'lock-1',
          result: { overallStatus: 'FAILED' },
          finalStatus: unverifiedStatus,
          claimedMetadata: baseClaimedMetadata,
        })

        expect(savedPayload.metadata.execution_state).toBe('RUNNING')
        expect(savedPayload.metadata.execution_state).not.toBe('OBSERVING')
      }
    })

    it('PAUSED 상태에서는 mayAdvance가 false이므로 상태 및 execution_state가 보존된다', async () => {
      let savedPayload: any = null
      const admin = createMockAdmin({
        id: 'mission-1',
        status: 'EXECUTING',
        metadata: {
          retryLock: 'lock-1',
          execution_state: 'PAUSED',
          control_epoch: 1,
          contract: baseContract,
          snapshot_version: 1,
        },
      }, (p) => { savedPayload = p })

      const res = await persistPublishResult(admin, {
        missionId: 'mission-1',
        workspaceId: 'ws-1',
        lock: 'lock-1',
        result: { overallStatus: 'ALL_VERIFIED' },
        finalStatus: 'PUBLISHED_VERIFIED',
        claimedMetadata: baseClaimedMetadata,
      })

      expect(res).toEqual({ status: 'EXECUTING' })
      expect(savedPayload.status).toBe('EXECUTING')
      expect(savedPayload.metadata.execution_state).toBe('PAUSED')
    })
  })
})
