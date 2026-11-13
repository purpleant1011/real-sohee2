import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { rememberDecisionReturn, takeDecisionRestore } from '@/features/mobile-decision/decision-return'
import { ApprovalsEntry } from './approvals-entry'

const WS = '11111111-1111-4111-8111-111111111111'
const ITEM = 'dm:22222222-2222-4222-8222-222222222222'

let search = new URLSearchParams()
const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/approvals',
  useSearchParams: () => search,
  useRouter: () => mockRouter,
}))
vi.mock('@/hooks/use-workspace-context', () => ({
  // 모듈 팩토리는 import 시점에 돌므로 바깥 상수를 참조하지 않는다.
  useWorkspaceId: () => '11111111-1111-4111-8111-111111111111',
  useOptionalWorkspaceContext: () => null,
}))
vi.mock('@/features/mobile-decision/mobile-approval-page', () => ({ MobileApprovalPage: () => <p>legacy-approvals</p> }))

const home = {
  workspaceId: WS,
  businessName: '바이름',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-10-24T00:00:00.000Z',
  agent: { state: 'ready', data: { label: '소희', detailHref: '/app/command' }, observedAt: '2026-10-24T00:00:00.000Z', validUntil: null },
  decisions: {
    state: 'ready',
    data: { items: [{ id: ITEM, kind: 'dm_reply', title: '답장 검토', targetLabel: '고객 A', createdAt: '2026-10-24T00:00:00.000Z', expiresAt: null }], total: 1, complete: true },
    observedAt: '2026-10-24T00:00:00.000Z',
    validUntil: null,
  },
  activity: { state: 'ready', data: [], observedAt: '2026-10-24T00:00:00.000Z', validUntil: null },
  results: { state: 'ready', data: [], observedAt: '2026-10-24T00:00:00.000Z', validUntil: null },
}

const approval = {
  workspaceId: WS,
  id: ITEM,
  kind: 'dm_reply',
  title: '답장 검토',
  targetLabel: '고객 A',
  sourceText: '예약 문의 있어요',
  fullContent: '네, 안녕하세요. 가능한 시간을 알려드릴게요.',
  imageUrls: [],
  datasetMode: 'ACTUAL',
  writeState: 'unsupported',
  reason: '내용 검토만 할 수 있어요. 실행은 최종 검토 화면에서 확인해 주세요.',
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const detail = { thread: { id: ITEM, workspaceId: WS, channel: 'instagram_dm', customerName: '고객 A', sendBlockers: [], draft: { text: approval.fullContent, sources: [] } }, messages: [{ id: 'source', fromCustomer: true, text: approval.sourceText, at: '2026-10-24T00:00:00.000Z' }], complete: true, delivery: 'none', version: 1, fingerprint: 'a'.repeat(64), targetLabel: '인스타 DM → 고객 A' }
  const body = url.includes('/mobile-home') ? home : url.includes('/mobile-approvals/') ? approval : url.includes('/mobile-inbox/') ? detail : null
  if (!body) throw new Error(`unexpected ${url}`)
  return { ok: true, json: async () => body } as Response
})

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean) {
  const tree = <ApprovalsEntry />
  return render(r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree)
}

beforeEach(() => {
  search = new URLSearchParams()
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('/app/approvals 배선(ANI-1770)', () => {
  it('플래그 OFF(기본) 이면 PC MasterDetail 승인 화면이 렌더링된다', async () => {
    narrow(true)
    renderEntry(false)
    expect(await screen.findByRole('region', { name: '승인 대기 목록' })).toBeVisible()
    expect(screen.getByRole('region', { name: '승인 작업 상세' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })

  it('플래그 ON 이어도 넓은 화면이면 PC MasterDetail 화면이 렌더링된다', async () => {
    narrow(false)
    renderEntry(true)
    expect(await screen.findByRole('region', { name: '승인 대기 목록' })).toBeVisible()
    expect(screen.getByRole('region', { name: '승인 작업 상세' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })

  it('플래그 ON + 좁은 화면이면 R2 목록에 서버가 준 확인 항목만 보인다', async () => {
    narrow(true)
    renderEntry(true)
    expect(await screen.findByText('답장 검토')).toBeVisible()
    expect(screen.getByRole('heading', { name: '확인할 작업' })).toBeVisible()
    // 목록은 5탭을 유지한다(탭을 숨기는 건 상세부터).
    expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' })).toBeVisible()
    expect(screen.queryByText('legacy-approvals')).toBeNull()
  })

  it('목록 조회가 실패하면 확인할 일이 없다고 말하지 않는다', async () => {
    narrow(true)
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }) as Response)
    renderEntry(true)
    expect(await screen.findByText('작업 목록을 불러오지 못했어요.')).toBeVisible()
    expect(screen.queryByText('지금 확인하실 일은 없어요')).toBeNull()
  })

  it('상세는 서버 원문·저장 답안을 보여주고 최종 전송 확인으로 연결한다', async () => {
    narrow(true)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    renderEntry(true)
    expect(await screen.findByText('예약 문의 있어요')).toBeVisible()
    expect(await screen.findByLabelText('답안 내용')).toHaveValue(approval.fullContent)
    expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '승인하고 전송' })).toBeNull()
    expect(screen.queryByText('실행 준비 확인 필요')).toBeNull()
  })

  it('ACTUAL 게시 상세는 잠긴 셸 CTA 대신 저장 초안 편집으로 연결한다', async () => {
    narrow(true)
    const postItem = 'post:22222222-2222-4222-8222-222222222222'
    search = new URLSearchParams(`item=${encodeURIComponent(postItem)}`)
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ...approval, id: postItem, kind: 'post_publish' }) }) as Response)
    renderEntry(true)
    expect(await screen.findByRole('button', { name: '게시물 수정·최종 승인' })).toBeEnabled()
    expect(screen.queryByText('실행 준비 확인 필요')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })

  it('상세에서도 5탭은 보이지 않는다', async () => {
    narrow(true)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    renderEntry(true)
    await screen.findByText('예약 문의 있어요')
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })

  it('R2 상세에서 ShellHeader의 h1 외에 본문 제목은 h2로 렌더링되어 h1이 중복되지 않는다', async () => {
    narrow(true)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    renderEntry(true)
    await screen.findByText('예약 문의 있어요')

    const level1Headings = screen.getAllByRole('heading', { level: 1 })
    expect(level1Headings).toHaveLength(1)
    expect(level1Headings[0]).toHaveTextContent('승인 확인')

    const titleHeading = screen.getByRole('heading', { name: approval.title, level: 2 })
    expect(titleHeading).toBeVisible()
  })

  it('플래그 OFF 이면 R2 모바일 목록을 그리지 않는다', () => {
    narrow(true)
    renderEntry(false)
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })

  it('R2 상세에서 뒤로 클릭 시 기억된 오늘 경로가 있으면 consumeDecisionReturn을 거쳐 복귀한다', async () => {
    narrow(true)
    rememberDecisionReturn(WS, ITEM, '/app?filter=waiting', 140)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    // 히스토리 항목이 1개 초과인 경우 router.back()
    window.history.pushState({ page: 1 }, '', '/app')
    window.history.pushState({ page: 2 }, '', `/app/approvals?item=${encodeURIComponent(ITEM)}`)
    renderEntry(true)
    await screen.findByText('예약 문의 있어요')

    const backButton = screen.getByLabelText('뒤로')
    fireEvent.click(backButton)

    // 복귀 대상이 소비되어 takeDecisionRestore가 스크롤과 아이템 ID를 꺼낼 수 있어야 한다.
    expect(takeDecisionRestore(WS, '/app?filter=waiting')).toMatchObject({
      workspaceId: WS,
      itemId: ITEM,
      href: '/app?filter=waiting',
      scrollY: 140,
    })
    expect(mockRouter.back).toHaveBeenCalled()
  })

  it('R2 상세에서 히스토리 스택이 단일 항목이어도 기억된 복귀 경로로 replace 이동한다', async () => {
    narrow(true)
    rememberDecisionReturn(WS, ITEM, '/app?filter=waiting', 80)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    // jsdom 초기 history.length = 1을 흉내내기 위해 history.length를 1로 모킹
    const originalHistory = window.history
    const historySpy = vi.spyOn(window, 'history', 'get').mockReturnValue({ ...originalHistory, length: 1 })
    renderEntry(true)
    await screen.findByText('예약 문의 있어요')

    const backButton = screen.getByLabelText('뒤로')
    fireEvent.click(backButton)

    expect(takeDecisionRestore(WS, '/app?filter=waiting')).toMatchObject({
      workspaceId: WS,
      itemId: ITEM,
      href: '/app?filter=waiting',
      scrollY: 80,
    })
    expect(mockRouter.replace).toHaveBeenCalledWith('/app?filter=waiting')
    historySpy.mockRestore()
  })

  it('R2 상세에서 뒤로 클릭 시 기억된 복귀 경로가 없으면 fallback 경로 /app/approvals로 이동한다', async () => {
    narrow(true)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    renderEntry(true)
    await screen.findByText('예약 문의 있어요')

    const backButton = screen.getByLabelText('뒤로')
    fireEvent.click(backButton)

    expect(takeDecisionRestore(WS, '/app?filter=waiting')).toBeNull()
    expect(mockRouter.replace).toHaveBeenCalledWith('/app/approvals')
  })

  it('R2 상세에서 동일 오리진 referrer가 있어도 history.length <= 1이면 router.back 대신 router.replace(/app/approvals)로 이동한다', async () => {
    narrow(true)
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    const originalHistory = window.history
    const historySpy = vi.spyOn(window, 'history', 'get').mockReturnValue({ ...originalHistory, length: 1 })
    const originalReferrer = document.referrer
    Object.defineProperty(document, 'referrer', { value: `${window.location.origin}/app`, configurable: true })

    renderEntry(true)
    await screen.findByText('예약 문의 있어요')

    const backButton = screen.getByLabelText('뒤로')
    fireEvent.click(backButton)

    expect(mockRouter.back).not.toHaveBeenCalled()
    expect(mockRouter.replace).toHaveBeenCalledWith('/app/approvals')

    historySpy.mockRestore()
    Object.defineProperty(document, 'referrer', { value: originalReferrer, configurable: true })
  })
})
