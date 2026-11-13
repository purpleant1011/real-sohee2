import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ConversationNavigationProvider } from '../conversation-navigation-provider'
import { useChatPanel } from '../chat-panel-store'
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/app/content' }))
beforeEach(() => push.mockClear())
function wrapper(enabled: boolean) {
  return function Provider({ children }: { children: React.ReactNode }) {
    return <WorkspaceProvider value={{ workspaceId: 'workspace-a', workspaceName: null, workspaceKind: null,
      membershipRole: 'owner', actorId: 'user-a', resolutionSource: 'membership', conversationWorkbenchEnabled: enabled }}>
      <ConversationNavigationProvider>{children}</ConversationNavigationProvider>
    </WorkspaceProvider>
  }
}
it('keeps the legacy dock when the server rollout is off', () => {
  const { result } = renderHook(useChatPanel, { wrapper: wrapper(false) })
  act(() => result.current.openPanel())
  expect(result.current.isOpen).toBe(true)
  expect(push).not.toHaveBeenCalled()
})
it('opens the canonical workspace only for the server-enabled workspace', () => {
  const { result } = renderHook(useChatPanel, { wrapper: wrapper(true) })
  act(() => result.current.openPanel())
  expect(result.current.isOpen).toBe(false)
  expect(push).toHaveBeenCalledWith('/app/conversations')
})
