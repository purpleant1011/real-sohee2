import { describe, it, expect, vi, afterEach } from 'vitest'
import { revalidateApprovedFactSnapshot } from '@/features/publishing/fact-snapshot-gate'
import type { ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'

describe('FactSnapshotGate Channel Learning Validation (ANI-2205)', () => {
  const mockWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const prevEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

  afterEach(() => {
    if (prevEnv !== undefined) process.env.SOHEE_CHANNEL_LEARNING_ENABLED = prevEnv
    else delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
  })

  const mockSnapshot: ApprovedFactSnapshot = {
    workspaceId: mockWorkspaceId,
    hash: 'hash-1',
    resolvedAt: '2026-11-11T00:00:00.000Z',
    facts: [],
  }

  const mockResolver = {
    loadApprovedFactSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
    assertFactSnapshotCurrent: vi.fn(),
  }

  it('채널 지식 의존성이 있고 validate_learning_result가 false를 반환하면 발행을 409로 차단한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'

    const mockAdmin = {
      from: vi.fn(),
      rpc: vi.fn((name: string) => {
        if (name === 'validate_learning_result') {
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }

    const result = await revalidateApprovedFactSnapshot({
      admin: mockAdmin as any,
      workspaceId: mockWorkspaceId,
      previousSnapshot: mockSnapshot,
      resolver: mockResolver as any,
      learningDependencies: [{ workspaceId: mockWorkspaceId, sourceId: 'src-1', revision: 2 }],
      learningEpoch: 3,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('FACT_REVIEW_REQUIRED')
      expect(result.reason).toBe('CHANNEL_SOURCE_REVOKED')
    }
  })

  it('채널 지식 의존성이 유효할 때는 발행을 정상 승인한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'

    const mockAdmin = {
      from: vi.fn(),
      rpc: vi.fn((name: string) => {
        if (name === 'validate_learning_result') {
          return Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }

    const result = await revalidateApprovedFactSnapshot({
      admin: mockAdmin as any,
      workspaceId: mockWorkspaceId,
      previousSnapshot: mockSnapshot,
      resolver: mockResolver as any,
      learningDependencies: [{ workspaceId: mockWorkspaceId, sourceId: 'src-1', revision: 2 }],
      learningEpoch: 3,
    })

    expect(result.ok).toBe(true)
  })
})
