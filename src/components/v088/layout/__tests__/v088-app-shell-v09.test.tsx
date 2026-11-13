import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'
import { MobileUiProvider } from '@/features/mobile-decision/mobile-ui-provider'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'

function WorkbenchRelease({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider value={{ workspaceId: 'ws-test', workspaceName: null, workspaceKind: null, membershipRole: 'owner', actorId: 'user-test', resolutionSource: 'membership', conversationWorkbenchEnabled: true }}>{children}</WorkspaceProvider>
}
import { ChatPanelProvider, useChatPanel } from '@/features/agent-dock/chat-panel-store'

function PendingDraftObserver() {
  const panel = useChatPanel()
  return <output aria-label="인계 입력">{panel.pendingMessage?.text ?? ''}</output>
}
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: (query: string) => query.includes('max-width: 767px') }))

let mockPathname = '/app'
const mockPush = vi.hoisted(() => vi.fn())

// Mock dependencies
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt || ''} />,
}))

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

let mockCreditBalanceState = {
  capacity: 5000,
  balance: 5000,
  remainingPercentage: 100,
  available: 5000,
  spent: 0,
  usedCredits: 0,
  usagePercentage: 0,
  status: 'ACTIVE',
  planName: '실제 사업자 무료 맛보기 (50 Energy)',
  refillAt: '추가 리필 없음 (유료 플랜 전환 필요)',
  burnGovernorActive: false,
  isLoading: false,
  hasError: false,
  refreshCredits: vi.fn(),
  reserveCredit: vi.fn(),
  settleCredit: vi.fn(),
}

const creditSourceSpy = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: (...args: unknown[]) => { creditSourceSpy(...args); return mockCreditBalanceState },
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    isPaused: false,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: 'owner@business.kr',
            user_metadata: { full_name: '홍길동' },
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { business_name: '홍길동 뷰티스튜디오' },
          }),
        }),
        in: () => ({
          limit: () => vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}))

describe('V088AppShell V0.9 Canonical Truth Invariants (ANI-719, ANI-700)', () => {
  beforeEach(() => { mockPathname = '/app'; mockPush.mockClear() })
  it('selects canonical credit reads only for the server-enabled beta', () => {
    creditSourceSpy.mockClear()
    const view = render(<WorkbenchRelease><V088AppShell workspaceId="ws-test"><p>대화</p></V088AppShell></WorkbenchRelease>)
    expect(creditSourceSpy).toHaveBeenCalledWith('ws-test', 'conversation')
    view.unmount()
    creditSourceSpy.mockClear()
    render(<V088AppShell workspaceId="ws-test"><p>기존 화면</p></V088AppShell>)
    expect(creditSourceSpy).toHaveBeenCalledWith('ws-test', 'energy')
  })

  it('keeps the draft in the persistent provider after the source page unmounts', () => {
    const navigate = vi.fn()
    const { rerender } = render(<ChatPanelProvider onOpenConversation={navigate} workspaceId="ws-test">
      <PendingDraftObserver /><V088AppShell workspaceId="ws-test"><p>출발 화면</p></V088AppShell>
    </ChatPanelProvider>)
    fireEvent.change(screen.getByPlaceholderText(/소희에게 부탁하기/), { target: { value: '이 문장은 이동해도 보존' } })
    fireEvent.click(screen.getByRole('button', { name: '지시사항 보내기' }))
    expect(navigate).toHaveBeenCalledOnce()
    rerender(<ChatPanelProvider onOpenConversation={navigate} workspaceId="ws-test"><PendingDraftObserver /></ChatPanelProvider>)
    expect(screen.getByLabelText('인계 입력')).toHaveTextContent('이 문장은 이동해도 보존')
  })

  it('opens the canonical full conversation from the desktop header without a dock', () => {
    render(<WorkbenchRelease><V088AppShell workspaceId="ws-test"><p>콘텐츠 화면</p></V088AppShell></WorkbenchRelease>)
    fireEvent.click(screen.getByRole('button', { name: '소희와 대화하기' }))
    expect(mockPush).toHaveBeenCalledWith('/app/conversations')
    expect(screen.queryByTestId('sohee-chat-drawer')).not.toBeInTheDocument()
  })

  it.each(['/app/conversations', '/app/conversations/thread-1', '/app/command'])('does not cover the chat composer with the feedback launcher: %s', path => {
    mockPathname = path
    render(<WorkbenchRelease><MobileUiProvider enabled><V088AppShell workspaceId="ws-test"><p>전체 대화</p></V088AppShell></MobileUiProvider></WorkbenchRelease>)
    expect(screen.queryByRole('button', { name: '의견 보내기' })).not.toBeInTheDocument()
  })
  it('removes the redundant chat trigger from the legacy mobile header on a full conversation', () => {
    mockPathname = '/app/conversations'
    render(<WorkbenchRelease><V088AppShell workspaceId="ws-test"><p>전체 대화</p></V088AppShell></WorkbenchRelease>)
    expect(screen.queryByRole('button', { name: '대화' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '더보기 메뉴 열기' })).toBeInTheDocument()
  })
  it('keeps feedback available outside chat', () => {
    mockPathname = '/app/content'
    render(<WorkbenchRelease><V088AppShell workspaceId="ws-test"><p>콘텐츠 화면</p></V088AppShell></WorkbenchRelease>)
    // PC 사이드바 한 개 + 모바일 전용 떠 있는 버튼 한 개
    expect(screen.getAllByRole('button', { name: '의견 보내기' }).length).toBeGreaterThanOrEqual(1)
  })
  it('has one composer and no bottom navigation on the full conversation route', () => {
    mockPathname = '/app/conversations'
    render(<WorkbenchRelease><MobileUiProvider enabled><V088AppShell workspaceId="ws-test"><p>전체 대화</p></V088AppShell></MobileUiProvider></WorkbenchRelease>)
    expect(screen.queryByPlaceholderText(/소희에게 부탁하기/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '대화' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).not.toBeInTheDocument()
    expect(screen.getByTestId('workbench-pane')).toHaveAttribute('data-conversation-surface', 'true')
  })
  it('uses decision navigation and removes duplicate mobile chat entry when enabled', () => {
    render(<MobileUiProvider enabled><V088AppShell workspaceId="ws-test"><p>신규 화면</p></V088AppShell></MobileUiProvider>)
    const navigation = screen.getByRole('navigation', { name: '소희 업무 메뉴' })
    expect(navigation.querySelectorAll('a')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '소희와 채팅' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '소희대화' })).not.toBeInTheDocument()
  })
  it('renders V0.9.0 brand badge and 마케팅 전담 직원 subtitle', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    // Version badges (both desktop and mobile)
    const versionBadges = screen.getAllByText('0.9.0')
    expect(versionBadges.length).toBeGreaterThanOrEqual(1)

    // Subtitle
    const subtitles = screen.getAllByText('마케팅 전담 직원')
    expect(subtitles.length).toBeGreaterThanOrEqual(1)

    // Verify 0.8.8 does not exist
    expect(screen.queryByText('0.8.8')).toBeNull()
  })

  it('omits credits gauge, balance, and limits from sidebar footer', () => {
    const { container } = render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByText('소희 크레딧')).toBeNull()
    expect(screen.queryByText('5,000 크레딧')).toBeNull()
    expect(screen.queryByText(/한도/)).toBeNull()
    expect(screen.queryByText('주간 크레딧')).toBeNull()
    expect(screen.queryByText(/SC/)).toBeNull()
    expect(screen.queryByText('Agent Energy')).toBeNull()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('SC')
    expect(container.textContent).not.toContain('차감')
  })

  it('does not render credit widget even when credits are loading', () => {
    mockCreditBalanceState = {
      ...mockCreditBalanceState,
      isLoading: true,
      balance: 0,
      capacity: 5000,
      remainingPercentage: 0,
    }

    const { container } = render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByText('불러오는 중이에요')).toBeNull()
    expect(container.textContent).not.toContain('크레딧')
  })

  it('does not render credit widget when credits fail to load', () => {
    mockCreditBalanceState = {
      ...mockCreditBalanceState,
      isLoading: false,
      hasError: true,
      balance: 0,
      capacity: 5000,
      remainingPercentage: 0,
    }

    const { container } = render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(container.textContent).not.toContain('크레딧')
  })

  it('does not render credit widget when capacity is 0', () => {
    mockCreditBalanceState = {
      ...mockCreditBalanceState,
      isLoading: false,
      hasError: false,
      balance: 0,
      capacity: 0,
      remainingPercentage: 0,
    }

    const { container } = render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    expect(screen.queryByText('확인 불가')).toBeNull()
    expect(container.textContent).not.toContain('크레딧')
  })

  it('renders mobile bottom tabs in canonical 5 tabs: 오늘, 작업, 고객, 성과, 더보기 and top more menu', () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>Content Area</div>
      </V088AppShell>
    )

    const mobileBottomNav = screen
      .getAllByRole('navigation')
      .find((el) => el.className.includes('fixed bottom-0'))
    expect(mobileBottomNav).toBeDefined()

    const tabs = within(mobileBottomNav!)
    expect(tabs.getByRole('link', { name: /오늘/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /작업/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /고객/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /성과/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /더보기/ })).toBeDefined()

    // ANI-1664-1: 대화 진입점은 탭이 아니라 헤더 명령('소희에게 맡기기')·FAB·커맨드바가 담당한다.
    expect(tabs.queryByRole('button', { name: /소희대화/ })).toBeNull()
    expect(screen.getByRole('button', { name: /더보기 메뉴 열기/ })).toBeDefined()
  })

  // ANI-1665-5: 전역 커맨드바는 BROWSE 전용 CTA 다. CHAT 화면은 자체 입력을 가지므로
  // 모바일에서 커맨드바를 숨겨 입력이 두 개로 갈라지지 않게 한다(md 이상은 기존 노출 유지).
  it('keeps the global command bar visible in BROWSE mode', () => {
    render(
      <MobileUiProvider enabled>
        <V088AppShell workspaceId="ws-test"><p>신규 화면</p></V088AppShell>
      </MobileUiProvider>
    )

    const bar = screen.getByPlaceholderText(/소희에게 부탁하기/)
    expect(bar.closest('.sticky')?.className).not.toContain('hidden md:block')
  })

  it('hides the global command bar on the CHAT command screen so its input stays single', () => {
    mockPathname = '/app/command'
    render(
      <MobileUiProvider enabled>
        <V088AppShell workspaceId="ws-test"><p>대화 화면</p></V088AppShell>
      </MobileUiProvider>
    )

    const bar = screen.getByPlaceholderText(/소희에게 부탁하기/)
    expect(bar.closest('.sticky')?.className).toContain('hidden md:block')
  })
})
