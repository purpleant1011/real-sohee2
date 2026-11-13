// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/components/workspace/workspace-provider', () => ({
  useOptionalWorkspaceContext: () => ({ conversationWorkbenchEnabled: true }),
}))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'workspace' }))
vi.mock('@/features/mobile-shell/r2-gate', () => ({ useMobileR2Active: () => true }))
vi.mock('@/features/mobile-chat/r2-chat', () => ({ R2Chat: () => <p>별도 에이전트 대화</p> }))
vi.mock('@/components/v088/command/command-center-client', () => ({ CommandCenterClient: () => <p>기존 지휘 화면</p> }))
import { CommandEntry } from '../command-entry'

describe('정본 대화 진입', () => {
  it('새 대화가 활성화된 가게는 별도 런타임을 마운트하지 않고 정본으로 이동한다', () => {
    render(<CommandEntry />)
    expect(replace).toHaveBeenCalledWith('/app/conversations')
    expect(screen.queryByText('별도 에이전트 대화')).not.toBeInTheDocument()
    expect(screen.queryByText('기존 지휘 화면')).not.toBeInTheDocument()
  })
})
