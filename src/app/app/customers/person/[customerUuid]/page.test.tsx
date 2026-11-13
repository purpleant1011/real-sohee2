import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'

const workspaceMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: workspaceMock,
}))
vi.mock('./canonical-customer-detail-entry', () => ({
  CanonicalCustomerDetailEntry: () => null,
}))

import CanonicalCustomerDetailPage from './page'

const WS = 'ws-a'
const params = Promise.resolve({ customerUuid: 'c-uuid-1' })

async function expectRedirect(path: string) {
  await expect(CanonicalCustomerDetailPage({ params })).rejects.toThrow(`NEXT_REDIRECT:${path}`)
  expect(redirect).toHaveBeenCalledWith(path)
}

describe('/app/customers/person/:customerUuid 라우트', () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear()
    workspaceMock.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('워크스페이스를 확인하지 못하면 온보딩으로 보낸다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    workspaceMock.mockResolvedValue(null)

    await expectRedirect('/app/onboarding')
  })

  it('플래그 OFF(기본) 이면 기존 목록으로 돌려보낸다', async () => {
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    await expectRedirect('/app/customers')
  })

  it('플래그 ON + allowlist 매장이면 R2 정본 고객 상세를 마운트한다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    const el = await CanonicalCustomerDetailPage({ params })

    expect(redirect).not.toHaveBeenCalled()
    expect(el?.props.children.props).toMatchObject({
      workspaceId: WS,
      customerUuid: 'c-uuid-1',
    })
  })
})
