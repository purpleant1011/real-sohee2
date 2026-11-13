import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelLivePanel } from './channel-live-panel'
import * as engagementHook from './use-channel-engagement'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('ChannelLivePanel', () => {
  it('(a) 연결됨 & 검토 중 상태: 1차 CTA 링크 "승인하고 게시하기" (/app/work/{contentId}/approve)가 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="review"
        connectionStatus="connected"
      />
    )

    const approveLink = screen.getByRole('link', { name: /승인하고 게시하기/ })
    expect(approveLink).toHaveAttribute('href', '/app/work/cnt-1/approve')
    expect(approveLink.className).toContain('min-h-12')
  })

  it('(a) 연결됨 & 초안 상태: 1차 CTA 링크 "승인하고 게시하기"가 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="threads"
        contentStatus="draft"
        connectionStatus="connected"
      />
    )

    const approveLink = screen.getByRole('link', { name: /승인하고 게시하기/ })
    expect(approveLink).toHaveAttribute('href', '/app/work/cnt-1/approve')
  })

  it('(a) 연결됨 & 승인됨(approved) 상태: 1차 CTA 링크 "게시 전 최종 확인"이 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="approved"
        connectionStatus="connected"
      />
    )

    const finalConfirmLink = screen.getByRole('link', { name: /게시 전 최종 확인/ })
    expect(finalConfirmLink).toHaveAttribute('href', '/app/work/cnt-1/approve')
    expect(finalConfirmLink.className).toContain('min-h-12')
  })

  it('(a) 게시됨 & https publishedUrl: "실제 게시물 보기" 링크 (rel noopener)가 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="published"
        connectionStatus="connected"
        publishedUrl="https://www.instagram.com/p/test123"
      />
    )

    const liveLink = screen.getByRole('link', { name: /실제 게시물 보기/ })
    expect(liveLink).toHaveAttribute('href', 'https://www.instagram.com/p/test123')
    expect(liveLink).toHaveAttribute('target', '_blank')
    expect(liveLink.getAttribute('rel')).toContain('noopener')
    expect(liveLink.className).toContain('min-h-12')
  })

  it('(a) 미연결/만료 상태: "채널 연결하기" 링크 (/app/channels)가 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="draft"
        connectionStatus="disconnected"
      />
    )

    const connectLink = screen.getByRole('link', { name: /채널 연결하기/ })
    expect(connectLink).toHaveAttribute('href', '/app/channels')
    expect(connectLink.className).toContain('min-h-12')
  })

  it('(b) 실시간 응대 ready: "DM n건 · 댓글 n건" 텍스트와 /app/engagement 링크가 렌더링된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 3, pendingCommentCount: 5 },
      dmCount: 3,
      pendingCommentCount: 5,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="review"
        connectionStatus="connected"
      />
    )

    const engagementLink = screen.getByRole('link', { name: /DM 3건 · 댓글 5건/ })
    expect(engagementLink).toHaveAttribute('href', '/app/engagement')
    expect(engagementLink.className).toContain('min-h-12')
  })

  it('(b) 실시간 응대 unavailable: "확인하지 못했어요" 텍스트가 노출되며 절대 0으로 표기되지 않는다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'unavailable',
      summary: null,
      dmCount: null,
      pendingCommentCount: null,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="review"
        connectionStatus="connected"
      />
    )

    const engagementLink = screen.getByRole('link', { name: /확인하지 못했어요/ })
    expect(engagementLink).toHaveAttribute('href', '/app/engagement')
    expect(screen.queryByText(/0건/)).not.toBeInTheDocument()
  })

  it('(b) 실시간 응대 loading: 확인 중 상태가 노출된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'loading',
      summary: null,
      dmCount: null,
      pendingCommentCount: null,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="review"
        connectionStatus="connected"
      />
    )

    expect(screen.getByText(/확인 중/)).toBeInTheDocument()
  })

  it('(c) 안내 문구: "게시는 승인한 뒤에만 나가요." 문구가 포함된다', () => {
    vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
      state: 'ready',
      summary: { dmCount: 0, pendingCommentCount: 0 },
      dmCount: 0,
      pendingCommentCount: 0,
    })

    render(
      <ChannelLivePanel
        workspaceId="ws-1"
        contentId="cnt-1"
        channel="instagram"
        contentStatus="review"
        connectionStatus="connected"
      />
    )

    expect(screen.getByText('게시는 승인한 뒤에만 나가요.')).toBeInTheDocument()
  })

  describe('성과 새로고침 (Social Performance Refresh)', () => {
    beforeEach(() => {
      vi.spyOn(engagementHook, 'useChannelEngagement').mockReturnValue({
        state: 'ready',
        summary: { dmCount: 0, pendingCommentCount: 0 },
        dmCount: 0,
        pendingCommentCount: 0,
      })
    })

    it('게시 완료 및 검증된 providerPostId가 있을 때만 "성과 새로고침" 버튼이 노출된다', () => {
      const { rerender } = render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(screen.getByRole('button', { name: '성과 새로고침' })).toBeInTheDocument()

      // providerPostId가 없으면 노출되지 않음
      rerender(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId={null}
        />,
      )
      expect(screen.queryByRole('button', { name: '성과 새로고침' })).not.toBeInTheDocument()

      // 게시 완료 상태가 아니면(예: review) providerPostId가 있어도 노출되지 않음
      rerender(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="review"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )
      expect(screen.queryByRole('button', { name: '성과 새로고침' })).not.toBeInTheDocument()
    })

    it('모바일 규격(44px 타겟, 16px 폰트)을 준수한다', () => {
      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      expect(refreshButton.className).toMatch(/min-h-(11|12|\[44px\])/)
      expect(refreshButton.className).toContain('text-base')
    })

    it('불러오는 중(pending) 상태에서는 "불러오는 중…"이 표시되고 비활성화된다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: true,
        cooldownRemaining: 0,
        metrics: null,
        collectedAt: null,
        error: null,
        isMissingScope: false,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      const button = screen.getByRole('button', { name: '불러오는 중…' })
      expect(button).toBeDisabled()
    })

    it('쿨다운(cooldownRemaining > 0) 동안 버튼이 비활성화된다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: false,
        cooldownRemaining: 25,
        metrics: null,
        collectedAt: null,
        error: null,
        isMissingScope: false,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      const button = screen.getByRole('button', { name: '성과 새로고침' })
      expect(button).toBeDisabled()
    })

    it('수집 성공 시 스냅샷 지표와 KST 수집 시각이 렌더링된다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: false,
        cooldownRemaining: 0,
        metrics: [
          { metric: 'views', state: 'available', value: 120 },
          { metric: 'likes', state: 'available', value: 34 },
        ],
        collectedAt: '2026-08-08T13:00:00.000Z',
        error: null,
        isMissingScope: false,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(screen.getByText(/조회 120/)).toBeInTheDocument()
      expect(screen.getByText(/좋아요 34/)).toBeInTheDocument()
      // KST 22시 (오후 10시)
      expect(screen.getByText(/10:00|22:00/)).toBeInTheDocument()
    })

    it('지표 값이 없을 때 가짜 0을 표시하지 않고 "확인하지 못했어요"를 렌더링한다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: false,
        cooldownRemaining: 0,
        metrics: [
          { metric: 'views', state: 'no_data', value: null },
        ],
        collectedAt: '2026-08-08T13:00:00.000Z',
        error: null,
        isMissingScope: false,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(screen.getByText(/조회 확인하지 못했어요/)).toBeInTheDocument()
      expect(screen.queryByText(/조회 0/)).not.toBeInTheDocument()
    })

    it('권한 부족 시 안내 메시지와 /app/channels 링크가 렌더링된다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: false,
        cooldownRemaining: 0,
        metrics: null,
        collectedAt: null,
        error: '채널 연결 권한을 확인해 주세요',
        isMissingScope: true,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(screen.getByText('채널 연결 권한을 확인해 주세요')).toBeInTheDocument()
      const channelLink = screen.getByRole('link', { name: /채널 연결/ })
      expect(channelLink).toHaveAttribute('href', '/app/channels')
    })

    it('일반 실패 시 안내 메시지가 렌더링된다', () => {
      vi.spyOn(engagementHook, 'useSocialPerformanceRefresh').mockReturnValue({
        isPending: false,
        cooldownRemaining: 0,
        metrics: null,
        collectedAt: null,
        error: '성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        isMissingScope: false,
        refresh: vi.fn(),
      })

      render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(screen.getByText('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    })

    it('패널 UI 어디에도 "크레딧" 관련 문구가 노출되지 않는다', () => {
      const { container } = render(
        <ChannelLivePanel
          workspaceId="ws-1"
          contentId="cnt-1"
          channel="instagram"
          contentStatus="published"
          connectionStatus="connected"
          providerPostId="ig-post-123"
        />,
      )

      expect(container.textContent).not.toContain('크레딧')
      expect(container.textContent).not.toContain('credit')
    })
  })
})
