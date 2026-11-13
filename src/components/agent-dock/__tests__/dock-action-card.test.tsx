import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DockActionCard } from '../dock-action-card'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: { missionId: '223e4567-e89b-42d3-a456-426614174000' } }) })
})

describe('Dock 액션 카드', () => {
  it('발행 요청은 콘텐츠 승인 화면으로만 연결하며 자동 발행하지 않는다', async () => {
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'open_content' }]} />)
    expect(screen.getByText(/발행은 콘텐츠 화면에서/)).toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '콘텐츠에서 확인하기' }))
    expect(push).toHaveBeenCalledWith('/app/content')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('버튼 클릭 후에만 주제로 초안을 만들고 미리보기 화면으로 이동한다', async () => {
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'create_post', topic: '주말 신메뉴 & 행사' }]} />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이 주제로 초안 만들기' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/content?post=223e4567-e89b-42d3-a456-426614174000'))
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/workspaces/ws-1/quick-post')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ topic: '주말 신메뉴 & 행사' })
  })

  it('빠른 중복 클릭에도 같은 초안을 한 번만 요청한다', async () => {
    let resolveRequest!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'create_post', topic: '신메뉴' }]} />)
    const button = screen.getByRole('button', { name: '이 주제로 초안 만들기' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/quick-post'))).toHaveLength(1)
    resolveRequest({ ok: true, json: async () => ({ item: { missionId: '223e4567-e89b-42d3-a456-426614174000' } }) } as Response)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/content?post=223e4567-e89b-42d3-a456-426614174000'))
  })

  it('채널 연결과 성과 확인은 직접 버튼을 누를 때 해당 화면으로 이동한다', () => {
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'connect_channel', channel: 'threads' }, { type: 'show_results' }]} />)
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '스레드 연결 화면 열기' }))
    expect(push).toHaveBeenCalledWith('/start?step=channels')
    fireEvent.click(screen.getByRole('button', { name: '성과 보러 가기' }))
    expect(push).toHaveBeenCalledWith('/app/results')
  })

  it('실패한 초안 생성은 화면을 이동하지 않고 다시 시도할 수 있게 알린다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: '채널을 연결해 주세요.' }) } as Response)
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'create_post', topic: '신메뉴' }]} />)
    fireEvent.click(screen.getByRole('button', { name: '이 주제로 초안 만들기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('채널을 연결해 주세요.'))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '이 주제로 초안 만들기' }).hasAttribute('disabled')).toBe(false)
  })

  it('서버에서 받은 위험/외부 경로 액션을 실행하지 않는다', () => {
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'publish' }, { type: 'navigate', path: '//evil.example' }]} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('register_reservation 액션 클릭 시 onOpenReservation 콜백을 실행한다', () => {
    const onOpen = vi.fn()
    render(
      <DockActionCard
        workspaceId="ws-1"
        actions={[
          {
            type: 'register_reservation',
            customerName: '이지은',
            customerPhone: '010-1111-2222',
            suggestedTime: '2026-10-25 15:00',
            serviceName: '속눈썹 펌',
          },
        ]}
        onOpenReservation={onOpen}
      />
    )

    const btn = screen.getByRole('button', { name: /이지은 고객 예약 등록하기/ })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)

    expect(onOpen).toHaveBeenCalledWith({
      customerName: '이지은',
      customerPhone: '010-1111-2222',
      suggestedTime: '2026-10-25 15:00',
      serviceName: '속눈썹 펌',
    })
  })

  it('pause_mission 액션 클릭 시 일시정지 API를 호출한다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'pause_mission', missionId: '223e4567-e89b-42d3-a456-426614174000' }]} />)
    const btn = screen.getByRole('button', { name: '작업 일시 정지하기' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/missions/223e4567-e89b-42d3-a456-426614174000/pause', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('propose_plan_diff 액션 클릭 시 미션 상세 페이지로 이동한다', () => {
    render(<DockActionCard workspaceId="ws-1" actions={[{ type: 'propose_plan_diff', missionId: '223e4567-e89b-42d3-a456-426614174000' }]} />)
    const btn = screen.getByRole('button', { name: '계획 변경안 검토하기' })
    fireEvent.click(btn)
    expect(push).toHaveBeenCalledWith('/app/missions/223e4567-e89b-42d3-a456-426614174000')
  })
})
