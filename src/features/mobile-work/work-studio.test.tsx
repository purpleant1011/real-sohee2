import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishingMocks = vi.hoisted(() => ({
  loadConversationPublishingAction: vi.fn(),
}))

vi.mock('@/features/chat/actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: publishingMocks.loadConversationPublishingAction,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (props: any) => <img {...props} alt={props.alt ?? ''} /> }))
vi.mock('next/navigation', () => ({ usePathname: () => '/app/work/c1', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
vi.mock('@/features/social-embed/embed-url', () => ({
  getEmbedUrl: vi.fn(() => null),
}))

import { WorkStudio } from './work-studio'
import type { ContentDetail } from '@/features/content/types'
import { getEmbedUrl } from '@/features/social-embed/embed-url'

const media = { id: 'img1', position: 0, mimeType: 'image/png', altText: '눈썹 시술 사진', role: 'cover', rightsStatus: 'confirmed' } as const
function detail(over: Partial<ContentDetail> = {}): ContentDetail {
  return {
    id: 'c1', title: '눈썹 문신 첫 고민', status: 'review', channel: 'instagram', currentVersionId: 'v2', currentVersionNumber: 2,
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', source: 'actual',
    versions: [
      { id: 'v2', versionNumber: 2, caption: '더 따뜻하게 고친 본문', hashtags: ['#눈썹', '#청라'], disclosure: '', fingerprint: 'f2', revisionReason: '더 따뜻하게', createdAt: '2026-11-02T00:00:00Z', rightsConfirmed: true, generationEvidenceConfirmed: true, mediaCount: 1, media: [media], structuredPayload: null, knowledgeIds: [], harnessRuleIds: [] },
      { id: 'v1', versionNumber: 1, caption: '처음 본문', hashtags: [], disclosure: '', fingerprint: 'f1', revisionReason: null, createdAt: '2026-11-01T00:00:00Z', rightsConfirmed: true, generationEvidenceConfirmed: true, mediaCount: 0, media: [], structuredPayload: null, knowledgeIds: [], harnessRuleIds: [] },
    ],
    ...over,
  } as ContentDetail
}
const ctx = { thread: { id: 't1', title: '눈썹 글 만들기' }, messages: [
  { id: 'm1', role: 'user' as const, text: '더 따뜻하게 써줘', at: '2026-11-02T00:00:00Z' },
  { id: 'm2', role: 'assistant' as const, text: '네, 고쳤어요', at: '2026-11-02T00:01:00Z' },
], livePost: null, historyError: false }

describe('WorkStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    publishingMocks.loadConversationPublishingAction.mockResolvedValue({
      data: {
        role: 'manager',
        preview: {
          workspaceId: 'ws',
          contentId: 'c1',
          versionId: 'v2',
          fingerprint: 'a'.repeat(64),
          title: '눈썹 문신 첫 고민',
          caption: '본문',
          channel: 'naver_blog',
          issues: [],
          naverCopy: {
            title: '눈썹 문신 첫 고민',
            introduction: '도입',
            sections: [{ heading: '소제목', body: '본문 내용' }],
            keywords: ['눈썹', '청라'],
            cta: '문의 안내',
          },
          disclosure: '',
          account: { label: 'store' },
          approval: { status: 'unreviewed' },
          media: [],
        },
        receipt: null,
      },
    })
  })

  it('기본은 미리보기: 채널 스타일로 본문·해시태그·사진을 보여 준다 (비네이버 채널에는 요약 카드와 시트 버튼 없음)', () => {
    render(<WorkStudio workspaceId="ws" detail={detail()} context={ctx} conversationEnabled />)
    expect(screen.getByRole('tab', { name: '미리보기' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Instagram 미리보기')).toBeInTheDocument()
    expect(screen.getByText('더 따뜻하게 고친 본문')).toBeInTheDocument()
    expect(screen.getByAltText('눈썹 시술 사진')).toHaveAttribute('src', '/api/workspaces/ws/media/img1')
    expect(screen.queryByText('네이버에 올릴 준비가 됐어요')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /네이버에 한 번에 올리기/ })).not.toBeInTheDocument()
    // 하단 고정바는 단일 "소희에게 추가 지시" 버튼만 있음
    expect(screen.getByRole('link', { name: /소희에게 추가 지시/ })).toHaveClass('w-full')
  })
  it('수정 이력 탭: 버전별 수정 사유가 최신순으로 보인다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail()} context={ctx} conversationEnabled />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '수정 이력' }))
    fireEvent.click(screen.getByRole('tab', { name: '수정 이력' }))
    const items = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(items[0]).toContain('v2'); expect(items[0]).toContain('더 따뜻하게'); expect(items[0]).toContain('현재')
    expect(items[1]).toContain('처음 만든 원고')
  })
  it('대화 탭: 사용자 지시와 소희 답변을 순서대로 보여 주고, 추가 지시는 이 원고를 달고 대화로 간다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail()} context={ctx} conversationEnabled />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '대화' }))
    fireEvent.click(screen.getByRole('tab', { name: '대화' }))
    expect(screen.getByText('더 따뜻하게 써줘')).toBeInTheDocument()
    expect(screen.getByText('네, 고쳤어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /추가 지시/ })).toHaveAttribute('href', '/app/conversations?workRef=v2')
  })
  it('읽어 확인된 게시 주소가 있을 때만 실제 게시물 보기를 낸다', () => {
    const { rerender } = render(<WorkStudio workspaceId="ws" detail={detail()} context={ctx} conversationEnabled />)
    expect(screen.queryByRole('link', { name: /실제 게시물/ })).toBeNull()
    rerender(<WorkStudio workspaceId="ws" detail={detail()} context={{ ...ctx, livePost: { url: 'https://www.instagram.com/p/x/', verifiedAt: '2026-11-02T03:00:00Z' } }} conversationEnabled />)
    expect(screen.getByRole('link', { name: /실제 게시물/ })).toHaveAttribute('href', 'https://www.instagram.com/p/x/')
  })
  it('임베드 가능한 게시 주소일 때는 LivePostEmbed가 접힌 카드 게시물 미리 보기로 노출된다', () => {
    vi.mocked(getEmbedUrl).mockReturnValueOnce({
      provider: 'instagram',
      src: 'https://www.instagram.com/p/x/embed',
    })
    render(<WorkStudio workspaceId="ws" detail={detail()} context={{ ...ctx, livePost: { url: 'https://www.instagram.com/p/x/', verifiedAt: '2026-11-02T03:00:00Z' } }} conversationEnabled />)
    expect(screen.getByRole('button', { name: /게시물 미리 보기/ })).toBeInTheDocument()
  })
  it('네이버 블로그 상세(currentVersionId 있음)는 최상단에 요약 카드가 있고 클릭 시 시트 안에서 NaverReviewStep이 열린다', async () => {
    render(<WorkStudio workspaceId="ws" detail={detail({ channel: 'naver_blog' })} context={ctx} conversationEnabled />)

    // 1. 요약 카드가 미리보기 위에 위치
    const summaryHeading = screen.getByText('네이버에 올릴 준비가 됐어요')
    const summaryCard = summaryHeading.closest('[data-slot="card"]') ?? summaryHeading
    const previewContainer = screen.getByLabelText('네이버 블로그 미리보기')
    expect(summaryCard.compareDocumentPosition(previewContainer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 2. 보조 문구 및 버튼
    expect(screen.getByText(/사진 1장 · 글과 사진을 한 번에 가져가서 붙여넣기만 하면 돼요/)).toBeInTheDocument()
    const openButtons = screen.getAllByRole('button', { name: /네이버에 한 번에 올리기/ })
    expect(openButtons.length).toBeGreaterThanOrEqual(2) // 요약 카드 버튼 + 하단 고정바 버튼

    // 3. 인라인 위치에는 NaverReviewStep이 없음 (시트 열기 전)
    expect(screen.queryByRole('heading', { name: '수동 게시 도우미' })).not.toBeInTheDocument()

    // 4. 하단 고정바: 가로 2버튼 (보조: 소희에게 추가 지시, 주: 네이버에 한 번에 올리기)
    expect(screen.getByRole('link', { name: /소희에게 추가 지시/ })).toBeInTheDocument()

    // 5. 버튼 클릭 시 시트가 열리고 NaverReviewStep 및 SheetTitle 확인
    fireEvent.click(openButtons[0])
    expect(await screen.findByRole('heading', { name: '네이버에 한 번에 올리기' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '본문 복사' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '네이버 글쓰기 열기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '공유하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '메일로 보내기' })).not.toBeInTheDocument()
  })

  it('네이버 블로그 상세 마운트 후 유휴 시점에 사전 준비를 위한 숨김 마운트가 동작한다', async () => {
    const { container } = render(<WorkStudio workspaceId="ws" detail={detail({ channel: 'naver_blog' })} context={ctx} conversationEnabled />)

    // setTimeout 0 또는 idle callback 후 hidden div 안에서 사전 로드/준비 컴포넌트가 마운트됨
    await vi.waitFor(() => {
      const hiddenPrefetchContainer = container.querySelector('div[hidden].hidden')
      expect(hiddenPrefetchContainer).toBeInTheDocument()
    })
  })

  it('하단 고정바의 네이버에 한 번에 올리기 버튼을 눌러도 시트가 열린다', async () => {
    render(<WorkStudio workspaceId="ws" detail={detail({ channel: 'naver_blog' })} context={ctx} conversationEnabled />)
    const openButtons = screen.getAllByRole('button', { name: /네이버에 한 번에 올리기/ })
    const bottomBarButton = openButtons[openButtons.length - 1]
    fireEvent.click(bottomBarButton)
    expect(await screen.findByRole('heading', { name: '네이버에 한 번에 올리기' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '본문 복사' })).toBeInTheDocument()
  })
  it('당근마켓 상세는 기존 ExportActions를 유지하여 공유하기/메일로 보내기가 노출된다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail({ channel: 'daangn_business' as never })} context={ctx} conversationEnabled />)
    expect(screen.getByRole('button', { name: '공유하기' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '메일로 보내기' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '네이버 글쓰기 열기' })).not.toBeInTheDocument()
  })
  it('네이버 블로그인데 currentVersionId가 없으면 NaverReviewStep 대신 기존 동작을 유지한다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail({ channel: 'naver_blog', currentVersionId: null, currentVersionNumber: null })} context={ctx} conversationEnabled />)
    expect(screen.queryByRole('link', { name: '네이버 글쓰기 열기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '공유하기' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '메일로 보내기' })).toBeInTheDocument()
  })
  it('현재 버전 지정이 없는 초안도 가장 최근 버전으로 미리보기를 그린다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail({ currentVersionId: null, currentVersionNumber: null, status: 'draft', channel: 'daangn_business' as never })} context={{ ...ctx, messages: [] }} conversationEnabled />)
    expect(screen.getByText('더 따뜻하게 고친 본문')).toBeInTheDocument()
  })
  it('대화 내역을 못 불러오면 비어 있다고 하지 않고 못 불러왔다고 말한다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail()} context={{ thread: null, messages: [], livePost: null, historyError: true }} conversationEnabled />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '대화' }))
    fireEvent.click(screen.getByRole('tab', { name: '대화' }))
    expect(screen.getByText(/대화 내역을 불러오지 못했어요/)).toBeInTheDocument()
  })
  it('표시할 버전 본문에 빈칸([이벤트 기간] 등)이 있으면 미리보기 상단에 PlaceholderNotice를 표시한다', () => {
    const detailWithPlaceholders = detail({
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          caption: '이벤트 안내\n기간: [이벤트 기간]\n문의: [문의 방법 또는 예약 방법]',
          hashtags: ['#이벤트'],
          disclosure: '',
          fingerprint: 'f2',
          revisionReason: null,
          createdAt: '2026-11-02T00:00:00Z',
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaCount: 1,
          media: [media],
          structuredPayload: null,
          knowledgeIds: [],
          harnessRuleIds: [],
        },
      ],
    })
    render(<WorkStudio workspaceId="ws" detail={detailWithPlaceholders} context={ctx} conversationEnabled />)
    expect(screen.getByText('채워야 할 곳이 2개 있어요')).toBeInTheDocument()
    expect(screen.getByText('[이벤트 기간]')).toBeInTheDocument()
    expect(screen.getByText('[문의 방법 또는 예약 방법]')).toBeInTheDocument()
    expect(screen.getByText('문구 다듬기로 내용을 알려 주시면 채워 드려요.')).toBeInTheDocument()
  })

  it('해시태그에 빈칸([매장명 입력] 등)이 포함된 경우에도 PlaceholderNotice를 표시한다', () => {
    const detailWithHashtagPlaceholders = detail({
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          caption: '정상 본문 내용입니다.',
          hashtags: ['#이벤트', '[매장명 입력]'],
          disclosure: '',
          fingerprint: 'f2',
          revisionReason: null,
          createdAt: '2026-11-02T00:00:00Z',
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaCount: 1,
          media: [media],
          structuredPayload: null,
          knowledgeIds: [],
          harnessRuleIds: [],
        },
      ],
    })
    render(<WorkStudio workspaceId="ws" detail={detailWithHashtagPlaceholders} context={ctx} conversationEnabled />)
    expect(screen.getByText('채워야 할 곳이 1개 있어요')).toBeInTheDocument()
    expect(screen.getByText('[매장명 입력]')).toBeInTheDocument()
  })

  it('info-request caption일 때 distinct notice를 표시하고 검토·승인하러 가기 링크를 숨긴다 (게시물이 아님)', () => {
    const detailWithInfoRequest = detail({
      channel: 'naver_blog',
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          caption:
            '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.',
          hashtags: [],
          disclosure: '',
          fingerprint: 'f2',
          revisionReason: null,
          createdAt: '2026-11-02T00:00:00Z',
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaCount: 0,
          media: [],
          structuredPayload: null,
          knowledgeIds: [],
          harnessRuleIds: [],
        },
      ],
    })
    render(<WorkStudio workspaceId="ws" detail={detailWithInfoRequest} context={ctx} conversationEnabled />)

    expect(
      screen.getByText('고객에게 보여줄 글이 아니라 소희의 정보 요청이에요.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('이벤트 정보를 알려주고 다시 만들어 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '검토·승인하러 가기' })).not.toBeInTheDocument()
  })

  it('네이버 블로그 버전에 structuredPayload.editorBlocks가 있으면 블록 순서대로 렌더링된다', () => {
    const naverDetail = detail({
      channel: 'naver_blog',
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          caption: 'SNS 요약 캡션',
          hashtags: ['#네이버', '#블로그'],
          disclosure: '',
          fingerprint: 'f2',
          revisionReason: null,
          createdAt: '2026-11-02T00:00:00Z',
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaCount: 1,
          media: [media],
          structuredPayload: {
            channel: 'naver_blog',
            title: '눈썹 문신 첫 고민',
            introduction: '도입부',
            sections: [{ heading: '소제목', body: '본문 내용' }],
            keywords: ['눈썹', '청라'],
            imagePlacements: [{ mediaId: 'img1', placement: 'cover', altText: '눈썹 시술 사진' }],
            cta: '문의 안내',
            editorBlocks: [
              { kind: 'paragraph', text: '첫 문단입니다.' },
              { kind: 'image', mediaId: 'img1', altText: '눈썹 시술 사진' },
              { kind: 'heading', text: '소제목 블록' },
            ],
          },
          knowledgeIds: [],
          harnessRuleIds: [],
        },
      ],
    })
    render(<WorkStudio workspaceId="ws" detail={naverDetail} context={ctx} conversationEnabled />)
    expect(screen.getByText('첫 문단입니다.')).toBeInTheDocument()
    expect(screen.getByText('소제목 블록')).toBeInTheDocument()
    expect(screen.getByAltText('눈썹 시술 사진')).toHaveAttribute('src', '/api/workspaces/ws/media/img1')
  })

  it('헤더 뱃지와 탭 트리거가 모바일 터치 및 레이아웃 무결성(44px, shrink-0, break-keep)을 준수한다', () => {
    render(<WorkStudio workspaceId="ws" detail={detail()} context={ctx} conversationEnabled />)
    const channelBadge = screen.getAllByText('Instagram')[0]
    expect(channelBadge.className).toContain('shrink-0')
    expect(channelBadge.className).toContain('whitespace-nowrap')

    const statusBadge = screen.getByText('검토 중')
    expect(statusBadge.className).toContain('shrink-0')
    expect(statusBadge.className).toContain('whitespace-nowrap')

    const heading = screen.getByRole('heading', { level: 1, name: '눈썹 문신 첫 고민' })
    expect(heading.className).toContain('break-keep')

    const tabTriggers = screen.getAllByRole('tab')
    for (const tab of tabTriggers) {
      expect(tab.className).toContain('min-h-11')
    }
  })
})

