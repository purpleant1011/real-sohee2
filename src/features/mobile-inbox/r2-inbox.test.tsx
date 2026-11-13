import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
import { R2Inbox } from './r2-inbox'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.unstubAllGlobals()
})

it('조회 실패를 새 문의 없음이 아닌 오류 상태로 렌더한다', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<R2Inbox workspaceId={WORKSPACE_ID} />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('새 문의가 없어요')).toBeNull()
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/workspaces/${WORKSPACE_ID}/mobile-inbox`,
    expect.objectContaining({ cache: 'no-store' }),
  )
})

it('로그인이 만료되면(401) 다시 로그인할 일로 안내한다 — 권한 없음과 구분한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '인증 세션이 필요합니다.' }), { status: 401 })))
  render(<R2Inbox workspaceId={WORKSPACE_ID} />)

  expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
  expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeVisible()
  expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  expect(screen.queryByText('새 문의가 없어요')).toBeNull()
})

it('권한이 없으면(403) 권한을 요청할 일로 안내한다 — 로그인 만료와 구분한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '권한이 없습니다.' }), { status: 403 })))
  render(<R2Inbox workspaceId={WORKSPACE_ID} />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeVisible()
  expect(screen.queryByText('로그인이 만료됐어요')).toBeNull()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  expect(screen.queryByText('새 문의가 없어요')).toBeNull()
})

it('응답 모양이 계약과 다르면 빈 목록이 아니라 오류 상태로 둔다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ threads: [] }), { status: 200 })))
  render(<R2Inbox workspaceId={WORKSPACE_ID} />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('새 문의가 없어요')).toBeNull()
})

it('서버가 확인한 목록은 그대로 보여 준다', async () => {
  const payload = {
    loadState: 'ready',
    workspaceId: WORKSPACE_ID,
    complete: true,
    checkedAt: '2026-10-23T01:00:00.000Z',
    threads: [
      {
        id: 't1',
        workspaceId: WORKSPACE_ID,
        channel: 'instagram_dm',
        customerName: '김민지',
        consent: 'granted',
        status: 'needs_reply',
        unread: true,
        lastMessage: { text: '예약 문의드려요', receivedAt: '2026-10-23T00:30:00.000Z', fromCustomer: true },
        draft: null,
        sendBlockers: [],
      },
    ],
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
  render(<R2Inbox workspaceId={WORKSPACE_ID} />)

  expect(await screen.findByText('김민지')).toBeVisible()
  expect(screen.getAllByText(/인스타 DM/).length).toBeGreaterThan(0)
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
})
