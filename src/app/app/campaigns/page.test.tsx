import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { redirect } from 'next/navigation'

const workspaceMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: workspaceMock }))
vi.mock('./campaigns-entry', () => ({ CampaignsEntry: () => null }))

import CampaignsPage from './page'

describe('/app/campaigns 배선(ANI-887 북마크 보존 + ANI-1771 R2 플래그)', () => {
  beforeEach(() => { vi.mocked(redirect).mockClear(); workspaceMock.mockReset() })
  afterEach(() => vi.unstubAllEnvs())

  it('플래그 OFF(기본) 이면 기존처럼 /app/sohee?tab=campaigns 로 이동한다', async () => {
    workspaceMock.mockResolvedValue({ workspaceId: 'ws-a' })
    await CampaignsPage()
    expect(redirect).toHaveBeenCalledWith('/app/sohee?tab=campaigns')
  })

  it('플래그 ON 이어도 allowlist 밖 매장이면 이동한다(계정 경계)', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'ws-b')
    workspaceMock.mockResolvedValue({ workspaceId: 'ws-a' })
    await CampaignsPage()
    expect(redirect).toHaveBeenCalledWith('/app/sohee?tab=campaigns')
  })

  it('매장을 확인하지 못하면 플래그가 켜져 있어도 이동한다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'ws-a')
    workspaceMock.mockResolvedValue(null)
    await CampaignsPage()
    expect(redirect).toHaveBeenCalledWith('/app/sohee?tab=campaigns')
  })

  it('플래그 ON + allowlist 매장이면 이동하지 않고 R2 진입을 그린다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'ws-a')
    workspaceMock.mockResolvedValue({ workspaceId: 'ws-a' })
    const el = await CampaignsPage()
    expect(redirect).not.toHaveBeenCalled()
    expect(el?.props.workspaceId).toBe('ws-a')
  })
})
