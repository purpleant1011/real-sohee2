import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostPublishCarePanel } from './post-publish-care-panel'
import type { PostPublishCareState } from './actions/post-publish-care-helpers'

const mocks = vi.hoisted(() => ({
  loadPostPublishCare: vi.fn(),
  updatePostPublishCare: vi.fn(),
}))

vi.mock('./actions/load-post-publish-care', () => ({
  loadPostPublishCare: mocks.loadPostPublishCare,
}))

vi.mock('./actions/update-post-publish-care', () => ({
  updatePostPublishCare: mocks.updatePostPublishCare,
}))

const defaultState: PostPublishCareState = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  channel: 'instagram',
  comment_watch: {
    enabled: true,
    available: true,
    reason: null,
  },
  reaction_report: {
    enabled: true,
    available: true,
    reason: null,
    needsSetup: false,
  },
  always_on: {
    dm: {
      active: true,
      reason: null,
    },
    booking_inquiry: {
      active: true,
      reason: null,
    },
  },
}

describe('PostPublishCarePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPostPublishCare.mockResolvedValue({
      ok: true,
      state: defaultState,
    })
    mocks.updatePostPublishCare.mockResolvedValue({
      ok: true,
      state: defaultState,
    })
  })

  it('renders per channel: instagram shows completion card and care section', async () => {
    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
        publishedAt="2026-11-03T10:00:00.000Z"
        destinationUrl="https://www.instagram.com/p/TEST1234/"
      />,
    )

    // Completion card
    expect(screen.getByText('게시했어요')).toBeInTheDocument()
    expect(screen.getByText(/Instagram · @studio_byreum/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '게시물 확인하기' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/TEST1234/',
    )

    // Care section
    expect(await screen.findByText('소희가 이어서 할 일')).toBeInTheDocument()
    expect(screen.getByText('댓글 확인 · 답글 초안 준비')).toBeInTheDocument()
    expect(screen.getByText('반응 요약 (게시 24시간 뒤)')).toBeInTheDocument()
    expect(screen.getByText('DM 문의')).toBeInTheDocument()
    expect(screen.getByText('예약 문의')).toBeInTheDocument()
    expect(
      screen.getByText('소희는 사장님이 승인하기 전에는 손님에게 먼저 답하지 않아요. 초안만 준비해요.'),
    ).toBeInTheDocument()
  })

  it('renders per channel: threads shows threads-specific copy', async () => {
    mocks.loadPostPublishCare.mockResolvedValueOnce({
      ok: true,
      state: {
        ...defaultState,
        channel: 'threads',
        always_on: {
          dm: {
            active: false,
            reason: '스레드는 DM 기능을 지원하지 않아요',
          },
          booking_inquiry: {
            active: true,
            reason: null,
          },
        },
      },
    })

    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="threads"
        accountLabel="@threads_byreum"
        publishedAt="2026-11-03T10:00:00.000Z"
        destinationUrl="https://www.threads.net/@threads_byreum/post/TEST"
      />,
    )

    expect(screen.getByText('게시했어요')).toBeInTheDocument()
    expect(screen.getByText(/Threads · @threads_byreum/)).toBeInTheDocument()
    expect(await screen.findByText('스레드는 DM 기능을 지원하지 않아요')).toBeInTheDocument()
  })

  it('naver shows nothing (returns null)', () => {
    const { container } = render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="naver_blog"
        accountLabel="byreum_blog"
      />,
    )

    expect(container.firstChild).toBeNull()
    expect(mocks.loadPostPublishCare).not.toHaveBeenCalled()
  })

  it('verified-link-only rule: shows fallback text when destinationUrl is missing', async () => {
    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
      />,
    )

    expect(screen.getByText('게시했어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '게시물 확인하기' })).toBeNull()
    expect(screen.getByText('채널에서 게시물을 확인하고 있어요')).toBeInTheDocument()
  })

  it('toggle optimistic + rollback on {ok:false}', async () => {
    mocks.updatePostPublishCare.mockResolvedValueOnce({
      ok: false,
      code: 'internal_error',
    })

    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
      />,
    )

    const toggle = await screen.findByRole('switch', { name: '댓글 확인 · 답글 초안 준비' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    // Optimistically updated
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(mocks.updatePostPublishCare).toHaveBeenCalledWith({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      key: 'comment_watch',
      enabled: false,
    })

    // Rolled back after failure + inline error
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
    expect(screen.getByText('설정을 변경하지 못했어요.')).toBeInTheDocument()
  })

  it('needsSetup link: shows automation link button instead of switch when needsSetup is true', async () => {
    mocks.loadPostPublishCare.mockResolvedValueOnce({
      ok: true,
      state: {
        ...defaultState,
        reaction_report: {
          enabled: false,
          available: false,
          reason: '자동화에서 켜기 필요',
          needsSetup: true,
        },
      },
    })

    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
      />,
    )

    await screen.findByText('소희가 이어서 할 일')
    expect(screen.queryByRole('switch', { name: '반응 요약 (게시 24시간 뒤)' })).toBeNull()

    const setupLink = screen.getByRole('link', { name: '자동화에서 켜기' })
    expect(setupLink).toHaveAttribute('href', '/app/account/automation')
  })

  it('loader error state: shows calm error line and retry button without blocking completion card', async () => {
    mocks.loadPostPublishCare.mockResolvedValueOnce({
      ok: false,
      code: 'internal_error',
    })

    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
      />,
    )

    // Completion card is never blocked
    expect(screen.getByText('게시했어요')).toBeInTheDocument()

    // Calm error and retry button
    const errorText = await screen.findByText('소희 사후 설정을 불러오지 못했어요.')
    expect(errorText).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    expect(retryBtn).toBeInTheDocument()

    // Clicking retry re-triggers loadPostPublishCare
    mocks.loadPostPublishCare.mockResolvedValueOnce({
      ok: true,
      state: defaultState,
    })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: '댓글 확인 · 답글 초안 준비' })).toBeInTheDocument()
    })
  })

  it('no credit amounts or mention anywhere in UI text', async () => {
    const { container } = render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
        destinationUrl="https://www.instagram.com/p/TEST1234/"
      />,
    )

    await screen.findByText('소희가 이어서 할 일')
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toMatch(/\d+\s*크레딧/)
  })

  it('mobile touch target and typography classes are applied to completion card and care panel', async () => {
    render(
      <PostPublishCarePanel
        workspaceId="10000000-0000-4000-8000-000000000001"
        channel="instagram"
        accountLabel="@studio_byreum"
        publishedAt="2026-11-03T10:00:00.000Z"
        destinationUrl="https://www.instagram.com/p/TEST1234/"
      />,
    )

    // Completion link: >= 44px touch height with inline-flex centering
    const link = screen.getByRole('link', { name: '게시물 확인하기' })
    expect(link.className).toMatch(/publishCompletionLink/)
    expect(link.className).toMatch(/min-h-\[44px\]/)

    // Care panel title
    const heading = await screen.findByText('소희가 이어서 할 일')
    expect(heading.className).toMatch(/carePanelTitle/)

    // Care switch button: tap target >= 44px wrapping 44x24 visual track
    const switchBtn = await screen.findByRole('switch', { name: '댓글 확인 · 답글 초안 준비' })
    expect(switchBtn.className).toMatch(/careSwitchButton/)
    expect(switchBtn.className).toMatch(/min-h-\[44px\]/)
    const visualTrack = switchBtn.querySelector('[class*="careSwitchTrack"]')
    expect(visualTrack).not.toBeNull()

    // Row label
    const label = screen.getByText('댓글 확인 · 답글 초안 준비')
    expect(label.className).toMatch(/careRowLabel/)

    // Secondary row labels
    const dmLabel = screen.getByText('DM 문의')
    const bookingLabel = screen.getByText('예약 문의')
    expect(dmLabel.closest('div')?.className).toMatch(/careSecondaryRow/)
    expect(bookingLabel.closest('div')?.className).toMatch(/careSecondaryRow/)

    // Disclaimer
    const disclaimer = screen.getByText('소희는 사장님이 승인하기 전에는 손님에게 먼저 답하지 않아요. 초안만 준비해요.')
    expect(disclaimer.className).toMatch(/careDisclaimer/)
  })
})
