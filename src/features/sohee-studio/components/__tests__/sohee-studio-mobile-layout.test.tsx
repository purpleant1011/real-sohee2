import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

vi.mock('../sohee-conversation-console', () => ({ SoheeConversationConsole: () => <p>대화 콘솔</p> }))
vi.mock('../sohee-brain-dashboard', () => ({ SoheeBrainDashboard: () => <p>두뇌 대시보드</p> }))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })))

import { SoheeStudioView } from '../sohee-studio-view'

describe('소희 스튜디오 모바일 표현', () => {
  it('모바일 표현에서는 화면 폭과 무관하게 한 번에 한 패널만, 전환 버튼과 함께 보인다', () => {
    const { container } = render(
      <MobileR2Provider enabled forceMobile><SoheeStudioView workspaceId="ws" /></MobileR2Provider>,
    )
    // PC 2열 브레이크포인트 클래스가 없어야 한다(넓은 화면에서도 2열로 깨지지 않는다)
    expect(container.innerHTML).not.toMatch(/lg:col-span|lg:grid-cols|lg:block|lg:hidden/)
    expect(screen.getByRole('button', { name: /소희의 두뇌/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /소희의 두뇌/ }))
    expect(screen.getByText('두뇌 대시보드').parentElement?.className).not.toContain('hidden')
  })
})
