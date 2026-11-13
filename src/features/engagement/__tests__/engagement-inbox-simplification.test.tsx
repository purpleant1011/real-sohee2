import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementInbox } from '../engagement-inbox'
import { EngagementMorningBriefing } from '../engagement-morning-briefing'
import type { EngagementCommentsResponse } from '../types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/engagement',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/features/publish-readiness/readiness-card', () => ({
  ReadinessCard: () => null,
}))

const mockInitialData: EngagementCommentsResponse = {
  items: [
    {
      id: 'c-1',
      workspace_id: 'ws-1',
      channel: 'instagram',
      channel_label: '인스타그램',
      channel_connection_id: 'conn-1',
      provider_comment_id: 'p-1',
      provider_media_id: 'm-1',
      author_handle: 'test_user',
      comment_text: '안녕하세요!',
      comment_created_at: '2026-10-10T10:00:00Z',
      classification: 'GREETING',
      classification_label: '인사',
      confidence: 0.95,
      status: 'RECEIVED',
      status_label: '접수됨',
      created_at: '2026-10-10T10:00:00Z',
      updated_at: '2026-10-10T10:00:00Z',
      draft: null,
    },
  ],
  send_enabled: true,
  cycle_enabled: true,
  auto_replied_today_count: 0,
}

describe('Engagement UI Simplification (TDD Invariants)', () => {
  it('does NOT render fake briefing claims (공감 30+, 정기 소식 자동 발행 예정) in EngagementInbox', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    // Fake claims must NOT be present
    expect(screen.queryByText(/소희의 소셜 반응 일일 브리핑/i)).toBeNull()
    expect(screen.queryByText(/공감 반응 30\+회/i)).toBeNull()
    expect(screen.queryByText(/자동 발행 예정/i)).toBeNull()
    expect(screen.queryByText(/정기 소식/i)).toBeNull()
  })

  it('does NOT render fake D-3h emergency Meta policy hotline banner unconditionally', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    expect(screen.queryByText(/골든타임 내에 편하게 답장해 보세요/i)).toBeNull()
    expect(screen.queryByText(/인스타그램 예약 문의는 24시간 내 답변이 Meta 공식 정책이에요/i)).toBeNull()
  })

  it('does NOT display unverified autonomy dial (소희 자율운영 모드 / 안심 자율 가동 중) on the main screen', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    expect(screen.queryByRole('region', { name: /소희 자율운영 모드 설정/i })).toBeNull()
    expect(screen.queryByText(/소희 자율운영 모드/i)).toBeNull()
    expect(screen.queryByText(/안심 자율 가동 중/i)).toBeNull()
  })

  it('renders comments and messages tabs, and displays the real comment list without masking errors', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    expect(screen.getByRole('button', { name: '댓글' })).toBeDefined()
    expect(screen.getByRole('button', { name: '메시지' })).toBeDefined()
    expect(screen.getByText('@test_user')).toBeDefined()
    expect(screen.getByText('안녕하세요!')).toBeDefined()
  })

  it('provides a refresh button in the header', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    const refreshBtn = screen.getByRole('button', { name: /새로고침/i })
    expect(refreshBtn).toBeDefined()
  })

  it('does NOT render batch approval button or call /approve endpoint', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    expect(screen.queryByText(/칭찬 댓글 일괄 승인/i)).toBeNull()
    expect(screen.queryByText(/일괄 승인/i)).toBeNull()
  })

  it('provides a mobile back button (댓글 목록으로) in detail view to return to list', () => {
    render(<EngagementInbox workspaceId="ws-1" initialData={mockInitialData} />)

    // Select comment to enter detail
    const card = screen.getByTestId('comment-card-c-1')
    fireEvent.click(card)

    const backBtn = screen.getByRole('button', { name: /댓글 목록으로/i })
    expect(backBtn).toBeDefined()

    // Clicking back returns to unselected state
    fireEvent.click(backBtn)
    expect(screen.queryByRole('button', { name: /댓글 목록으로/i })).toBeNull()
  })

  it('hides auto-reply panel when no policy exists, avoiding false disabled claims', () => {
    render(
      <EngagementInbox
        workspaceId="ws-1"
        initialData={mockInitialData}
        initialPolicies={{ instagram: null, threads: null }}
      />
    )

    expect(screen.queryByText(/자동 답글 규칙/i)).toBeNull()
  })

  it('EngagementMorningBriefing does not inject fake default counts (3, 1, 30) or fake advice', () => {
    render(<EngagementMorningBriefing />)

    expect(screen.queryByText(/답글 대기 3건/i)).toBeNull()
    expect(screen.queryByText(/메시지 문의 1건/i)).toBeNull()
    expect(screen.queryByText(/공감 반응 30\+회/i)).toBeNull()
    expect(screen.queryByText(/소희의 조언/i)).toBeNull()
  })
})
