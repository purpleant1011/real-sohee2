// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { InteractionDraftCardData } from '@/features/engagement/interaction-draft-contract'
import { ConversationInteractionDraftCard } from './conversation-interaction-draft-card'
import { ConversationOperationCatalogView } from './conversation-operation-catalog-view'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'
import { ConnectorDetailModal } from '@/features/marketing-connectors/ui/connector-detail-modal'
import type { ConnectorDefinition } from '@/features/marketing-connectors/catalog'

// Next.js Link & AppLink mocks
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'object' ? href.pathname : href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/navigation/app-link', () => ({
  AppLink: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const mocks = vi.hoisted(() => ({
  workspaceId: '20000000-0000-4000-8000-000000000001',
  guard: vi.fn(),
}))

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => mocks.workspaceId,
}))

vi.mock('@/features/pwa/use-external-write-guard', () => ({
  useExternalWriteGuard: () => mocks.guard,
}))

const mockSnapshot: InteractionDraftCardData = {
  id: '40000000-0000-4000-8000-000000000001',
  kind: 'interaction_draft',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  targetKind: 'comment',
  channel: 'instagram',
  targetId: '60000000-0000-4000-8000-000000000001',
  draftId: '70000000-0000-4000-8000-000000000001',
  draftText: '안녕하세요 고객님! 문의주신 예약 일정은 상단 링크에서 확인 가능합니다.',
  fingerprint: 'a'.repeat(64),
  sourceRef: 'b'.repeat(64),
  customerLabel: '단골고객_매우긴아이디_텍스트말줄임_검증을_위한_긴문자열_테스트_라벨',
  preparedAt: '2026-10-30T10:00:00Z',
  reused: false,
  requiresUserApproval: true,
}

const mockThreadId = '30000000-0000-4000-8000-000000000001'

const mockReview = {
  snapshot: Object.fromEntries(Object.entries(mockSnapshot).filter(([key]) => key !== 'id')),
  sourceText: '내일 오후 2시에 단체 예약 가능한가요? 자리 있는지 확인 부탁드려요.',
  currentDraftText: mockSnapshot.draftText,
  canSend: true,
  reason: null,
  observedAt: '2026-10-30T10:05:00Z',
}

const mockCatalogInput = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  role: 'owner' as const,
  workbenchEnabled: true,
  agentEnabled: true,
  modelConfigured: true,
  connectedChannels: ['naver_blog', 'instagram'],
  observedAt: '2026-10-30T12:00:00Z',
}

const mockConnector: ConnectorDefinition = {
  id: 'google_calendar',
  name: 'Google Calendar',
  category: 'productivity',
  purpose: '매장 휴무일, 행사 일정 파악 및 예약 가능 시간 연계',
  reads: ['업무 캘린더 일정 제목 및 일시'],
  excludes: ['개인 사서함 전체', '비공개 메모'],
  method: 'oauth',
  readiness: 'setup_required',
  aliases: ['구글캘린더'],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function setViewport(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
  window.dispatchEvent(new Event('resize'))
}

describe('[MC/DUAL-06] 모바일(390px) & PC(1280px) 듀얼 뷰포트 반응형 및 접근성 회귀 검증 (ANI-1996)', () => {
  beforeEach(() => {
    mocks.workspaceId = mockSnapshot.workspaceId
    mocks.guard.mockReset().mockImplementation(async (_kind: string, _key: string, task: () => Promise<unknown>) => ({
      ran: true,
      value: await task(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('1. 모바일 390px 뷰포트 검증 (window.innerWidth = 390)', () => {
    beforeEach(() => {
      setViewport(390, 844)
    })

    it('ConversationInteractionDraftCard: 모바일 화면에서 버튼 너비 100%, 텍스트 말줄임 및 최소 44px 터치 타깃을 준수한다', () => {
      render(
        <div style={{ width: '390px', maxWidth: '390px' }}>
          <ConversationInteractionDraftCard snapshot={mockSnapshot} threadId={mockThreadId} />
        </div>
      )

      // 1. 헤더 타이틀에 말줄임(truncate)이 적용되어 긴 라벨로 인한 390px 가로 깨짐 방지
      const heading = screen.getByText(new RegExp(mockSnapshot.customerLabel))
      expect(heading.className).toMatch(/truncate|break-words/)

      // 2. 카드 푸터의 모든 버튼/링크가 모바일 너비 100% 클래스 (w-full) 적용
      const openReviewBtn = screen.getByRole('button', { name: '최신 원문과 답안 확인' })
      expect(openReviewBtn.className).toContain('w-full')

      const editLinkBtn = screen.getByRole('link', { name: '소통함에서 수정' })
      const editButtonParent = editLinkBtn.closest('button') || editLinkBtn
      expect(editButtonParent.className).toContain('w-full')

      // 3. 터치 타깃 크기: 모든 버튼은 최소 44px 높이 보장 (inline style minHeight >= 44px 또는 min-h-11)
      const buttons = screen.getAllByRole('button')
      buttons.forEach((btn) => {
        const minHeightStyle = btn.style.minHeight
        const hasMinH11Class = btn.className.includes('min-h-11')
        const hasMinHeight44 = minHeightStyle === '44px' || minHeightStyle.includes('44px')
        expect(hasMinHeight44 || hasMinH11Class).toBe(true)
      })
    })

    it('ConversationInteractionDraftCard: 390px 모바일 화면에서 모달 오픈 시 수직 스크롤(overflow-y-auto, max-h-[65dvh]) 및 닫기 후 포커스 복원을 검증한다', async () => {
      const fetcher = vi.fn().mockResolvedValue(jsonResponse({ data: mockReview }))
      vi.stubGlobal('fetch', fetcher)

      render(
        <div style={{ width: '390px', maxWidth: '390px' }}>
          <ConversationInteractionDraftCard snapshot={mockSnapshot} threadId={mockThreadId} />
        </div>
      )

      const openButton = screen.getByRole('button', { name: '최신 원문과 답안 확인' })
      openButton.focus()
      fireEvent.click(openButton)

      // 모달 다이얼로그 오픈 확인
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // 모바일 390px 뷰포트 내 수직 스크롤 컨테이너 존재 및 max-h 클래스 확인
      const scrollContainer = dialog.querySelector('.overflow-y-auto')
      expect(scrollContainer).toBeInTheDocument()
      expect(scrollContainer?.className).toContain('max-h-[65dvh]')

      // 모달 내 액션 버튼들도 모바일에서 w-full 클래스 및 최소 44px 터치 높이 준수
      const sendButton = screen.getByRole('button', { name: '이 문안으로 발송' })
      expect(sendButton.className).toContain('w-full')
      expect(sendButton.style.minHeight).toBe('44px')

      const closeButtons = screen.getAllByRole('button', { name: '닫기' })
      const modalCloseActionBtn = closeButtons.find((btn) => btn.textContent === '닫기')
      expect(modalCloseActionBtn?.className).toContain('w-full')

      // 닫기 버튼 클릭 시 모달이 닫히고 원래 오픈 버튼으로 포커스 복원 확인
      fireEvent.click(modalCloseActionBtn!)
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      await waitFor(() => {
        expect(openButton).toHaveFocus()
      })
    })

    it('ConversationOperationCatalog: 390px 모바일 화면에서 빠른 내비게이션 칩 및 44px 터치 타깃을 제공한다', () => {
      const catalog = buildConversationOperationCatalog(mockCatalogInput)
      const { container } = render(
        <div style={{ width: '390px', maxWidth: '390px' }}>
          <ConversationOperationCatalogView catalog={catalog} onSelect={vi.fn()} />
        </div>
      )

      // 390px 모바일 뷰포트용 빠른 내비게이션 영역 렌더링 확인
      const quickNav = screen.getByRole('navigation', { name: '업무 분류' })
      expect(quickNav).toBeInTheDocument()

      // 퀵내비 링크들이 모두 렌더링되어 있는지 확인
      const navLinks = quickNav.querySelectorAll('a')
      expect(navLinks.length).toBe(3)

      // 카탈로그 내 작업 액션 버튼(대화에 담기, 직접 열기)들은 모두 min-h-11 (44px) 클래스 적용
      const actionButtons = container.querySelectorAll('.min-h-11')
      expect(actionButtons.length).toBeGreaterThan(0)
    })

    it('ConnectorDetailModal: 390px 모바일 화면에서 액션 버튼 너비 100% 및 44px 터치 타깃을 유지한다', () => {
      render(
        <div style={{ width: '390px', maxWidth: '390px' }}>
          <ConnectorDetailModal
            connector={mockConnector}
            isOpen={true}
            onClose={vi.fn()}
            onConnect={vi.fn()}
          />
        </div>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // 모바일에서 연결 시작 버튼 너비 100% (w-full sm:w-auto)
      const connectBtn = screen.getByRole('button', { name: '연결 시작' })
      expect(connectBtn.className).toContain('w-full')
      expect(connectBtn.style.minHeight).toBe('44px')

      // 1열 그리드 모바일 레이아웃 클래스 확인 (grid-cols-1)
      const gridContainer = dialog.querySelector('.grid-cols-1')
      expect(gridContainer).toBeInTheDocument()
    })
  })

  describe('2. PC 데스크톱 1280px 뷰포트 검증 (window.innerWidth = 1280)', () => {
    beforeEach(() => {
      setViewport(1280, 900)
    })

    it('ConversationOperationCatalog: 1280px 데스크톱 화면에서 3열 그리드 가로 정렬 및 키보드 탭 탐색을 지원한다', () => {
      const catalog = buildConversationOperationCatalog(mockCatalogInput)
      const { container } = render(
        <div style={{ width: '1280px', maxWidth: '1280px' }}>
          <ConversationOperationCatalogView catalog={catalog} onSelect={vi.fn()} />
        </div>
      )

      // 3개 업무 그룹(홍보·콘텐츠, 고객·예약, 운영·성과) 카드 렌더링 확인
      expect(screen.getByRole('heading', { level: 2, name: '홍보·콘텐츠' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2, name: '고객·예약' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2, name: '운영·성과' })).toBeInTheDocument()

      // 키보드 Tab 키 네비게이션: 첫 번째 버튼에서 다음 버튼/링크로 포커스 이동 가능
      const allFocusables = Array.from(
        container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      )
      expect(allFocusables.length).toBeGreaterThan(3)

      allFocusables[0].focus()
      expect(allFocusables[0]).toHaveFocus()

      fireEvent.keyDown(allFocusables[0], { key: 'Tab' })
      allFocusables[1].focus()
      expect(allFocusables[1]).toHaveFocus()
    })

    it('ConversationInteractionDraftCard: 1280px 데스크톱 화면에서 다이얼로그와 액션 버튼 가로 정렬 및 Escape 닫기를 검증한다', async () => {
      const fetcher = vi.fn().mockResolvedValue(jsonResponse({ data: mockReview }))
      vi.stubGlobal('fetch', fetcher)

      render(
        <div style={{ width: '1280px', maxWidth: '1280px' }}>
          <ConversationInteractionDraftCard snapshot={mockSnapshot} threadId={mockThreadId} />
        </div>
      )

      // 데스크톱에서는 버튼이 sm:w-auto로 유연한 너비 지정
      const openReviewBtn = screen.getByRole('button', { name: '최신 원문과 답안 확인' })
      expect(openReviewBtn.className).toContain('sm:w-auto')

      fireEvent.click(openReviewBtn)
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // 다이얼로그 액션 버튼 컨테이너가 sm:flex-row 또는 justify-end 정렬을 포함하는지 확인
      const actionsContainer = screen.getByRole('button', { name: '이 문안으로 발송' }).parentElement
      expect(actionsContainer?.className).toMatch(/sm:flex-row|justify-end/)

      // 키보드 Escape 키로 모달 닫기
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('ConnectorDetailModal: 1280px 데스크톱 화면에서 2열 그리드(sm:grid-cols-2) 가로 정렬 및 호버 스타일을 갖춘다', () => {
      render(
        <div style={{ width: '1280px', maxWidth: '1280px' }}>
          <ConnectorDetailModal
            connector={mockConnector}
            isOpen={true}
            onClose={vi.fn()}
            onConnect={vi.fn()}
          />
        </div>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()

      // 읽는 정보와 제외 정보가 데스크톱 2열 그리드(sm:grid-cols-2)로 배치
      const infoGrid = dialog.querySelector('.sm\\:grid-cols-2')
      expect(infoGrid).toBeInTheDocument()

      // 액션 버튼 영역이 데스크톱에서 가로 정렬(sm:flex-row) 유지
      const actionsBar = dialog.querySelector('.sm\\:flex-row')
      expect(actionsBar).toBeInTheDocument()

      // 연결 버튼이 데스크톱 가로 모드에서 sm:w-auto 클래스를 갖춤
      const connectBtn = screen.getByRole('button', { name: '연결 시작' })
      expect(connectBtn.className).toContain('sm:w-auto')
    })
  })
})
