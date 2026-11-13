import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SoheeStudioView } from '../sohee-studio-view'

vi.mock('../sohee-conversation-console', () => ({ SoheeConversationConsole: () => <div>교육 대화</div> }))
vi.mock('../sohee-brain-dashboard', () => ({
  SoheeBrainDashboard: ({ activeTab, workspaceId }: { activeTab: string; workspaceId: string }) =>
    <section aria-label="소희 두뇌">{workspaceId}:{activeTab}</section>,
}))
afterEach(() => vi.unstubAllGlobals())

describe('소희 지식 일지 진입', () => {
  it('지시·학습 일지에서 같은 가게의 일지와 모바일 두뇌 화면을 연다', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }))))
    render(<SoheeStudioView workspaceId="workspace-test" />)
    fireEvent.click(screen.getByRole('button', { name: '지시·학습 일지' }))
    const brain = screen.getByRole('region', { name: '소희 두뇌' })
    expect(brain).toHaveTextContent('workspace-test:journal')
    expect(brain.parentElement).not.toHaveClass('hidden')
  })
})
