import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/engagement/dm:1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))
import { R2ConversationDetail, isConversationDetail } from './r2-conversation-detail'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const THREAD_KEY = 'dm:11111111-1111-4111-8111-111111111111'
const URL = `/api/workspaces/${WORKSPACE_ID}/mobile-inbox/${encodeURIComponent(THREAD_KEY)}`

function payload(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: THREAD_KEY,
      workspaceId: WORKSPACE_ID,
      channel: 'instagram_dm',
      customerName: '김민지',
      consent: 'granted',
      status: 'draft_ready',
      unread: true,
      lastMessage: { text: '예약 문의드려요', receivedAt: '2026-10-23T00:30:00.000Z', fromCustomer: true },
      draft: { text: '목요일 2시 가능해요.', sources: ['예약표'] },
      sendBlockers: [],
    },
    messages: [{ id: 'm1', fromCustomer: true, text: '예약 되나요', at: '2026-10-23T00:30:00.000Z' }],
    targetLabel: '인스타그램 DM → 김민지',
    fingerprint: 'a'.repeat(64),
    version: 3,
    delivery: 'none',
    complete: true,
    ...overrides,
  }
}

function respond(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  nav.push.mockClear()
})

it('PC 호스트에서는 모바일 고정 셸 없이 같은 대화 원장과 승인 게이트를 사용한다', async () => {
  respond(payload())
  const { container } = render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} embedded />)
  expect(await screen.findByText('김민지')).toBeVisible()
  expect(container.querySelector('[data-mobile-shell]')).toBeNull()
  expect(container.querySelector('.m-sticky-bar')).toBeNull()
  expect(screen.getByRole('button', { name: '최종 검토로 넘어가기' })).toBeEnabled()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

it('상세는 캐시 없이 기존 읽기 API 한 곳만 조회한다', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('김민지')).toBeVisible()
  expect(fetchMock).toHaveBeenCalledWith(URL, expect.objectContaining({ cache: 'no-store' }))
})

it('원문·답안·참고 정보는 보여주고 지문은 노출하지 않는다', async () => {
  respond(payload())
  const { container } = render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('예약 되나요')).toBeVisible()
  expect(screen.getByText('목요일 2시 가능해요.', { selector: 'p' })).toBeVisible()
  expect(screen.getByText('참고: 예약표')).toBeVisible()
  expect(container.textContent).not.toContain('a'.repeat(64))
})

it('최종 검토 CTA 는 M19 승인 확인으로 이동하고 여기서 전송하지 않는다', async () => {
  respond(payload())
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  const cta = (await screen.findByRole('button', { name: '최종 검토로 넘어가기' })) as HTMLButtonElement
  expect(cta.disabled).toBe(false)
  fireEvent.click(cta)
  expect(nav.push).toHaveBeenCalledWith(`/app/approvals?item=${encodeURIComponent(THREAD_KEY)}`)
  expect(nav.push).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: /보내기/ })).toBeNull()
})

it('서버 게이트가 막힌 답장은 검토로 넘기지 않는다', async () => {
  respond(payload({ thread: { ...payload().thread, sendBlockers: ['NO_SEND_SCOPE'] } }))
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  const cta = (await screen.findByRole('button', { name: '최종 검토로 넘어가기' })) as HTMLButtonElement
  expect(cta.disabled).toBe(true)
  fireEvent.click(cta)
  expect(nav.push).not.toHaveBeenCalled()
})

it('원문 일부만 읽힌 응답은 부분 상태로 알린다', async () => {
  respond(payload({ complete: false }))
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText(/일부 원문만 불러왔어요/)).toBeVisible()
  expect(screen.getByText('예약 되나요')).toBeVisible()
})

it('조회 실패를 대화 없음으로 바꾸지 않는다', async () => {
  respond({ error: 'error' }, 503)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('대화를 찾지 못했어요')).toBeNull()
})

it('계약과 다른 응답(다른 가게·다른 스레드)은 실패로 둔다', async () => {
  respond(payload({ thread: { ...payload().thread, workspaceId: 'other-workspace' } }))
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
})

it('404 는 서버가 판정한 "볼 수 없는 대화"로 표시한다', async () => {
  respond({ error: 'not_found' }, 404)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('대화를 찾지 못했어요')).toBeVisible()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
})

it('원문이 0건이면 빈 목록이 아니라 "확인된 원문 없음"으로 알린다', async () => {
  respond(payload({ messages: [] }))
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText(/아직 확인된 원문이 없어요/)).toBeVisible()
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
})

it('권한이 없으면(403) 권한 안내로 둔다', async () => {
  respond({ error: 'forbidden' }, 403)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
})

it('로그인이 만료되면(401) 권한 없음이 아니라 다시 로그인할 일로 알린다', async () => {
  respond({ error: 'auth_required' }, 401)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
  expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeVisible()
  expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
})

it('네트워크가 끊긴 실패는 확인 실패가 아니라 오프라인으로 알린다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('network down')
    }),
  )
  vi.stubGlobal('navigator', { onLine: false })
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('네트워크에 연결할 수 없습니다')).toBeVisible()
  expect(screen.getByRole('button', { name: '다시 확인하기' })).toBeVisible()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
})

it('연결이 살아 있는 조회 실패는 오프라인이 아니라 조회 실패로 둔다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('network down')
    }),
  )
  vi.stubGlobal('navigator', { onLine: true })
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('네트워크에 연결할 수 없습니다')).toBeNull()
})

it('계약 검사는 스레드 키·workspace·delivery 를 확인한다', () => {
  expect(isConversationDetail(payload(), WORKSPACE_ID, THREAD_KEY)).toBe(true)
  expect(isConversationDetail(payload(), WORKSPACE_ID, 'comment:11111111-1111-4111-8111-111111111111')).toBe(false)
  expect(isConversationDetail(payload({ delivery: 'sent' }), WORKSPACE_ID, THREAD_KEY)).toBe(false)
  expect(isConversationDetail({ thread: null }, WORKSPACE_ID, THREAD_KEY)).toBe(false)
})

it('절단 여부(complete)가 없는 응답은 완전한 대화로 그리지 않는다', () => {
  const withoutComplete: Record<string, unknown> = { ...payload() }
  delete withoutComplete.complete
  expect(isConversationDetail(withoutComplete, WORKSPACE_ID, THREAD_KEY)).toBe(false)
  expect(isConversationDetail(payload({ complete: 'true' }), WORKSPACE_ID, THREAD_KEY)).toBe(false)
})

it('예약 회수 쓰기가 꺼져 있으면 설명과 비활성 버튼을 표시하고 POST하지 않는다', async () => {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async url => url.endsWith('/booking-recovery/cases')
    ? Response.json({ workspaceId: WORKSPACE_ID, cases: [], openAllowed: false })
    : Response.json(payload({ messages: [{ id: '44444444-4444-4444-8444-444444444444', fromCustomer: true, text: '예약 문의', at: '2026-10-25T00:00:00Z' }] })))
  vi.stubGlobal('fetch', fetcher)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)
  expect(await screen.findByText(/새 예약 문의를 여는 기능이 비활성화/)).toBeVisible()
  expect(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' })).toBeDisabled()
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it('예약 연결 GET이 503이면 화면에서 GET만 재시도해 복구하고 POST하지 않는다', async () => {
  let reads = 0
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/booking-recovery/cases')) {
      if (++reads === 1) return Response.json({ error: 'temporary' }, { status: 503 })
      return Response.json({ workspaceId: WORKSPACE_ID, cases: [], openAllowed: true })
    }
    return Response.json(payload({ messages: [{ id: '44444444-4444-4444-8444-444444444444', fromCustomer: true, text: '예약 문의', at: '2026-10-25T00:00:00Z' }] }))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)
  await screen.findByText(/예약 관리 권한이나 연결을 확인하지 못했어요/)
  fireEvent.click(screen.getByRole('button', { name: '예약 관리 연결 다시 확인' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' })).toBeEnabled())
  expect(reads).toBe(2)
  expect(fetcher.mock.calls.filter(([url]) => url === URL)).toHaveLength(1)
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it('기존 문의가 있으면 쓰기 기능이 꺼져 있어도 GET 재확인만으로 열고 POST하지 않는다', async () => {
  const caseId = '33333333-3333-4333-8333-333333333333'
  const messageId = '44444444-4444-4444-8444-444444444444'
  const saved = { caseId, sourceThreadId: THREAD_KEY.slice(3), sourceInboundMessageId: messageId }
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ error: 'write disabled' }, { status: 403 })
    if (url.endsWith('/booking-recovery/cases')) return Response.json({ workspaceId: WORKSPACE_ID, cases: [saved], openAllowed: false })
    if (url.endsWith(`/booking-recovery/cases/${caseId}`)) return Response.json({ case: saved })
    return Response.json(payload({ messages: [{ id: messageId, fromCustomer: true, text: '예약 문의', at: '2026-10-25T00:00:00Z' }] }))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' }))
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/app/inbox/${caseId}`))
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

it.each([false, true])('예약 케이스 readback 대상 불일치=%s이면 잘못된 예약 상세로 이동하지 않는다', async wrong => {
  const caseId = '33333333-3333-4333-8333-333333333333'
  const messageId = '44444444-4444-4444-8444-444444444444'
  const fetcher = vi.fn(async (input, init) => {
    const path = String(input)
    if (path.endsWith('/booking-recovery/cases') && init?.method !== 'POST') return Response.json({ workspaceId: WORKSPACE_ID, cases: [], openAllowed: true })
    if (init?.method === 'POST') return Response.json({ case: { caseId } })
    if (path.includes('/booking-recovery/cases/')) return Response.json({ case: { caseId, sourceThreadId: wrong ? 'foreign' : THREAD_KEY.slice(3) } })
    return Response.json(payload({ messages: [{ id: messageId, fromCustomer: true, text: '예약 문의', at: '2026-10-25T00:00:00Z' }] }))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<R2ConversationDetail workspaceId={WORKSPACE_ID} threadKey={THREAD_KEY} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '이 문의의 예약 관리 열기' }))
  if (wrong) { await screen.findByText('예약 문의 저장본을 확인하지 못했어요.'); expect(nav.push).not.toHaveBeenCalled() }
  else await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/app/inbox/${caseId}`))
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})
