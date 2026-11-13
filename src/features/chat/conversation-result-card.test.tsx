import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationArtifact } from './types'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), shouldThrowWorkflow: false }))

vi.mock('@/features/content/actions/save-artifact-to-work', () => ({
  saveArtifactToWork: mocks.save,
}))
vi.mock('./actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.load,
}))
vi.mock('./conversation-publishing-workflow', () => ({
  ConversationPublishingWorkflow: ({ initialState, reviewContext }: {
    initialState: { preview: { versionNumber: number } }
    reviewContext: { evidence: readonly string[]; limitations: readonly string[]; unresolvedQuestions: readonly string[] }
  }) => {
    if (mocks.shouldThrowWorkflow) {
      throw new Error('Crashing on review to approved transition')
    }
    return (
      <section aria-label="대화 안 게시물 검토와 실행">
        게시 검토 v{initialState.preview.versionNumber} · 근거 {reviewContext.evidence.length}개 · 한계 {reviewContext.limitations.length}개 · 확인 {reviewContext.unresolvedQuestions.length}개
      </section>
    )
  },
}))

import { ConversationResultCard } from './conversation-result-card'

const artifact: ConversationArtifact = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  sourceMessageId: '30000000-0000-4000-8000-000000000001',
  type: 'instagram_post',
  status: 'partial',
  caption: '새로운 여름 관리를 준비했어요.',
  hashtags: ['#여름관리', '#바이름'],
  cta: '상담이 필요하면 알려 주세요.',
  disclosure: 'AI로 만든 이미지 초안입니다.',
  observations: ['여름철 관리 수요가 확인됐어요.'],
  limitations: ['실제 고객 반응 자료는 아직 없어요.'],
  evidence: ['승인된 브랜드 말투'],
  unresolvedQuestions: ['행사 기간을 확인해 주세요.'],
  idempotencyKey: '40000000-0000-4000-8000-000000000001',
  slides: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      position: 1,
      role: 'cover',
      status: 'succeeded',
      mediaAssetId: '60000000-0000-4000-8000-000000000001',
      altText: '여름 관리 안내 표지',
      retryable: false,
      safeErrorCode: null,
    },
    {
      id: '50000000-0000-4000-8000-000000000002',
      position: 2,
      role: 'action',
      status: 'failed',
      mediaAssetId: null,
      altText: '',
      retryable: true,
      safeErrorCode: 'IMAGE_RETRYABLE',
    },
  ],
}
const replyToMessageId = '31000000-0000-4000-8000-000000000001'

vi.mock('./reload-once-for-stale-deploy', () => ({ reloadOnceForStaleDeploy: () => false }))

describe('ConversationResultCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue({
      data: {
        role: 'owner',
        preview: { versionNumber: 1 },
        receipt: null,
      },
    })
    mocks.save.mockResolvedValue({
      data: {
        artifactId: artifact.id,
        workItemId: '70000000-0000-4000-8000-000000000001',
        contentItemId: '80000000-0000-4000-8000-000000000001',
        versionId: '90000000-0000-4000-8000-000000000001',
        versionNumber: 1,
        next: '/app/work/80000000-0000-4000-8000-000000000001',
      },
    })
  })

  it('shows structured copy and only real successful media without internal identifiers', () => {
    render(<ConversationResultCard artifact={artifact} replyToMessageId={replyToMessageId} />)

    expect(screen.getByRole('heading', { name: 'Instagram 게시물 제안' })).toBeInTheDocument()
    expect(screen.getByText(artifact.caption)).toBeInTheDocument()
    expect(screen.getByText('#여름관리 #바이름')).toBeInTheDocument()
    expect(screen.getByText(artifact.cta)).toBeInTheDocument()
    expect(screen.getByText(artifact.disclosure)).toBeInTheDocument()
    expect(screen.getByText('승인된 브랜드 말투')).toBeInTheDocument()
    expect(screen.getByText('행사 기간을 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '여름 관리 안내 표지' })).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/workspaces/${artifact.workspaceId}/media/${artifact.slides[0].mediaAssetId}`),
    )
    expect(screen.getByText('2번 이미지를 만들지 못했어요.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(artifact.id)
    expect(document.body).not.toHaveTextContent('IMAGE_RETRYABLE')
  })

  it('shows the exact public Naver Blog title and ordered body sections', () => {
    render(<ConversationResultCard artifact={{
      ...artifact,
      type: 'naver_blog_post',
      title: '반영구 눈썹 상담 전 확인할 점',
      naverBlog: {
        introduction: '원하는 느낌을 정리해 보세요.',
        sections: [{ heading: '상담 전 체크', body: '평소 메이크업과 원하는 두께를 알려주세요.' }],
        keywords: ['반영구눈썹', '눈썹상담'],
        visibility: 'public',
      },
    }} replyToMessageId={replyToMessageId} />)

    expect(screen.getByRole('heading', { name: '네이버 블로그 게시물 제안' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '반영구 눈썹 상담 전 확인할 점' })).toBeInTheDocument()
    expect(screen.getByText('원하는 느낌을 정리해 보세요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '상담 전 체크' })).toBeInTheDocument()
    expect(screen.getByText('공개 게시')).toBeInTheDocument()
  })

  it('retries every failed image in place as one complete batch action', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const failedSlides = [2, 3, 4, 5].map((position) => ({
      ...artifact.slides[1],
      id: `50000000-0000-4000-8000-00000000000${position}`,
      position,
    }))
    render(<ConversationResultCard artifact={{ ...artifact, slides: [artifact.slides[0], ...failedSlides] }} onRetrySlides={retry} replyToMessageId={replyToMessageId} />)

    fireEvent.click(screen.getByRole('button', { name: '실패 이미지 4장 한 번에 다시 생성' }))

    expect(retry).toHaveBeenCalledWith(
      replyToMessageId,
      artifact.id,
      failedSlides.map((slide) => slide.id),
    )
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '2번 이미지만 다시 시도' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('실패했던 이미지 전체를 같은 결과물에 반영했어요.'))
  })

  it('shows an actionable reason when in-place image regeneration fails', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('이미지 생성이 중단되었어요. 완료된 이미지는 그대로 보존했습니다.'))
    render(<ConversationResultCard artifact={artifact} onRetrySlides={retry} replyToMessageId={replyToMessageId} />)

    fireEvent.click(screen.getByRole('button', { name: '실패 이미지 1장 한 번에 다시 생성' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('이미지 생성이 중단되었어요. 완료된 이미지는 그대로 보존했습니다.'))
  })

  it('automatically prepares a complete result for review without an intermediate save button', async () => {
    const complete = {
      ...artifact,
      status: 'ready_for_review' as const,
      slides: [artifact.slides[0]],
    }
    render(<ConversationResultCard artifact={complete} replyToMessageId={replyToMessageId} />)

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith({
      artifactId: artifact.id,
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith({
      workspaceId: artifact.workspaceId,
      contentId: '80000000-0000-4000-8000-000000000001',
    }))
    expect(await screen.findByRole('region', { name: '대화 안 게시물 검토와 실행' })).toHaveTextContent('게시 검토 v1')
    expect(screen.getByRole('region', { name: '대화 안 게시물 검토와 실행' })).toHaveTextContent('근거 1개 · 한계 1개 · 확인 1개')
    expect(screen.getByRole('link', { name: '상세 작업 기록 보기' })).toHaveAttribute(
      'href',
      '/app/work/80000000-0000-4000-8000-000000000001',
    )
    expect(screen.queryByText('이 대화에서 최종 미리보기, 부분 수정, 승인과 게시를 이어갈 수 있어요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '선택한 결과물로 검토·승인' })).not.toBeInTheDocument()
  })

  it('offers an explicit review retry when automatic work saving fails', async () => {
    mocks.save
      .mockResolvedValueOnce({ error: { message: '결과물을 대화 결과에 저장하지 못했습니다.' } })
      .mockResolvedValueOnce({
        data: {
          artifactId: artifact.id,
          workItemId: '70000000-0000-4000-8000-000000000001',
          contentItemId: '80000000-0000-4000-8000-000000000001',
          versionId: '90000000-0000-4000-8000-000000000001',
          versionNumber: 1,
          next: '/app/work/80000000-0000-4000-8000-000000000001',
        },
      })
    render(<ConversationResultCard artifact={{ ...artifact, status: 'ready_for_review', slides: [artifact.slides[0]] }} replyToMessageId={replyToMessageId} />)

    fireEvent.click(await screen.findByRole('button', { name: '검토 화면 다시 준비' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('region', { name: '대화 안 게시물 검토와 실행' })).toBeInTheDocument()
  })

  it('interleaves Naver text and images in the approved editor blueprint order', () => {
    const naverArtifact: ConversationArtifact = {
      ...artifact,
      type: 'naver_blog_post',
      title: '눈썹 상담 전 확인할 점',
      naverBlog: {
        introduction: '나에게 맞는 기준을 확인해 보세요.',
        sections: [{ heading: '맞춤 상담', body: '현재 눈썹과 원하는 분위기를 함께 살펴봅니다.' }],
        editorBlueprint: [
          { kind: 'paragraph', text: '나에게 맞는 기준을 확인해 보세요.' },
          { kind: 'image_slot', position: 1, altText: '눈썹 상담 표지' },
          { kind: 'heading', text: '맞춤 상담' },
          { kind: 'paragraph', text: '현재 눈썹과 원하는 분위기를 함께 살펴봅니다.' },
          { kind: 'image_slot', position: 2, altText: '눈썹 디자인 상세' },
          { kind: 'cta', text: '바이름에 편안하게 문의해 보세요.' },
        ],
        keywords: ['눈썹문신', '바이름'],
        visibility: 'public',
      },
      slides: [
        artifact.slides[0],
        { ...artifact.slides[0], id: '50000000-0000-4000-8000-000000000002', position: 2, mediaAssetId: '60000000-0000-4000-8000-000000000002', altText: '눈썹 디자인 상세' },
      ],
    }
    const { container } = render(<ConversationResultCard artifact={naverArtifact} replyToMessageId={replyToMessageId} />)

    expect([...container.querySelectorAll('[data-naver-block]')].map((node) => node.getAttribute('data-naver-block')))
      .toEqual(['paragraph', 'image', 'heading', 'paragraph', 'image', 'cta'])
  })

  it('restores a previously saved exact version directly into the conversation workflow', async () => {
    render(<ConversationResultCard
      artifact={{
        ...artifact,
        contentItemId: '80000000-0000-4000-8000-000000000001',
        versionId: '90000000-0000-4000-8000-000000000001',
      }}
      replyToMessageId={replyToMessageId}
    />)

    expect(await screen.findByRole('region', { name: '대화 안 게시물 검토와 실행' })).toHaveTextContent('게시 검토 v1')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('lets the user retry only the review load when the Worker request fails after saving', async () => {
    mocks.load
      .mockRejectedValueOnce(new Error('worker_cpu_exceeded'))
      .mockResolvedValueOnce({
        data: {
          role: 'owner',
          preview: { versionNumber: 1 },
          receipt: null,
        },
      })

    render(<ConversationResultCard
      artifact={{
        ...artifact,
        contentItemId: '80000000-0000-4000-8000-000000000001',
        versionId: '90000000-0000-4000-8000-000000000001',
      }}
      replyToMessageId={replyToMessageId}
    />)

    const retry = await screen.findByRole('button', { name: '검토 화면 다시 불러오기' })
    expect(screen.getByRole('status')).toHaveTextContent('저장된 결과물은 안전하게 보존했어요')

    fireEvent.click(retry)

    expect(await screen.findByRole('region', { name: '대화 안 게시물 검토와 실행' })).toHaveTextContent('게시 검토 v1')
    expect(mocks.load).toHaveBeenCalledTimes(2)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('blocks saving while the result is still preparing and explains why', () => {
    render(<ConversationResultCard artifact={{ ...artifact, status: 'preparing' }} replyToMessageId={replyToMessageId} />)

    expect(screen.getByRole('button', { name: '선택한 결과물로 검토·승인' })).toBeDisabled()
    expect(screen.getByText('이미지 준비가 끝나면 검토를 계속할 수 있어요.')).toBeInTheDocument()
  })

  it('does not render duplicate resultStatus role="status" outside workflow when publishingState is loaded', async () => {
    render(<ConversationResultCard
      artifact={{
        ...artifact,
        contentItemId: '80000000-0000-4000-8000-000000000001',
        versionId: '90000000-0000-4000-8000-000000000001',
      }}
      replyToMessageId={replyToMessageId}
    />)

    expect(await screen.findByRole('region', { name: '대화 안 게시물 검토와 실행' })).toBeInTheDocument()
    // When workflow is loaded, resultStatus line must not exist in DOM
    const card = screen.getByRole('article', { name: /게시물 제안/ })
    const resultStatusOutside = card.querySelector('[class*="resultStatus"]')
    expect(resultStatusOutside).toBeNull()
    expect(card.querySelector('[role="status"]')).toBeNull()
  })

  it('contains errors inside the card with a retry button when workflow throws during render or transition', async () => {
    mocks.shouldThrowWorkflow = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ConversationResultCard
      artifact={{
        ...artifact,
        contentItemId: '80000000-0000-4000-8000-000000000001',
        versionId: '90000000-0000-4000-8000-000000000001',
      }}
      replyToMessageId={replyToMessageId}
    />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('게시 검토 화면을 불러오는 중 문제가 발생했어요.')).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: '다시 시도' })
    expect(retryButton).toBeInTheDocument()

    // When clicking 다시 시도, if error is cleared, it recovers
    mocks.shouldThrowWorkflow = false
    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '대화 안 게시물 검토와 실행' })).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })
})
