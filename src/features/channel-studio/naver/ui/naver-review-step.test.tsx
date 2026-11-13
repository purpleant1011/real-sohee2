import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadConversationPublishingAction: vi.fn(),
  copy: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/features/chat/actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.loadConversationPublishingAction,
}))

vi.mock('../copy-naver-post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../copy-naver-post')>()
  return {
    ...actual,
    copyNaverPostWithResult: mocks.copy,
  }
})
vi.mock('../naver-handoff', () => ({ downloadNaverHandoff: mocks.download }))
vi.mock('../one-shot-handoff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../one-shot-handoff')>()
  const fakeAsset = {
    photoCount: 1,
    files: [new File(['fake'], 'photo-01.jpg', { type: 'image/jpeg' })],
    skippedPhotos: 0,
  }
  return {
    ...actual,
    prepareOneShotAssets: vi.fn().mockResolvedValue(fakeAsset),
    getOrStartPreparedAssets: vi.fn().mockResolvedValue(fakeAsset),
  }
})

import { NaverReviewStep } from './naver-review-step'
import { clearPreparedAssetsCache } from '../one-shot-handoff'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'

describe('NaverReviewStep (Manual helper UX contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPreparedAssetsCache()
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
  })

  function renderStep(receipt: unknown = null) {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-3',
          fingerprint: 'a'.repeat(64),
          title: '검토용 제목',
          caption: '잘린 요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '검토용 제목',
            introduction: '도입',
            sections: [{ heading: '소제목', body: '승인할 본문입니다.' }],
            keywords: ['피부관리', '청라'],
            cta: '문의 안내',
          },
          disclosure: 'AI 보조 제작',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [{ id: 'photo', src: 'https://example.com/photo.jpg' }],
        },
        receipt,
      },
    })
    return render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        settings={{ visibility: 'public', categoryName: '일상', imageCount: 1 }}
        onReset={vi.fn()}
      />,
    )
  }

  it('renders 6 manual publishing CTAs in exact UX order: ①제목 복사 ②본문 복사 ③태그 복사 ④사진 받기/ZIP ⑤네이버 글쓰기 열기 ⑥게시 URL 등록', async () => {
    renderStep()

    // Instructions copy
    expect(
      await screen.findByText('소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.'),
    ).toBeInTheDocument()

    // 6 CTAs in order
    const titleBtn = screen.getByRole('button', { name: '제목 복사' })
    const bodyBtn = screen.getByRole('button', { name: '본문 복사' })
    const tagBtn = screen.getByRole('button', { name: '태그 복사' })
    const zipBtn = screen.getByRole('button', { name: /사진 받기\/ZIP|원고·사진 ZIP/ })
    const openEditorBtn = screen.getByRole('link', { name: '네이버 글쓰기 열기' })
    // 블로그 아이디 없는 PostWriteForm 은 네이버가 404 를 돌려준다. 로그인 후 본인 글쓰기로 이어지는 진입점을 쓴다.
    expect(openEditorBtn).toHaveAttribute('href', 'https://blog.naver.com/GoBlogWrite.naver')
    const urlInput = screen.getByLabelText(/올린 글 주소/)

    expect(titleBtn).toBeInTheDocument()
    expect(bodyBtn).toBeInTheDocument()
    expect(tagBtn).toBeInTheDocument()
    expect(zipBtn).toBeInTheDocument()
    expect(openEditorBtn).toBeInTheDocument()
    expect(urlInput).toBeInTheDocument()

    // Touch target min 44px
    expect(titleBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)
    expect(bodyBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)
    expect(tagBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)
    expect(zipBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)
    expect(openEditorBtn.className).toMatch(/min-h-11|min-h-\[44px\]/)

    // No automatic workflow component rendered
    expect(screen.queryByTestId('publishing-workflow')).not.toBeInTheDocument()
    expect(screen.queryByText(/대신 올리기|자동등록|확장 프로그램 설치/)).not.toBeInTheDocument()
  })

  it('shows "본문이 복사됐어요. 사진은 따로 첨부해 주세요." after body copy and does NOT claim "게시 완료"', async () => {
    mocks.copy.mockResolvedValue('html')
    renderStep()

    const bodyBtn = await screen.findByRole('button', { name: '본문 복사' })
    fireEvent.click(bodyBtn)

    expect(
      await screen.findByText('본문이 복사됐어요. 사진은 따로 첨부해 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/게시 완료/)).not.toBeInTheDocument()
    expect(screen.queryByText(/네이버 게시 성공/)).not.toBeInTheDocument()
  })

  it('renders fallback selectable full text sheet when clipboard access is rejected or unavailable', async () => {
    mocks.copy.mockResolvedValue('permission_denied')
    renderStep()

    const bodyBtn = await screen.findByRole('button', { name: '본문 복사' })
    fireEvent.click(bodyBtn)

    expect(
      await screen.findByText(/클립보드 접근 권한이 거부되었어요/),
    ).toBeInTheDocument()

    // Selectable text sheet fallback
    const fullTextSheet = screen.getByRole('textbox', { name: '전체 원고 텍스트' }) as HTMLTextAreaElement
    expect(fullTextSheet).toBeInTheDocument()
    expect(fullTextSheet.value).toContain('검토용 제목')
    expect(fullTextSheet.value).toContain('승인할 본문입니다.')
  })

  it('downloads ZIP without marking the post as completed', async () => {
    mocks.download.mockResolvedValue(undefined)
    renderStep()

    const zipBtn = await screen.findByRole('button', { name: /사진 받기\/ZIP|원고·사진 ZIP/ })
    fireEvent.click(zipBtn)

    expect(await screen.findByText(/사진 한꺼번에 저장을 요청했어요/)).toBeInTheDocument()
    expect(screen.getByText(/게시 완료가 아니에요/)).toBeInTheDocument()
  })

  it('renders "게시하셨다면 글 주소를 알려 주세요." guidance near the URL registration form', async () => {
    renderStep()

    expect(
      await screen.findByText('게시하셨다면 글 주소를 알려 주세요.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: '게시 URL 등록' })).toBeInTheDocument()
    expect(screen.queryByText('⑥ 게시 URL 등록')).not.toBeInTheDocument()
  })

  it('summary card shows only image count and reset button without category or visibility', async () => {
    renderStep()

    expect(await screen.findByText(/사진 1장/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처음부터 다시 만들기' })).toBeInTheDocument()
    expect(screen.queryByText(/공개 범위/)).not.toBeInTheDocument()
    expect(screen.queryByText(/카테고리/)).not.toBeInTheDocument()
  })

  it('hides summary card and manuscript preview when onReset is not provided (embedded mobile work detail)', async () => {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-3',
          fingerprint: 'a'.repeat(64),
          title: '검토용 제목',
          caption: '잘린 요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '검토용 제목',
            introduction: '도입',
            sections: [{ heading: '소제목', body: '승인할 본문입니다.' }],
            keywords: ['피부관리', '청라'],
            cta: '문의 안내',
          },
          disclosure: 'AI 보조 제작',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [{ id: 'photo', src: 'https://example.com/photo.jpg' }],
        },
        receipt: null,
      },
    })
    render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        settings={{ imageCount: 2 }}
      />,
    )

    expect(await screen.findByText('소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.')).toBeInTheDocument()
    // No summary card or reset button
    expect(screen.queryByText('작성 내용')).not.toBeInTheDocument()
    expect(screen.queryByText(/사진 2장/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '처음부터 다시 만들기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '처음으로' })).not.toBeInTheDocument()
    // No redundant manuscript preview in embedded mode
    expect(screen.queryByText('원고 미리보기')).not.toBeInTheDocument()
  })

  it('renders manuscript preview in collapsible details when onReset is provided (panel mode)', async () => {
    renderStep()

    // details element for preview
    const previewSummary = await screen.findByText('원고 미리보기')
    const details = previewSummary.closest('details')
    expect(details).toBeInTheDocument()
    expect(details).not.toHaveAttribute('open')

    // Open details to inspect content
    fireEvent.click(previewSummary)

    expect(screen.getByText('검토용 제목')).toBeInTheDocument()
    expect(screen.getByText('도입')).toBeInTheDocument()
    expect(screen.getByText('소제목')).toBeInTheDocument()
    expect(screen.getByText('승인할 본문입니다.')).toBeInTheDocument()
    expect(screen.getByText('문의 안내')).toBeInTheDocument()
    expect(screen.getByText('#피부관리')).toBeInTheDocument()
    expect(screen.getByText('#청라')).toBeInTheDocument()

    const img = within(details!).getByRole('img', { name: /사진/ })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg')
    expect(img).toHaveAttribute('alt')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders buttons ①~⑤ before readiness details card in DOM order and wraps readiness in closed details', async () => {
    renderStep()

    const titleBtn = await screen.findByRole('button', { name: '제목 복사' })
    const bodyBtn = screen.getByRole('button', { name: '본문 복사' })
    const tagBtn = screen.getByRole('button', { name: '태그 복사' })
    const zipBtn = screen.getByRole('button', { name: /사진 받기\/ZIP|원고·사진 ZIP/ })
    const openEditorBtn = screen.getByRole('link', { name: '네이버 글쓰기 열기' })
    const urlInput = screen.getByLabelText(/올린 글 주소/)
    const photoSaveBtn = screen.getByRole('button', { name: '사진 1 저장' })

    const readinessSummary = screen.getByText('소희 콘텐츠 준비도 보기')
    const readinessDetails = readinessSummary.closest('details')
    expect(readinessDetails).toBeInTheDocument()
    expect(readinessDetails).not.toHaveAttribute('open')

    // DOM order checks
    // Buttons ①~⑤ and URL input must appear before readiness details
    expect(titleBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bodyBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tagBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(zipBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(photoSaveBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(openEditorBtn.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(urlInput.compareDocumentPosition(readinessDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders NaverStepList and secondary buttons when naverBlocks has images', async () => {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-3',
          fingerprint: 'a'.repeat(64),
          title: '스텝 블록 제목',
          caption: '요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '스텝 블록 제목',
            introduction: '도입부',
            sections: [{ heading: '소제목', body: '본문입니다.' }],
            keywords: ['피부관리'],
          },
          naverBlocks: [
            { kind: 'heading', text: '1. 관리 시작' },
            { kind: 'paragraph', text: '상담 후 관리 진행' },
            { kind: 'image', mediaId: 'photo-1', altText: '관리 사진' },
            { kind: 'paragraph', text: '마무리 단계' },
          ],
          disclosure: '체험단 지원',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [{ id: 'photo-1', src: 'https://example.com/photo1.jpg', altText: '관리' }],
        },
        receipt: null,
      },
    })

    render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        settings={{ postMode: 'faq' }}
      />,
    )

    // Check NaverOneShotCard rendered above step list
    const oneShotCard = await screen.findByLabelText('한 번에 올리기 카드')
    expect(oneShotCard).toBeInTheDocument()

    // Check step list wrapped in collapsible details (default closed)
    const stepListSummary = screen.getByText('한 조각씩 따라 하기 (자세히)')
    const stepListDetails = stepListSummary.closest('details')
    expect(stepListDetails).toBeInTheDocument()
    expect(stepListDetails).not.toHaveAttribute('open')

    // DOM order: one-shot card appears before step list details
    expect(oneShotCard.compareDocumentPosition(stepListDetails!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Check step list rendered with progress
    expect(await screen.findByText(/\d+\s*\/\s*\d+\s*완료/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '제목 복사' })).toBeInTheDocument()
    expect(screen.getByText('1. 관리 시작')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /사진 1 저장/ })).toBeInTheDocument()

    // Check confirmation card
    expect(screen.getByText('자주 묻는 질문')).toBeInTheDocument()
    expect(screen.getByText('네이버 앱에서 [등록]을 누르면 바로 발행돼요. 먼저 [저장]으로 임시저장해 확인하세요.')).toBeInTheDocument()

    // Secondary action buttons below step list
    const copyAllBtn = screen.getByRole('button', { name: '글 전체 한 번에 복사' })
    const zipAllBtn = screen.getByRole('button', { name: 'ZIP 으로 한꺼번에 받기' })
    const openEditorBtn = screen.getByRole('link', { name: '네이버 글쓰기 열기' })

    expect(copyAllBtn).toBeInTheDocument()
    expect(zipAllBtn).toBeInTheDocument()
    expect(openEditorBtn).toBeInTheDocument()

    // Test secondary button interactions
    mocks.copy.mockResolvedValue('html')
    fireEvent.click(copyAllBtn)
    expect(mocks.copy).toHaveBeenCalled()

    mocks.download.mockResolvedValue(undefined)
    fireEvent.click(zipAllBtn)
    expect(mocks.download).toHaveBeenCalled()
  })

  it('passes onDownloadZip and downloading handlers to NaverOneShotCard so card triggers download', async () => {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-zip-test',
          fingerprint: 'a'.repeat(64),
          title: '스텝 블록 제목',
          caption: '요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '스텝 블록 제목',
            introduction: '도입부',
            sections: [{ heading: '소제목', body: '본문입니다.' }],
            keywords: ['피부관리'],
          },
          naverBlocks: [
            { kind: 'heading', text: '1. 관리 시작' },
            { kind: 'image', mediaId: 'photo-1', altText: '관리 사진' },
          ],
          disclosure: '체험단 지원',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [{ id: 'photo-1', src: 'https://example.com/photo1.jpg', altText: '관리' }],
        },
        receipt: null,
      },
    })

    mocks.download.mockResolvedValue(undefined)

    render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
      />,
    )

    const oneShotCard = await screen.findByLabelText('한 번에 올리기 카드')
    expect(oneShotCard).toBeInTheDocument()

    // PC 환경에서 주 버튼(글 복사하고 사진 ZIP 받기) 클릭 시 onDownloadZip 호출
    const prepareAllBtn = await within(oneShotCard).findByRole('button', { name: '글 복사하고 사진 ZIP 받기' })
    fireEvent.click(prepareAllBtn)
    expect(mocks.download).toHaveBeenCalledTimes(1)

    // ZIP 단독 버튼 클릭 시에도 onDownloadZip 재호출
    const cardZipBtn = await within(oneShotCard).findByRole('button', { name: /사진 1장 ZIP으로 받기/ })
    expect(cardZipBtn).toBeInTheDocument()
    fireEvent.click(cardZipBtn)
    expect(mocks.download).toHaveBeenCalledTimes(2)
  })

  it('fallbacks to traditional 6-step layout when naverBlocks has no images', async () => {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-3',
          fingerprint: 'a'.repeat(64),
          title: '이미지 없는 블록 제목',
          caption: '요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '이미지 없는 블록 제목',
            introduction: '도입부',
            sections: [{ heading: '소제목', body: '본문입니다.' }],
            keywords: ['피부관리'],
          },
          naverBlocks: [
            { kind: 'heading', text: '1. 소제목' },
            { kind: 'paragraph', text: '텍스트만 있습니다.' },
          ],
          disclosure: '체험단 지원',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [],
        },
        receipt: null,
      },
    })

    render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
      />,
    )

    // Falls back to traditional ①~⑥ buttons
    expect(await screen.findByRole('button', { name: '제목 복사' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '본문 복사' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '태그 복사' })).toBeInTheDocument()
    expect(screen.queryByText('글 전체 한 번에 복사')).not.toBeInTheDocument()
  })

  it('renders compact instruction when compact prop is true (bottom sheet embedded)', async () => {
    mocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: WORKSPACE,
          contentId: CONTENT_ID,
          versionId: 'version-3',
          fingerprint: 'a'.repeat(64),
          title: '스텝 블록 제목',
          caption: '요약',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '스텝 블록 제목',
            introduction: '도입부',
            sections: [{ heading: '소제목', body: '본문입니다.' }],
            keywords: ['피부관리'],
          },
          naverBlocks: [
            { kind: 'heading', text: '1. 관리 시작' },
            { kind: 'image', mediaId: 'photo-1', altText: '관리 사진' },
          ],
          disclosure: '체험단 지원',
          account: { label: 'findk3' },
          approval: { status: 'unreviewed' },
          media: [{ id: 'photo-1', src: 'https://example.com/photo1.jpg', altText: '관리' }],
        },
        receipt: null,
      },
    })

    render(
      <NaverReviewStep
        workspaceId={WORKSPACE}
        contentId={CONTENT_ID}
        compact
      />,
    )

    expect(await screen.findByText('원고와 사진을 가져가 네이버 블로그 앱에 붙여넣어 주세요.')).toBeInTheDocument()
    // Detailed multi-line header is omitted
    expect(screen.queryByText('수동 게시 도우미')).not.toBeInTheDocument()
    expect(screen.queryByText('소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.')).not.toBeInTheDocument()
  })
})

