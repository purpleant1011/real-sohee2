// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * ANI-1781 (M03): `/start` 를 R2 플래그 뒤로 옮긴 뒤의 계약.
 *
 * - 플래그 OFF(기본)          → 지금과 같은 StartWizard
 * - 플래그 ON + 넓은 화면      → StartWizard (PC 레이아웃 보존)
 * - 플래그 ON + 좁은 화면      → R2 가게 소개 화면
 * - allowlist 모드의 매장 없음 → StartWizard; 전체 공개는 폭에 따라 R2/기존 화면
 *
 * 플래그는 화면이 아니라 서버(page)가 계산해 내려준다. 브라우저 저장소·URL 은 권한이 아니다.
 */
const currentWorkspace = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: currentWorkspace }))
vi.mock('@/components/start/start-wizard', () => ({ StartWizard: () => <p>start-wizard</p> }))
vi.mock('@/features/media/media-upload-card', () => ({
  MediaUploadCard: () => <p>media-upload</p>,
}))

import StartPage from '../page'

const WS = '11111111-1111-4111-8111-111111111111'

function stubWidth(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

async function renderPage() {
  render(await StartPage({ searchParams: Promise.resolve({}) }))
}

beforeEach(() => {
  currentWorkspace.mockResolvedValue({ workspaceId: WS, role: 'owner', status: 'active' })
  // R2 화면의 조회는 이 테스트의 관심사가 아니다. 영원히 대기시킨다.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/start 온보딩 화면 게이트 (ANI-1781)', () => {
  it.each([true, false])('전체 공개는 매장 없는 신규 방문자도 모바일=%s에 맞는 화면을 보여준다', async mobile => {
    currentWorkspace.mockResolvedValue(null)
    stubWidth(mobile)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', 'all')
    await renderPage()
    if (mobile) {
      expect(await screen.findByRole('heading', { name: '가게 소개' })).toBeTruthy()
      expect(screen.queryByText('start-wizard')).toBeNull()
    } else {
      expect(await screen.findByText('start-wizard')).toBeTruthy()
    }
  })
  it('플래그가 없으면(기본 OFF) 좁은 화면에서도 StartWizard 를 쓴다', async () => {
    stubWidth(true)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '')
    await renderPage()
    expect(await screen.findByText('start-wizard')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '가게 소개' })).toBeNull()
  })

  it('플래그 ON 이어도 allowlist 에 없는 매장은 StartWizard 를 쓴다', async () => {
    stubWidth(true)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'some-other-workspace')
    await renderPage()
    expect(await screen.findByText('start-wizard')).toBeTruthy()
  })

  it('allowlist 에 "*" 만 있으면 전체 허용이 아니다', async () => {
    stubWidth(true)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', '*')
    await renderPage()
    expect(await screen.findByText('start-wizard')).toBeTruthy()
  })

  it('플래그 ON + 넓은 화면이면 StartWizard 를 쓴다', async () => {
    stubWidth(false)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    await renderPage()
    expect(await screen.findByText('start-wizard')).toBeTruthy()
  })

  it('플래그 ON + 좁은 화면이면 R2 가게 소개 화면을 보여준다', async () => {
    stubWidth(true)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    await renderPage()
    expect(await screen.findByRole('heading', { name: '가게 소개' })).toBeTruthy()
    expect(screen.queryByText('start-wizard')).toBeNull()
  })

  it('로그인 전(workspace 없음)에는 StartWizard 를 쓴다', async () => {
    currentWorkspace.mockResolvedValue(null)
    stubWidth(true)
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WS)
    await renderPage()
    expect(await screen.findByText('start-wizard')).toBeTruthy()
  })
})
