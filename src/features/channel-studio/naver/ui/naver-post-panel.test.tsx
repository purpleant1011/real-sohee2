import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConversationPublishingAction: vi.fn(),
}))

vi.mock('@/features/chat/actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.loadConversationPublishingAction,
}))

vi.mock('@/features/naver-publish/get-synced-categories.action', () => ({
  getSyncedNaverCategoriesAction: vi.fn(async () => ({ data: [] })),
}))

vi.mock('./naver-review-step', () => ({
  NaverReviewStep: ({ contentId, settings }: any) => (
    <div data-testid="review-step">
      Review Step for {contentId}
      <span>{settings.imageCount}장</span>
    </div>
  ),
}))

import { NaverPostPanel } from './naver-post-panel'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'

describe('NaverPostPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: { title: '가을철 피부관리', channel: 'naver_blog', issues: [], account: {}, approval: {}, media: [] },
        receipt: null,
      },
    })
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders 3-step progress header (주제 -> 만드는 중 -> 확인) with initial step "주제" aria-current', () => {
    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    const step1 = screen.getByRole('listitem', { name: '주제' })
    expect(step1).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('주제 입력')).toBeInTheDocument()

    // 4th step "게시" must be removed
    expect(screen.queryByRole('listitem', { name: '게시' })).not.toBeInTheDocument()
  })

  it('moves focus to step heading on transition', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        post: {
          contentId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          versionNumber: 1,
          title: '가을철 피부관리',
          imageCount: 4,
        },
      }),
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '가을철 피부관리' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 2 })
      expect(document.activeElement).toBe(heading)
    })
  })

  it('generates post without scheduledAt in request body and transitions to manual review step', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        post: {
          contentId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          versionNumber: 1,
          title: '가을철 피부관리',
          imageCount: 4,
        },
      }),
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '가을철 피부관리' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    const fetchCall = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.scheduledAt).toBeUndefined()

    expect(await screen.findByTestId('review-step')).toBeInTheDocument()
    const stepReview = screen.getByRole('listitem', { name: '확인' })
    expect(stepReview).toHaveAttribute('aria-current', 'step')
  })

  it('cancels generation when clicking 그만두기', async () => {
    let abortSignal: AbortSignal | null | undefined
    ;(global.fetch as any).mockImplementation((_url: string, init: RequestInit) => {
      abortSignal = init.signal
      return new Promise(() => {}) // never resolves
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '취소할 글' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(screen.getByText('글을 쓰고 있어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '그만두기' }))

    expect(abortSignal?.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: '소희에게 글 쓰기 맡기기' })).toBeInTheDocument()
  })

  it('reuses the same requestKey when retrying after a failure', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: '네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.',
          errorCode: 'SERVICE_UNAVAILABLE',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          post: {
            contentId: '22222222-2222-4222-8222-222222222222',
            versionId: '33333333-3333-4333-8333-333333333333',
            versionNumber: 1,
            title: '재시도 성공 글',
            imageCount: 4,
          },
        }),
      })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '재시도 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(await screen.findByText('글 생성을 완료하지 못했어요')).toBeInTheDocument()

    const firstBody = JSON.parse((global.fetch as any).mock.calls[0][1].body)
    expect(firstBody.requestKey).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => {
      expect((global.fetch as any).mock.calls.length).toBe(2)
    })
    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body)
    expect(secondBody.requestKey).toBe(firstBody.requestKey)
  })

  it('generates a new requestKey when retrying after CLAIMS_NEED_REVIEW with "같은 주제로 다시 만들기"', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: '확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?',
          errorCode: 'CLAIMS_NEED_REVIEW',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          post: {
            contentId: '22222222-2222-4222-8222-222222222222',
            versionId: '33333333-3333-4333-8333-333333333333',
            versionNumber: 1,
            title: '클레임 재시도 성공 글',
            imageCount: 4,
          },
        }),
      })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '클레임 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(await screen.findByText('확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?')).toBeInTheDocument()

    const firstBody = JSON.parse((global.fetch as any).mock.calls[0][1].body)
    expect(firstBody.requestKey).toBeDefined()

    const retryBtn = screen.getByRole('button', { name: '같은 주제로 다시 만들기' })
    expect(screen.getByRole('button', { name: '처음으로' })).toBeInTheDocument()
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect((global.fetch as any).mock.calls.length).toBe(2)
    })
    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body)
    expect(secondBody.requestKey).not.toBe(firstBody.requestKey)
    expect(secondBody.topic).toBe('클레임 테스트')
  })

  it('generates a new requestKey when retrying after DRAFT_FAILED with "같은 주제로 다시 만들기"', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          errorCode: 'DRAFT_FAILED',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          post: {
            contentId: '22222222-2222-4222-8222-222222222222',
            versionId: '33333333-3333-4333-8333-333333333333',
            versionNumber: 1,
            title: '초안실패 재시도 성공 글',
            imageCount: 4,
          },
        }),
      })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '초안실패 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(await screen.findByText('초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()

    const firstBody = JSON.parse((global.fetch as any).mock.calls[0][1].body)
    expect(firstBody.requestKey).toBeDefined()

    const retryBtn = screen.getByRole('button', { name: '같은 주제로 다시 만들기' })
    expect(screen.getByRole('button', { name: '처음으로' })).toBeInTheDocument()
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect((global.fetch as any).mock.calls.length).toBe(2)
    })
    const secondBody = JSON.parse((global.fetch as any).mock.calls[1][1].body)
    expect(secondBody.requestKey).not.toBe(firstBody.requestKey)
    expect(secondBody.topic).toBe('초안실패 테스트')
  })

  it('renders credit charge action when errorCode is CREDIT_INSUFFICIENT', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        error: '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
        errorCode: 'CREDIT_INSUFFICIENT',
      }),
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '크레딧 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    expect(await screen.findByRole('link', { name: '크레딧 충전하기' })).toBeInTheDocument()
  })

  it('includes postMode, reaction, and imageStyle in request body when custom options are selected', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        post: {
          contentId: '22222222-2222-4222-8222-222222222222',
          versionId: '33333333-3333-4333-8333-333333333333',
          versionNumber: 1,
          title: '포토스토리 글',
          imageCount: 12,
        },
      }),
    })

    render(<NaverPostPanel workspaceId={WORKSPACE} />)

    // 포토스토리 형식 카드 선택
    const photoStoryCard = screen.getByRole('radio', { name: /포토스토리/ })
    fireEvent.click(photoStoryCard)

    // 15장 선택 (빠른 선택 칩)
    fireEvent.click(screen.getByRole('button', { name: '15장' }))

    // 독자 반응 '방문 유도' 선택
    fireEvent.click(screen.getByRole('radio', { name: /방문 유도/ }))

    // 이미지 스타일 '과정 컷' 선택
    fireEvent.click(screen.getByRole('radio', { name: /과정 컷/ }))

    fireEvent.change(screen.getByRole('textbox', { name: /주제/ }), { target: { value: '포토스토리 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    const fetchCall = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.postMode).toBe('photo_story')
    expect(body.imageCount).toBe(15)
    expect(body.reaction).toBe('visit')
    expect(body.imageStyle).toBe('process_shot')
  })

  it('passes initialPostMode to NaverPostForm', () => {
    render(<NaverPostPanel workspaceId={WORKSPACE} initialPostMode="process" />)

    const processCard = screen.getByRole('radio', { name: /과정 소개형/ })
    expect(processCard).toHaveAttribute('aria-checked', 'true')
  })

  it('passes placePhotosAvailable to NaverPostForm to enable store_photo style', () => {
    // 1. 기본은 false (disabled)
    const { unmount } = render(<NaverPostPanel workspaceId={WORKSPACE} />)
    const storePhotoDisabled = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    expect(storePhotoDisabled).toHaveAttribute('aria-disabled', 'true')
    unmount()

    // 2. placePhotosAvailable = true (enabled)
    render(<NaverPostPanel workspaceId={WORKSPACE} placePhotosAvailable={true} />)
    const storePhotoEnabled = screen.getByRole('radio', { name: /우리 매장 실제 사진/ })
    expect(storePhotoEnabled).not.toHaveAttribute('aria-disabled', 'true')
  })
})
