import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createVersionAction: vi.fn(),
  reviseContentAction: vi.fn(),
  generateContentImageAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('./actions/create-version', () => ({ createVersionAction: mocks.createVersionAction }))
vi.mock('./actions/revise-content', () => ({ reviseContentAction: mocks.reviseContentAction }))
vi.mock('./actions/generate-content-image', () => ({
  generateContentImageAction: mocks.generateContentImageAction,
}))
vi.mock('./actions/create-item', () => ({ createContentItemAction: vi.fn() }))
vi.mock('./actions/upload-content-media', () => ({ uploadContentMediaAction: vi.fn() }))

import { ContentEditor } from './content-editor'
import { NewContentForm } from './new-content-form'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const contentId = '30000000-0000-4000-8000-000000000001'

function renderEditor() {
  return render(
    <ContentEditor
      workspaceId={workspaceId}
      detail={{
        id: contentId,
        title: '가을 캠페인',
        status: 'review',
        channel: 'instagram',
        currentVersionId: '40000000-0000-4000-8000-000000000001',
        currentVersionNumber: 1,
        createdAt: '2026-08-09T01:00:00.000Z',
        updatedAt: '2026-08-09T05:00:00.000Z',
        source: 'actual',
        versions: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            versionNumber: 1,
            caption: '기존 문구',
            hashtags: ['#가을'],
            disclosure: '모의 생성 콘텐츠입니다.',
            fingerprint: 'a'.repeat(64),
            revisionReason: '첫 버전',
            createdAt: '2026-08-09T05:00:00.000Z',
            rightsConfirmed: true,
            generationEvidenceConfirmed: true,
            mediaCount: 1,
            media: [],
            structuredPayload: null,
            knowledgeIds: [],
            harnessRuleIds: [],
          },
        ],
      }}
      media={[
        {
          id: '50000000-0000-4000-8000-000000000001',
          mimeType: 'image/png',
          sizeBytes: 2048,
          createdAt: '2026-08-09T04:00:00.000Z',
        },
      ]}
    />,
  )
}

function renderNaverEditor() {
  const mediaId = '50000000-0000-4000-8000-000000000001'
  return render(<ContentEditor workspaceId={workspaceId} detail={{
    id: contentId, title: '네이버 상담 기준', status: 'review', channel: 'naver_blog',
    currentVersionId: '40000000-0000-4000-8000-000000000002', currentVersionNumber: 1,
    createdAt: '2026-08-09T01:00:00.000Z', updatedAt: '2026-08-09T05:00:00.000Z', source: 'actual',
    versions: [{
      id: '40000000-0000-4000-8000-000000000002', versionNumber: 1,
      caption: '기존 네이버 본문', hashtags: ['#바이름'], disclosure: '확인된 정보만 사용했습니다.',
      fingerprint: 'b'.repeat(64), revisionReason: '첫 버전', createdAt: '2026-08-09T05:00:00.000Z',
      rightsConfirmed: true, generationEvidenceConfirmed: true, mediaCount: 1,
      media: [{ id: mediaId, position: 1, mimeType: 'image/png', altText: '상담 표지', role: 'cover', rightsStatus: 'confirmed' }],
      structuredPayload: {
        channel: 'naver_blog', title: '네이버 상담 기준', introduction: '기존 네이버 본문',
        sections: [{ heading: '확인 기준', body: '충분히 상담합니다.' }], keywords: ['바이름'],
        imagePlacements: [{ mediaId, placement: 'cover', altText: '상담 표지' }],
        cta: '상담을 신청해 주세요.', visibility: 'private',
      },
      knowledgeIds: [], harnessRuleIds: [],
    }],
  }} media={[{ id: mediaId, mimeType: 'image/png', sizeBytes: 2048, createdAt: '2026-08-09T04:00:00.000Z' }]} />)
}

describe('ContentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reviseContentAction.mockResolvedValue({
      data: {
        source: 'gemini',
        caption: 'AI가 다듬은 문구',
        hashtags: ['#소희', '#가을'],
        disclosure: 'AI 생성 결과를 검토했습니다.',
        revisionReason: '소희 AI 수정',
      },
    })
    mocks.generateContentImageAction.mockResolvedValue({
      data: {
        source: 'openai',
        assetId: '60000000-0000-4000-8000-000000000001',
        rightsStatus: 'confirmed',
      },
    })
  })

  it('상단에 사장님 친화적 문구 "글 확인하기"가 표시되고 영문 "IMMUTABLE EDITOR"는 표시되지 않는다', () => {
    renderEditor()
    expect(screen.getByText('글 확인하기')).toBeInTheDocument()
    expect(screen.queryByText('IMMUTABLE EDITOR')).not.toBeInTheDocument()
  })

  it('keeps AI generation, direct save, rights, evidence, and media in one decision flow', () => {
    renderEditor()

    expect(screen.getByText('현재 v1에서 새 버전 만들기')).toBeInTheDocument()
    expect(screen.getByLabelText('본문 문구')).toHaveValue('기존 문구')
    expect(screen.getByRole('heading', { name: '소희 AI 생성' })).toBeInTheDocument()
    expect(screen.getByText('AI 결과는 검토 후 새 버전으로 저장됩니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '소희 AI 수정' })).toBeInTheDocument()
    expect(screen.getByLabelText('이미지 생성 지시')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '소희 이미지 생성' })).toBeInTheDocument()
    expect(screen.getByLabelText(/PNG · 2 KB/)).toBeInTheDocument()
    expect(screen.getByLabelText('새 미디어 파일')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '검증하고 업로드' })).toBeInTheDocument()
    expect(screen.getByLabelText('미디어 사용권을 확인했습니다.')).toBeInTheDocument()
    expect(screen.getByLabelText('생성 과정과 내용을 확인했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 버전으로 저장' })).toBeInTheDocument()
  })

  it('fills reviewed results without automatically creating a version', async () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText('수정 지시'), {
      target: { value: '더 따뜻하고 간결하게 다듬어 줘.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희 AI 수정' }))

    await waitFor(() => expect(screen.getByLabelText('본문 문구')).toHaveValue('AI가 다듬은 문구'))
    expect(mocks.reviseContentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        currentCaption: '기존 문구',
        currentHashtags: ['#가을'],
        currentDisclosure: '모의 생성 콘텐츠입니다.',
      }),
    )
    expect(screen.getByLabelText('해시태그')).toHaveValue('#소희 #가을')
    expect(screen.getByLabelText('필수 고지')).toHaveValue('AI 생성 결과를 검토했습니다.')
    expect(screen.getByLabelText('수정 이유')).toHaveValue('소희 AI 수정')
    expect(mocks.createVersionAction).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('이미지 생성 지시'), {
      target: { value: '따뜻한 가을 캠페인 정사각 이미지' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희 이미지 생성' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('목록에서 선택')
    expect(mocks.createVersionAction).not.toHaveBeenCalled()
  })

  it('offers and saves a mutual-neighbor Naver version', async () => {
    renderNaverEditor()
    fireEvent.click(screen.getByRole('radio', { name: /^서로이웃공개/ }))
    expect(screen.getByRole('radio', { name: /^서로이웃공개/ })).toBeChecked()
  })

  it('creates a new exact Naver version with the selected public visibility', async () => {
    mocks.createVersionAction.mockResolvedValue({ data: { versionId: '40000000-0000-4000-8000-000000000003', versionNumber: 2 } })
    renderNaverEditor()

    expect(screen.getByRole('radio', { name: /^비공개/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /^공개/ }))
    fireEvent.change(screen.getByLabelText('수정 이유'), { target: { value: '네이버 공개 게시 승인용' } })
    fireEvent.click(screen.getByLabelText('미디어 사용권을 확인했습니다.'))
    fireEvent.click(screen.getByLabelText('생성 과정과 내용을 확인했습니다.'))
    fireEvent.click(screen.getByRole('button', { name: '새 버전으로 저장' }))

    await waitFor(() => expect(mocks.createVersionAction).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'naver_blog',
      mediaIds: ['50000000-0000-4000-8000-000000000001'],
      structuredPayload: expect.objectContaining({ channel: 'naver_blog', visibility: 'public' }),
    })))
  })
})

describe('NewContentForm', () => {
  it('creates a safe draft before the first immutable version', () => {
    render(<NewContentForm workspaceId={workspaceId} />)

    expect(screen.getByRole('heading', { name: '새 콘텐츠 시작' })).toBeInTheDocument()
    expect(screen.getByLabelText('작업 제목')).toBeInTheDocument()
    expect(screen.getByLabelText('게시 채널')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '초안 만들기' })).toBeInTheDocument()
  })
})
