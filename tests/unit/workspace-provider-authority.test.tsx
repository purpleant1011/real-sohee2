import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { WorkspaceProvider, useWorkspaceContext } from '@/components/workspace/workspace-provider'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

describe('Workspace Provider Authority & No ws-default Contract (ANI-1035)', () => {
  it('throws an error or fails closed when useWorkspaceId is called outside WorkspaceProvider', () => {
    // When there is no provider context and no verified session storage, it must NOT return 'ws-default'
    expect(() => {
      renderHook(() => useWorkspaceId())
    }).toThrow(/WORKSPACE_REQUIRED/)
  })

  it('provides server-authoritative workspace context to children', () => {
    const mockContext = {
      workspaceId: '00000000-0000-4000-8000-0000000000a2',
      workspaceName: '소희 테스트 키친',
      workspaceKind: 'commercial',
      membershipRole: 'owner',
      actorId: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec',
      resolutionSource: 'membership' as const
    }

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceProvider value={mockContext}>
        {children}
      </WorkspaceProvider>
    )

    const { result } = renderHook(() => useWorkspaceContext(), { wrapper })

    expect(result.current.workspaceId).toBe('00000000-0000-4000-8000-0000000000a2')
    expect(result.current.workspaceName).toBe('소희 테스트 키친')
    expect(result.current.membershipRole).toBe('owner')
    expect(result.current.actorId).toBe('3156b2d4-77f8-42c3-a8ac-6b9cc473dfec')

    const { result: idResult } = renderHook(() => useWorkspaceId(), { wrapper })
    expect(idResult.current).toBe('00000000-0000-4000-8000-0000000000a2')
  })

  it('rejects ws-default even if explicitly passed to useWorkspaceContext', () => {
    expect(() => {
      const invalidContext = {
        workspaceId: 'ws-default',
        workspaceName: null,
        workspaceKind: null,
        membershipRole: 'member',
        actorId: 'test-user',
        resolutionSource: 'membership' as const
      }
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WorkspaceProvider value={invalidContext}>
          {children}
        </WorkspaceProvider>
      )
      renderHook(() => useWorkspaceContext(), { wrapper })
    }).toThrow(/INVALID_WORKSPACE_UUID/)
  })
})
