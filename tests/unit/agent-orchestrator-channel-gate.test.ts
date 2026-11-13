import { describe, it, expect, vi } from 'vitest'
import { verifyDependenciesCurrent } from '@/features/channel-learning/consumer-gate'

describe('AgentOrchestrator Channel Learning Post-Gate (ANI-2192)', () => {
  const mockWorkspaceId = '11111111-1111-4111-8111-111111111111'

  it('채널 지식 의존성이 존재할 때 validate_learning_result RPC를 올바른 파라미터로 호출한다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const mockClient = { rpc: mockRpc }

    const dependencies = [
      { workspaceId: mockWorkspaceId, sourceId: 'src-1', revision: 2 },
    ]

    const result = await verifyDependenciesCurrent(
      mockClient as any,
      mockWorkspaceId,
      3,
      dependencies,
      'conversation',
    )

    expect(result).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('validate_learning_result', {
      p_workspace_id: mockWorkspaceId,
      p_expected_epoch: 3,
      p_dependencies: dependencies,
      p_purpose: 'conversation',
    })
  })

  it('출처가 철회되었거나 epoch이 불일치하여 RPC가 false를 반환하면 검증 실패(false)를 반환한다', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const mockClient = { rpc: mockRpc }

    const dependencies = [
      { workspaceId: mockWorkspaceId, sourceId: 'src-1', revision: 2 },
    ]

    const result = await verifyDependenciesCurrent(
      mockClient as any,
      mockWorkspaceId,
      3,
      dependencies,
      'conversation',
    )

    expect(result).toBe(false)
  })
})
