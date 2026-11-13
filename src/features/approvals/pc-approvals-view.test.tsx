import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PcApprovalsView } from './pc-approvals-view'

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
  useWorkspaceId: () => WS,
  useOptionalWorkspaceContext: () => null,
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

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
  reason: '내용 검토만 할 수 있어요.',
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const detail = {
    thread: { id: ITEM, workspaceId: WS, channel: 'instagram_dm', customerName: '고객 A', sendBlockers: [], draft: { text: approval.fullContent, sources: [] } },
    messages: [{ id: 'source', fromCustomer: true, text: approval.sourceText, at: '2026-10-24T00:00:00.000Z' }],
    complete: true,
    delivery: 'none',
    version: 1,
    fingerprint: 'a'.repeat(64),
    targetLabel: '인스타 DM → 고객 A',
  }
  const body = url.includes('/mobile-home') ? home : url.includes('/mobile-approvals/') ? approval : url.includes('/mobile-inbox/') ? detail : null
  if (!body) throw new Error(`unexpected ${url}`)
  return { ok: true, json: async () => body } as Response
})

beforeEach(() => {
  search = new URLSearchParams()
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockRouter.back.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('PcApprovalsView (MasterDetail for PC approvals)', () => {
  it('선택된 항목이 없을 때 왼쪽 목록과 오른쪽 빈 안내("왼쪽에서 하나를 골라 보세요.")를 렌더링한다', async () => {
    render(<PcApprovalsView />)

    expect(await screen.findByText('답장 검토')).toBeVisible()
    expect(screen.getByRole('region', { name: '승인 대기 목록' })).toBeVisible()
    expect(screen.getByRole('region', { name: '승인 작업 상세' })).toBeVisible()
    expect(screen.getByText('왼쪽에서 하나를 골라 보세요.')).toBeVisible()

    const itemLink = screen.getByRole('link', { name: /답장 검토/ })
    expect(itemLink).toHaveAttribute('href', `/app/approvals?item=${encodeURIComponent(ITEM)}`)
    expect(itemLink).not.toHaveAttribute('aria-current')
  })

  it('URL에 item 쿼리가 있으면 해당 항목에 aria-current="true"를 부여하고 오른쪽 상세를 렌더링한다', async () => {
    search = new URLSearchParams(`item=${encodeURIComponent(ITEM)}`)
    render(<PcApprovalsView />)

    const itemLink = await screen.findByRole('link', { name: /답장 검토/ })
    expect(itemLink).toBeVisible()
    expect(itemLink).toHaveAttribute('aria-current', 'true')

    expect(await screen.findByText('예약 문의 있어요')).toBeVisible()
    expect(await screen.findByLabelText('답안 내용')).toHaveValue(approval.fullContent)
    expect(screen.getByRole('button', { name: '이 답안 보내기' })).toBeEnabled()
  })

  it('확인할 작업이 0건이면 StateView 행동 버튼("오늘로 돌아가기")을 노출한다', async () => {
    const emptyHome = {
      ...home,
      decisions: {
        ...home.decisions,
        data: { items: [], total: 0, complete: true },
      },
    }
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => emptyHome }) as Response)

    render(<PcApprovalsView />)

    expect(await screen.findByText('확인할 작업이 없어요')).toBeVisible()
    expect(screen.getByRole('link', { name: '오늘로 돌아가기' })).toBeVisible()
  })

  it('content: stale 딥링크로 진입 시 목록의 comment 카드는 선택 표시되지 않고, 상세는 복구 링크(대기 중인 작업 확인하기)를 제공한다', async () => {
    const staleContentKey = 'content:2bf4bbe2-368d-4474-ae7e-792208e2b5fe'
    const commentItem = {
      id: 'comment:2bf4bbe2-368d-4474-ae7e-792208e2b5fe',
      kind: 'comment_reply',
      title: '고객 댓글 확인',
      targetLabel: '고객 댓글',
      createdAt: '2026-10-24T00:00:00.000Z',
      expiresAt: null,
    }
    const homeWithComment = {
      ...home,
      decisions: {
        ...home.decisions,
        data: { items: [commentItem], total: 1, complete: true },
      },
    }
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/mobile-home')) return { ok: true, json: async () => homeWithComment } as Response
      throw new Error(`unexpected fetch ${url}`)
    })

    search = new URLSearchParams(`item=${encodeURIComponent(staleContentKey)}`)
    render(<PcApprovalsView />)

    // 왼쪽 목록의 comment 카드는 content: 키와 불일치하므로 aria-current가 없음
    const commentCard = await screen.findByRole('link', { name: /고객 댓글 확인/ })
    expect(commentCard).toBeVisible()
    expect(commentCard).not.toHaveAttribute('aria-current')

    // 오른쪽 상세는 이전/비지원 작업 안내와 함께 목록의 실제 대기 작업으로 유도하는 복구 링크 제공
    expect(await screen.findByText(/이 작업을 확인할 수 없어요|이전 주소이거나 확인할 수 없는 작업이에요/)).toBeVisible()
    const recoveryLink = screen.getByRole('link', { name: '대기 중인 작업 확인하기' })
    expect(recoveryLink).toBeVisible()
    expect(recoveryLink).toHaveAttribute('href', `/app/approvals?item=${encodeURIComponent(commentItem.id)}`)
  })

  it('invalid content: 딥링크 상태에서 정상 comment: 항목으로 전환 시 error가 잔류하지 않고 정상 상세가 렌더링된다', async () => {
    const staleContentKey = 'content:2bf4bbe2-368d-4474-ae7e-792208e2b5fe'
    const commentKey = 'comment:2bf4bbe2-368d-4474-ae7e-792208e2b5fe'
    const commentItem = {
      id: commentKey,
      kind: 'comment_reply',
      title: '고객 댓글 확인',
      targetLabel: '고객 댓글',
      createdAt: '2026-10-24T00:00:00.000Z',
      expiresAt: null,
    }
    const homeWithComment = {
      ...home,
      decisions: {
        ...home.decisions,
        data: { items: [commentItem], total: 1, complete: true },
      },
    }
    const commentApproval = {
      workspaceId: WS,
      id: commentKey,
      kind: 'comment_reply',
      title: '고객 댓글 확인',
      targetLabel: '고객 댓글',
      sourceText: '인스타 예약 댓글 원문입니다',
      fullContent: '정성껏 모시겠습니다.',
      imageUrls: [],
      datasetMode: 'ACTUAL',
      writeState: 'unsupported',
      reason: '내용 검토 후 확정',
    }
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/mobile-home')) return { ok: true, json: async () => homeWithComment } as Response
      if (url.includes('/mobile-approvals/') && url.includes(encodeURIComponent(commentKey))) {
        return { ok: true, json: async () => commentApproval } as Response
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    search = new URLSearchParams(`item=${encodeURIComponent(staleContentKey)}`)
    const { rerender } = render(<PcApprovalsView />)

    // 1단계: stale content 링크 상태에서 에러 확인
    expect(await screen.findByText(/이 작업을 확인할 수 없어요|이전 주소이거나 확인할 수 없는 작업이에요/)).toBeVisible()

    // 2단계: 사용자가 정상 comment 항목으로 전환 (searchParams 변경 후 리렌더)
    search = new URLSearchParams(`item=${encodeURIComponent(commentKey)}`)
    rerender(<PcApprovalsView />)

    // key 재마운트 또는 state reset이 없으면 initial invalidKey의 error가 그대로 남아 정상 상세가 뜨지 않고 실패해야 함 (RED)
    expect(await screen.findByText('인스타 예약 댓글 원문입니다')).toBeVisible()
    expect(screen.queryByText(/이 작업을 확인할 수 없어요|이전 주소이거나 확인할 수 없는 작업이에요/)).toBeNull()
  })
})
