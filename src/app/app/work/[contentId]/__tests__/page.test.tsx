import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/** Next.js 의 redirect 는 던져서 렌더를 중단한다. 목이 조용히 돌려주면 가짜 통과가 난다. */
const nav = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('next/navigation', () => nav)

const getCurrentWorkspaceContext = vi.hoisted(() => vi.fn())
const getContentDetail = vi.hoisted(() => vi.fn())
const getSocialPerformanceReport = vi.hoisted(() => vi.fn())
const getApprovalPreview = vi.hoisted(() => vi.fn())
const getLatestPublishedDestinationUrl = vi.hoisted(() => vi.fn())

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))
vi.mock('@/features/content/repository', () => ({
  getContentDetail: (...args: unknown[]) => getContentDetail(...args),
}))
vi.mock('@/features/reports/repository', () => ({
  getSocialPerformanceReport: (...args: unknown[]) => getSocialPerformanceReport(...args),
}))
vi.mock('@/features/approvals/approval-preview-repository', () => ({
  getApprovalPreview: (...args: unknown[]) => getApprovalPreview(...args),
}))
vi.mock('@/features/publishing/latest-destination', () => ({
  getLatestPublishedDestinationUrl: (...args: unknown[]) => getLatestPublishedDestinationUrl(...args),
}))
vi.mock('@/features/content/work-detail', () => ({
  WorkDetail: ({ workspaceId, role, fallbackPermalink }: { workspaceId: string; role: string; fallbackPermalink?: string | null }) => (
    <div data-testid="legacy-work-detail" data-workspace={workspaceId} data-role={role} data-permalink={fallbackPermalink ?? ''} />
  ),
}))
vi.mock('../work-preview-entry', () => ({
  WorkPreviewEntry: ({ snapshot, children }: { snapshot: unknown; children: React.ReactNode }) => (
    <div data-testid="work-preview-entry" data-has-snapshot={String(Boolean(snapshot))}>
      {children}
    </div>
  ),
}))

vi.mock('../work-studio-entry', () => ({
  WorkStudioEntry: ({ children }: { children: React.ReactNode }) => <div data-testid="work-studio-entry">{children}</div>,
}))
vi.mock('@/features/mobile-work/work-studio-data', () => ({
  loadWorkStudioContext: async () => ({ thread: null, messages: [], livePost: null, historyError: false }),
}))

import WorkDetailPage from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = 'c1'

const SNAPSHOT = {
  workspaceId: WORKSPACE_ID,
  contentId: CONTENT_ID,
  versionId: 'v1',
  versionNumber: 3,
  fingerprint: 'a'.repeat(64),
  approval: { id: null, status: 'unreviewed' as const, fingerprint: null },
  channel: 'instagram' as const,
  account: { connectionId: 'conn-1', label: '@sohee', status: 'connected' as const },
  caption: '본문',
  hashtags: [],
  disclosure: '',
  text: '본문',
  media: [],
  issues: [],
}

function allowR2() {
  vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
  vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WORKSPACE_ID)
}

function renderPage() {
  return WorkDetailPage({ params: Promise.resolve({ contentId: CONTENT_ID }) })
}

describe('/app/work/:id M06 진입 게이트 (ANI-1678)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: WORKSPACE_ID, role: 'owner', status: 'active' })
    getContentDetail.mockResolvedValue({ data: { id: CONTENT_ID } })
    getSocialPerformanceReport.mockResolvedValue({ data: null })
    getApprovalPreview.mockResolvedValue({ data: SNAPSHOT })
  })

  it('플래그 OFF 면 오늘의 작업 상세를 그대로 그린다(진입점 없음)', async () => {
    render(await renderPage())

    expect(screen.queryByTestId('work-preview-entry')).toBeNull()
    expect(screen.getByTestId('legacy-work-detail')).toHaveAttribute('data-workspace', WORKSPACE_ID)
    expect(nav.redirect).not.toHaveBeenCalled()
  })

  it('allowlist 밖 매장도 같은 상세 화면이다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')

    render(await renderPage())

    expect(screen.queryByTestId('work-preview-entry')).toBeNull()
    expect(screen.getByTestId('legacy-work-detail')).toBeTruthy()
  })

  it('플래그 ON + allowlist 매장이면 기존 상세를 children 으로 넘긴다(넓은 화면·미지원 채널 복귀)', async () => {
    allowR2()

    render(await renderPage())

    const entry = screen.getByTestId('work-preview-entry')
    expect(entry).toHaveAttribute('data-has-snapshot', 'true')
    // children 이 실제로 남아 있어야 플래그만 켠 넓은 화면에서 기존 화면이 보인다.
    expect(screen.getByTestId('legacy-work-detail')).toHaveAttribute('data-role', 'owner')
    expect(getApprovalPreview).toHaveBeenCalledWith(WORKSPACE_ID, CONTENT_ID)
  })

  it('스냅샷 조회가 실패하면 null 로 넘겨 R2 화면이 오류를 말하게 한다', async () => {
    allowR2()
    getApprovalPreview.mockResolvedValue({ error: { message: '불러오지 못했어요.', requestId: 'approval-preview' } })

    render(await renderPage())

    expect(screen.getByTestId('work-preview-entry')).toHaveAttribute('data-has-snapshot', 'false')
    expect(screen.getByTestId('legacy-work-detail')).toBeTruthy()
  })

  it('매장이 없으면 온보딩으로 보낸다', async () => {
    allowR2()
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding')
  })

  it('없는 콘텐츠는 404 다', async () => {
    allowR2()
    getContentDetail.mockResolvedValue({ error: { message: '없음', requestId: 'content-not-found' } })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(nav.notFound).toHaveBeenCalled()
  })

  it('조회 실패는 원고 없음으로 바꾸지 않고 목록 복귀와 재시도를 제공한다', async () => {
    allowR2()
    getContentDetail.mockResolvedValue({ error: { message: '실패', requestId: 'db' } })

    render(await renderPage())
    expect(screen.getByRole('alert')).toHaveTextContent('작업을 불러오지 못했어요')
    expect(screen.getByRole('link', { name: '작업 목록으로 돌아가기' })).toHaveAttribute('href', '/app/content')
    expect(screen.getByRole('link', { name: '다시 확인하기' })).toHaveAttribute('href', '/app/work/c1')
    expect(screen.queryByTestId('legacy-work-detail')).toBeNull()
  })

  it('소셜 리포트에 destinationUrl이 없으면 getLatestPublishedDestinationUrl을 호출해 전달한다', async () => {
    getSocialPerformanceReport.mockResolvedValue({ data: { posts: [] } })
    getLatestPublishedDestinationUrl.mockResolvedValue('https://www.instagram.com/p/LATEST_URL/')

    render(await renderPage())

    expect(getLatestPublishedDestinationUrl).toHaveBeenCalledWith(WORKSPACE_ID, CONTENT_ID)
    expect(screen.getByTestId('legacy-work-detail')).toHaveAttribute('data-permalink', 'https://www.instagram.com/p/LATEST_URL/')
  })

  it('소셜 리포트에 이미 https destinationUrl이 있으면 추가 조회 없이 기존 URL을 사용한다', async () => {
    getSocialPerformanceReport.mockResolvedValue({
      data: {
        posts: [{ destinationUrl: 'https://www.instagram.com/p/EXISTING/' }],
      },
    })

    render(await renderPage())

    expect(getLatestPublishedDestinationUrl).not.toHaveBeenCalled()
    expect(screen.getByTestId('legacy-work-detail')).toHaveAttribute('data-permalink', 'https://www.instagram.com/p/EXISTING/')
  })
})
