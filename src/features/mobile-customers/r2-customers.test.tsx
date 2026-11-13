// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/customers',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

import { R2Customers } from './r2-customers'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'

function stubStatus(status: number) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: '요청을 처리하지 못했습니다.' }), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('R2 고객 화면 배선 — 인증 만료와 권한 없음 분리 (ANI-1714)', () => {
  it('로그인이 만료되면(401) 다시 로그인할 일로 안내한다', async () => {
    const fetchMock = stubStatus(401)
    render(<R2Customers workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
    expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeVisible()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
    // 고객이 없는 것도, 일시적 조회 실패도 아니다.
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WORKSPACE_ID}/mobile-customers`,
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('권한이 없으면(403) 권한을 요청할 일로 안내한다 — 만료와 구분한다', async () => {
    stubStatus(403)
    render(<R2Customers workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeVisible()
    expect(screen.queryByText('로그인이 만료됐어요')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
  })

  it('500 은 인증·권한 문제가 아니므로 지금처럼 조회 실패로 남긴다', async () => {
    stubStatus(500)
    render(<R2Customers workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText('로그인이 만료됐어요')).toBeNull()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  })
})
