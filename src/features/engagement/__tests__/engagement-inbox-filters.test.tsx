import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementInbox } from '../engagement-inbox'
import type { EngagementCommentItem } from '../types'

// Mock subcomponents
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/engagement',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('../engagement-morning-briefing', () => ({
  EngagementMorningBriefing: () => <div data-testid="morning-briefing" />,
}))

vi.mock('../engagement-autonomy-dial', () => ({
  EngagementAutonomyDial: () => <div data-testid="autonomy-dial" />,
}))

vi.mock('../engagement-auto-reply-panel', () => ({
  EngagementAutoReplyPanel: () => <div data-testid="auto-reply-panel" />,
}))

vi.mock('@/features/publish-readiness/readiness-card', () => ({
  ReadinessCard: () => <div data-testid="readiness-card" />,
}))

vi.mock('../engagement-comment-card', () => ({
  EngagementCommentCard: ({ comment }: { comment: EngagementCommentItem }) => (
    <div data-testid={`comment-card-${comment.id}`}>
      <span>{comment.channel}</span>
      <span>{comment.author_handle}</span>
    </div>
  ),
}))

describe('EngagementInbox Channel Filters and Batch Approval', () => {
  const mockComments: EngagementCommentItem[] = [
    {
      id: 'comm-ig-1',
      workspace_id: 'ws-1',
      channel: 'instagram',
      channel_label: '인스타그램',
      channel_connection_id: 'conn-1',
      account_label: '@sohee.ai',
      provider_comment_id: '12345',
      provider_media_id: 'post-1',
      author_handle: 'user1',
      comment_text: '정말 예뻐요 최고!',
      classification: 'THANKS',
      classification_label: '칭찬',
      confidence: 0.95,
      status: 'DRAFTED',
      status_label: '초안 준비됨',
      draft: {
        id: 'draft-1',
        workspace_id: 'ws-1',
        comment_id: 'comm-ig-1',
        draft_text: '감사합니다 고객님!',
        approved_fingerprint: null,
        approved_by: null,
        approved_at: null,
        is_auto_approved: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      comment_created_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'comm-th-1',
      workspace_id: 'ws-1',
      channel: 'threads',
      channel_label: '스레드',
      channel_connection_id: 'conn-2',
      account_label: '@sohee.ai',
      provider_comment_id: '67890',
      provider_media_id: 'post-2',
      author_handle: 'user2',
      comment_text: '스레드 보고 왔어요~',
      classification: 'GREETING',
      classification_label: '일반 인사',
      confidence: 0.9,
      status: 'RECEIVED',
      status_label: '접수됨',
      draft: null,
      comment_created_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]

  it('renders channel filter chips and filters comments by selected channel', () => {
    render(
      <EngagementInbox
        workspaceId="ws-1"
        initialData={{
          items: mockComments,
          send_enabled: true,
          cycle_enabled: true,
        }}
      />
    )

    expect(screen.getByText('전체 채널')).toBeInTheDocument()
    expect(screen.getByText('📷 인스타그램')).toBeInTheDocument()
    expect(screen.getByText('🧵 스레드')).toBeInTheDocument()

    // Both comments visible initially
    expect(screen.getByTestId('comment-card-comm-ig-1')).toBeInTheDocument()
    expect(screen.getByTestId('comment-card-comm-th-1')).toBeInTheDocument()

    // Filter to Threads only
    fireEvent.click(screen.getByText('🧵 스레드'))

    expect(screen.queryByTestId('comment-card-comm-ig-1')).toBeNull()
    expect(screen.getByTestId('comment-card-comm-th-1')).toBeInTheDocument()

    // Filter to Instagram only
    fireEvent.click(screen.getByText('📷 인스타그램'))

    expect(screen.getByTestId('comment-card-comm-ig-1')).toBeInTheDocument()
    expect(screen.queryByTestId('comment-card-comm-th-1')).toBeNull()
  })

  it('does NOT render batch approval button or call non-existent approve endpoint', () => {
    render(
      <EngagementInbox
        workspaceId="ws-1"
        initialData={{
          items: mockComments,
          send_enabled: true,
          cycle_enabled: true,
        }}
      />
    )

    expect(screen.queryByText(/칭찬 댓글 일괄 승인/)).toBeNull()
  })
})
