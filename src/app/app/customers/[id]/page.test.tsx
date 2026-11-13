import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'

const workspaceMock = vi.hoisted(() => vi.fn())
// 실제 next/navigation 의 redirect 는 던져서 렌더를 멈춘다. 목도 그렇게 행동해야 아래 코드가 관측된다.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
}))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: workspaceMock }))
vi.mock('./customer-detail-entry', () => ({ CustomerDetailEntry: () => null }))

import CustomerDetailPage from './page'

const WS = 'ws-a'
const params = Promise.resolve({ id: 'cust-1' })

/** 이동은 예외로 끝난다 — 경로까지 함께 고정한다. */
async function expectRedirect(path: string) {
  await expect(CustomerDetailPage({ params })).rejects.toThrow(`NEXT_REDIRECT:${path}`)
  expect(redirect).toHaveBeenCalledWith(path)
}

describe('/app/customers/:id 실라우트 — 플래그 OFF 는 기존 화면 그대로', () => {
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

  it('플래그 OFF(기본) 이면 새 상세를 그리지 않고 기존 목록으로 돌려보낸다', async () => {
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    await expectRedirect('/app/customers')
  })

  it('플래그 ON 이어도 allowlist 밖 매장이면 기존 목록으로 돌려보낸다(계정 경계)', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'ws-b')
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    await expectRedirect('/app/customers')
  })

  it("allowlist 의 '*' 는 전체 허용이 아니므로 기존 목록으로 돌려보낸다", async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', '*')
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    await expectRedirect('/app/customers')
  })

  it('플래그 ON + allowlist 매장이면 서버가 확정한 workspace 와 고객 id 로 R2 상세를 마운트한다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    workspaceMock.mockResolvedValue({ workspaceId: WS })

    const el = await CustomerDetailPage({ params })

    expect(redirect).not.toHaveBeenCalled()
    // workspaceId 는 URL 이 아니라 인증 문맥에서 온다 — 쿼리로 바꿔치기할 수 없다.
    expect(el?.props.children.props).toMatchObject({ workspaceId: WS, customerId: 'cust-1' })
  })
})
