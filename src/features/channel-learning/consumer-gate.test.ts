import { describe, expect, it, vi } from 'vitest'
import {
  validateLearningResult,
  filterApprovedContextForChannelLearning,
  type ConsumerGateDeps,
  verifyDependenciesCurrent,
} from './consumer-gate'
import type { SourceRef } from './contracts'

describe('consumer-gate', () => {
  const workspaceId = '11111111-1111-1111-1111-111111111111'
  const sourceRefA: SourceRef = {
    workspaceId,
    sourceId: '22222222-2222-2222-2222-222222222222',
    revision: 3,
  }

  describe('validateLearningResult', () => {
    it('returns true when dependencies are empty (manual-only or no channel dependency)', async () => {
      const deps: ConsumerGateDeps = {
        checkEpochAndLease: vi.fn().mockResolvedValue(true),
      }

      const valid = await validateLearningResult(
        {
          workspaceId,
          epoch: 1,
          dependencies: [],
        },
        deps,
      )

      expect(valid).toBe(true)
      expect(deps.checkEpochAndLease).not.toHaveBeenCalled()
    })

    it('returns true when all dependencies and workspace epoch are verified by gate', async () => {
      const deps: ConsumerGateDeps = {
        checkEpochAndLease: vi.fn().mockResolvedValue(true),
      }

      const valid = await validateLearningResult(
        {
          workspaceId,
          epoch: 2,
          dependencies: [sourceRefA],
        },
        deps,
      )

      expect(valid).toBe(true)
      expect(deps.checkEpochAndLease).toHaveBeenCalledWith(workspaceId, 2, [sourceRefA], undefined)
    })

    it('F5: forwards purpose parameter to checkEpochAndLease', async () => {
      const deps: ConsumerGateDeps = {
        checkEpochAndLease: vi.fn().mockResolvedValue(true),
      }

      const valid = await validateLearningResult(
        {
          workspaceId,
          epoch: 2,
          dependencies: [sourceRefA],
          purpose: 'image',
        },
        deps,
      )

      expect(valid).toBe(true)
      expect(deps.checkEpochAndLease).toHaveBeenCalledWith(workspaceId, 2, [sourceRefA], 'image')
    })

    it('returns false when a source was revoked or lease expired while generation was in flight', async () => {
      const deps: ConsumerGateDeps = {
        checkEpochAndLease: vi.fn().mockResolvedValue(false),
      }

      const valid = await validateLearningResult(
        {
          workspaceId,
          epoch: 2,
          dependencies: [sourceRefA],
        },
        deps,
      )

      expect(valid).toBe(false)
    })
  })

  describe('filterApprovedContextForChannelLearning', () => {
    const rawFacts = [
      { id: 'f-1', source_type: 'manual', content: '사장님 수동 등록 정보' },
      { id: 'f-2', source_type: 'file', content: '사업자등록증 파일 정보' },
      { id: 'f-3', source_type: 'channel', content: '인스타그램 학습 정보' },
    ]

    it('preserves manual and file facts but strips channel facts when SOHEE_CHANNEL_LEARNING_ENABLED != 1', () => {
      const filtered = filterApprovedContextForChannelLearning(rawFacts, false)
      expect(filtered).toHaveLength(2)
      expect(filtered.map((f) => f.id)).toEqual(['f-1', 'f-2'])
    })

    it('preserves channel facts when SOHEE_CHANNEL_LEARNING_ENABLED == 1', () => {
      const filtered = filterApprovedContextForChannelLearning(rawFacts, true)
      expect(filtered).toHaveLength(3)
    })
  })

  describe('verifyDependenciesCurrent with authoritative RPC validate_learning_result', () => {
    it('returns true when SQL authority RPC confirms data === true and error is null', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: true,
          error: null,
        }),
      }

      const ok = await verifyDependenciesCurrent(mockClient as any, workspaceId, 1, [sourceRefA])
      expect(ok).toBe(true)
      expect(mockClient.rpc).toHaveBeenCalledWith('validate_learning_result', {
        p_workspace_id: workspaceId,
        p_expected_epoch: 1,
        p_dependencies: [sourceRefA],
        p_purpose: 'content',
      })
    })

    it('F5: verifyDependenciesCurrent passes explicit purpose to RPC', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: true,
          error: null,
        }),
      }

      const ok = await verifyDependenciesCurrent(mockClient as any, workspaceId, 1, [sourceRefA], 'image')
      expect(ok).toBe(true)
      expect(mockClient.rpc).toHaveBeenCalledWith('validate_learning_result', {
        p_workspace_id: workspaceId,
        p_expected_epoch: 1,
        p_dependencies: [sourceRefA],
        p_purpose: 'image',
      })
    })

    it('returns false when SQL authority RPC rejects dependencies (data === false)', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: false,
          error: null,
        }),
      }

      const ok = await verifyDependenciesCurrent(mockClient as any, workspaceId, 1, [sourceRefA])
      expect(ok).toBe(false)
    })

    it('fails closed (returns false) when RPC returns an error or rejects', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'DB_CONNECTION_TIMEOUT' },
        }),
      }

      const ok = await verifyDependenciesCurrent(mockClient as any, workspaceId, 1, [sourceRefA])
      expect(ok).toBe(false)
    })

    it('fails closed (returns false) when client has no rpc function', async () => {
      const clientWithoutRpc = {}
      const ok = await verifyDependenciesCurrent(clientWithoutRpc as any, workspaceId, 1, [sourceRefA])
      expect(ok).toBe(false)
    })
  })
})
