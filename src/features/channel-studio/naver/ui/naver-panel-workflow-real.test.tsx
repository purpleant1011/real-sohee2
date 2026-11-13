import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConversationPublishingAction: vi.fn(),
  approveAndDispatchAction: vi.fn(),
  wakeBrowserConnector: vi.fn(),
}))

vi.mock('@/features/chat/actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.loadConversationPublishingAction,
}))

vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({
  approveAndDispatchAction: mocks.approveAndDispatchAction,
}))

vi.mock('@/features/local-publishing/wake-browser-connector', () => ({
  wakeBrowserConnector: mocks.wakeBrowserConnector,
}))

import { NaverPostPanel } from './naver-post-panel'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'

describe('NaverPostPanel with real ConversationPublishingWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    mocks.wakeBrowserConnector.mockResolvedValue({ state: 'ready' })
  })

  it('transitions from Review step to Result step when real workflow is dispatched', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        post: {
          contentId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          versionNumber: 1,
          title: '피부관리 정보',
          imageCount: 4,
        },
      }),
    })

    const initialPreview = {
      workspaceId: WORKSPACE,
      contentId: '22222222-2222-4222-8222-222222222222',
      versionId: '33333333-3333-4333-8333-333333333333',
      versionNumber: 1,
      fingerprint: 'a'.repeat(64),
      title: '피부관리 정보',
      channel: 'naver_blog' as const,
      visibility: 'public' as const,
      issues: [],
      account: {
        connectionId: 'conn-1',
        label: 'findk3 블로그',
        status: 'connected' as const,
      },
      approval: {
        status: 'pending' as const,
        fingerprint: null,
      },
      media: [],
    }

    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: initialPreview,
        receipt: null,
      },
    })

    mocks.approveAndDispatchAction.mockResolvedValue({
      data: {
        approvalId: 'appr-1',
        scheduleId: 'sched-100',
        attemptId: 'att-1',
        providerPostId: null,
        next: 'published',
      },
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    // Step 1: fill form & submit
    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '피부관리 정보' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    // Step 3: 리뷰 단계는 수동 게시 도우미만 보여 준다(V1.2: 자동 게시 버튼 없음).
    expect(await screen.findByRole('button', { name: '본문 복사' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '네이버 글쓰기 열기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /네이버에 게시/ })).not.toBeInTheDocument()
    expect(mocks.approveAndDispatchAction).not.toHaveBeenCalled()
  })
})
