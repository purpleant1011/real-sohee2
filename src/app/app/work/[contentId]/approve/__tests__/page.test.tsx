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
const getApprovalPreview = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))
vi.mock('@/features/approvals/approval-preview-repository', () => ({
  getApprovalPreview: (...args: unknown[]) => getApprovalPreview(...args),
}))
vi.mock('../approve-entry', () => ({
  WorkApproveEntry: ({ contentId, role, snapshot }: { contentId: string; role: string; snapshot: unknown }) => (
    <div data-testid="work-approve-entry" data-content={contentId} data-role={role} data-has-snapshot={String(Boolean(snapshot))} />
  ),
}))

import WorkApprovePage from '../page'

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
  return WorkApprovePage({ params: Promise.resolve({ contentId: CONTENT_ID }) })
}

describe('/app/work/:id/approve 게이트 (ANI-1664 M07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      status: 'active',
    })
    getApprovalPreview.mockResolvedValue({ data: SNAPSHOT })
  })

  it('플래그 OFF 면 오늘처럼 작업 상세로 보낸다(조회도 하지 않는다)', async () => {
    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:/app/work/${CONTENT_ID}`)

    expect(nav.redirect).toHaveBeenCalledWith(`/app/work/${CONTENT_ID}`)
    expect(getApprovalPreview).not.toHaveBeenCalled()
  })

  it('allowlist 밖 매장도 작업 상세로 보낸다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:/app/work/${CONTENT_ID}`)

    expect(getApprovalPreview).not.toHaveBeenCalled()
  })

  it('플래그 ON + allowlist 매장이면 서버 스냅샷을 넘겨 승인 화면을 그린다', async () => {
    allowR2()

    render(await renderPage())

    expect(nav.redirect).not.toHaveBeenCalled()
    expect(getApprovalPreview).toHaveBeenCalledWith(WORKSPACE_ID, CONTENT_ID)
    const entry = screen.getByTestId('work-approve-entry')
    expect(entry).toHaveAttribute('data-content', CONTENT_ID)
    expect(entry).toHaveAttribute('data-role', 'owner')
    expect(entry).toHaveAttribute('data-has-snapshot', 'true')
  })

  it('매장이 없으면 온보딩으로 보낸다', async () => {
    allowR2()
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding')
  })

  it('스냅샷 조회가 실패하면 승인 화면을 열지 않는다(빈 승인으로 바꾸지 않는다)', async () => {
    allowR2()
    getApprovalPreview.mockResolvedValue({ error: { message: '게시 미리보기를 불러오지 못했어요.', requestId: 'approval-preview' } })

    render(await renderPage())

    expect(screen.getByTestId('work-approve-entry')).toHaveAttribute('data-has-snapshot', 'false')
  })
})
