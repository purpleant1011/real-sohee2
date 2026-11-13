import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/** Next.js 의 redirect/notFound 는 던져서 렌더를 중단한다(offline 게이트 테스트와 같은 목). */
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

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('../approval-detail-entry', () => ({
  ApprovalDetailEntry: ({ item, workspaceId }: { item: string; workspaceId: string }) => (
    <div data-testid="approval-detail-entry" data-item={item} data-workspace={workspaceId} />
  ),
}))

import ApprovalDetailPage from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const ITEM = 'a1'

function allowR2() {
  vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
  vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WORKSPACE_ID)
}

function renderPage() {
  return ApprovalDetailPage({ params: Promise.resolve({ id: ITEM }) })
}

describe('/app/approvals/:id 게이트 (ANI-1664)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      status: 'active',
    })
  })

  it('플래그 OFF 면 오늘과 같이 기존 상세 URL 로 보낸다', async () => {
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/app/approvals?item=a1')

    expect(nav.redirect).toHaveBeenCalledWith('/app/approvals?item=a1')
    expect(nav.notFound).not.toHaveBeenCalled()
  })

  it('allowlist 밖 매장도 기존 상세 URL 로 보낸다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/app/approvals?item=a1')
  })

  it('플래그 ON + allowlist 매장이면 R2 진입을 그리고 item·workspace 를 넘긴다', async () => {
    allowR2()

    render(await renderPage())

    expect(nav.redirect).not.toHaveBeenCalled()
    const entry = screen.getByTestId('approval-detail-entry')
    expect(entry).toHaveAttribute('data-item', ITEM)
    expect(entry).toHaveAttribute('data-workspace', WORKSPACE_ID)
  })

  it('매장이 없으면 온보딩으로 보낸다', async () => {
    allowR2()
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding')

    expect(nav.redirect).toHaveBeenCalledWith('/app/onboarding')
  })
})
