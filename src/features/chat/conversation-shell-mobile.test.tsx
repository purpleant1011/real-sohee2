import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('next/navigation', () => ({ usePathname: () => '/app/conversations', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
import { ConversationShell } from './conversation-shell'

const common = { onSubmit: vi.fn(async () => true) as never, workspaceId: 'ws', directWorkHref: '/app' }

describe('ConversationShell 모바일 표현', () => {
  it('빈 대화는 큼직한 시작 허브를 보이고 PC형 탭행·현재 대화 라벨·안내 박스는 없다', () => {
    render(<MobileR2Provider enabled forceMobile><ConversationShell {...common} /></MobileR2Provider>)
    expect(screen.getByRole('heading', { name: /무엇을 하고 싶으세요/ })).toBeInTheDocument()
    expect(screen.queryByText('대화로 맡기기')).toBeNull()
    expect(screen.queryByText('현재 대화')).toBeNull()
    expect(screen.queryByText('게시·발송은 검토 후 승인해요')).toBeNull()
  })
  it('허브에서 고른 내용은 입력창 위의 요약 배지로 연결되고 전송 버튼을 눌러야 첫 메시지로 전송된다', () => {
    const onSubmit = vi.fn(async () => true)
    render(<MobileR2Provider enabled forceMobile><ConversationShell {...common} onSubmit={onSubmit as never} /></MobileR2Provider>)
    fireEvent.click(screen.getByRole('button', { name: /소희 가르치기/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    // 칩 선택 요약 배지가 노출됨
    expect(screen.getByText('소희 가르치기', { selector: '[data-slot="badge"] span' })).toBeInTheDocument()
    // 전송은 입력창 오른쪽 전송 버튼 하나로 통일
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect((onSubmit.mock.calls[0] as unknown[])[0]).toMatchObject({ message: expect.stringContaining('가르') })
  })
  it('PC 표현은 기존 화면 그대로다', () => {
    render(<ConversationShell {...common} />)
    expect(screen.getByText('대화로 맡기기')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /무엇을 하고 싶으세요/ })).toBeNull()
  })

  it('모바일에서는 Shift+Enter 단축키와 작업공간 용어가 노출되지 않는다', () => {
    render(<MobileR2Provider enabled forceMobile><ConversationShell {...common} connectionState="connected" /></MobileR2Provider>)
    expect(screen.queryByText(/Shift\+Enter/)).not.toBeInTheDocument()
    expect(screen.queryByText(/작업공간/)).not.toBeInTheDocument()
    expect(screen.getByText('작성한 내용은 자동으로 저장돼요.')).toBeInTheDocument()
  })
})
