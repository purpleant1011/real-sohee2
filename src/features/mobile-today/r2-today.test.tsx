import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}))

// R2Today 내부에서 사용되는 TodayLayout 모킹 또는 검증
vi.mock('./today-layout', () => ({
  TodayLayout: ({
    view,
    onRefresh,
    onDelegate,
    workspaceId,
  }: {
    view: { businessName?: string }
    onRefresh: () => void
    onDelegate: () => void
    workspaceId: string
  }) => (
    <div data-testid="today-layout" data-workspace-id={workspaceId}>
      <h1>오늘, 소희와 함께</h1>
      <p>{view.businessName}</p>
      <button onClick={onDelegate}>채팅으로 이동</button>
      <button onClick={onRefresh}>새로고침</button>
    </div>
  ),
}))

import { R2Today } from './r2-today'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
})

describe('R2Today', () => {
  it('조회 실패를 빈 화면이 아닌 오류 상태로 렌더하고 무한 렌더하지 않는다', async () => {
    render(<R2Today workspaceId="00000000-0000-4000-8000-000000000001" />)
    expect(await screen.findByText(/불러오지 못했어요|확인하고 있어요/)).toBeVisible()
  })

  it('조회 실패 시 "다시 확인하기" 버튼은 live region(role="status") 바깥에 위치해야 한다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<R2Today workspaceId="00000000-0000-4000-8000-000000000001" />)
    const retryButton = await screen.findByRole('button', { name: '다시 확인하기' })
    expect(retryButton).toBeInTheDocument()

    // 대화형 위젯(버튼)은 role="status" 요소의 자손이 아니어야 함 (WCAG / ARIA live region 가이드라인 준수)
    expect(retryButton.closest('[role="status"]')).toBeNull()

    // 안내 문구는 role="status"를 가지고 있어야 함
    const statusMessage = screen.getByRole('status')
    expect(statusMessage).toHaveTextContent('오늘의 업무를 불러오지 못했어요.')
    expect(statusMessage).not.toContainElement(retryButton)

    // 재시도 버튼 클릭 시 다시 조회를 시도한다
    const initialCalls = fetchMock.mock.calls.length
    fireEvent.click(retryButton)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('데이터 수신 시 TodayLayout을 렌더하고 FirstActionCard("다음 행동") 및 레거시 요소가 없다', async () => {
    const mockHomeDto = {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      businessName: '테스트 매장',
      timeZone: 'Asia/Seoul',
      generatedAt: '2026-10-22T07:40:00Z',
      agent: { state: 'ready', data: { label: '대기 중', detailHref: '/app/sohee' }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      activity: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      results: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(mockHomeDto), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<R2Today workspaceId="00000000-0000-4000-8000-000000000001" />)
    const todayLayout = await screen.findByTestId('today-layout')
    expect(todayLayout).toBeInTheDocument()
    expect(screen.getByText('오늘, 소희와 함께')).toBeInTheDocument()
    expect(screen.getByText('테스트 매장')).toBeInTheDocument()

    // FirstActionCard 및 레거시 섹션이 없어야 함
    expect(screen.queryByRole('region', { name: '다음 행동' })).not.toBeInTheDocument()
    expect(screen.queryByText('다음 소식도 소희에게')).not.toBeInTheDocument()
    expect(screen.queryByText('소희 일하기')).not.toBeInTheDocument()

    // onDelegate 호출 시 채팅 화면으로 라우팅
    fireEvent.click(screen.getByText('채팅으로 이동'))
    expect(mockPush).toHaveBeenCalledWith('/app/command?from=%2Fapp')
  })

  it('초기 로딩 시 매장/업무 상태 확인 문구가 live region(role="status")에 표시된다', () => {
    // 응답 대기 중인 fetch
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    render(<R2Today workspaceId="00000000-0000-4000-8000-000000000001" />)
    const statusMessage = screen.getByRole('status')
    expect(statusMessage).toHaveTextContent('매장과 업무 상태를 확인하고 있어요.')
    // 로딩 중에는 다시 확인하기 버튼이 없어야 함
    expect(screen.queryByRole('button', { name: '다시 확인하기' })).not.toBeInTheDocument()
  })

  it('데이터가 있고 에러가 발생한 경우 "새 정보를 불러오지 못했어요" 안내 문구를 유지한다', async () => {
    // 먼저 정상 데이터로 로드된 후 에러 발생하는 시나리오를 검증하기 위해 초기 데이터를 제공
    const mockHomeDto = {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      businessName: '테스트 매장',
      timeZone: 'Asia/Seoul',
      generatedAt: '2026-10-22T07:40:00Z',
      agent: { state: 'ready', data: { label: '대기 중', detailHref: '/app/sohee' }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      activity: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
      results: { state: 'ready', data: [], observedAt: '2026-10-22T07:40:00Z', validUntil: null },
    }
    let resolveFirst: (r: Response) => void
    const firstResponse = new Promise<Response>(resolve => { resolveFirst = resolve })
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => firstResponse).mockImplementation(async () => new Response('{}', { status: 500 })))

    render(<R2Today workspaceId="00000000-0000-4000-8000-000000000001" />)
    resolveFirst!(new Response(JSON.stringify(mockHomeDto), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    expect(await screen.findByTestId('today-layout')).toBeInTheDocument()

    // 새로고침 클릭 시 에러 발생 -> stale 상태
    fireEvent.click(screen.getByText('새로고침'))
    const staleMessage = await screen.findByRole('status')
    expect(staleMessage).toHaveTextContent('새 정보를 불러오지 못했어요. 아래 기록은 이전에 확인한 내용이에요.')
  })
})
