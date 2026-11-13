import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelLearningPanel } from './channel-learning-panel'
import * as hookModule from '../use-channel-learning'
import type { Capability, LearningCandidate, LearningSource } from '../contracts'

describe('ChannelLearningPanel', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'

  it('가게 정보의 모바일 학습 입력과 단계 버튼은 최소 44px 터치 영역을 유지한다', () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage />)
    expect(screen.getByLabelText('채널 주소')).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: '채널 등록하기' })).toHaveClass('min-h-11')
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11')
    expect(screen.getByRole('region', { name: '공식 채널 지식 학습' })).not.toHaveTextContent(/\bSNS\b/)
  })

  const mockCapabilities: Capability[] = [
    {
      platform: 'instagram',
      verificationMethods: ['oauth', 'profile_marker'],
      collectionMode: 'official_api',
      blockerCode: null,
    },
    {
      platform: 'threads',
      verificationMethods: ['oauth', 'profile_marker'],
      collectionMode: 'official_api',
      blockerCode: null,
    },
    {
      platform: 'naver_blog',
      verificationMethods: [],
      collectionMode: 'manual_only',
      blockerCode: 'MANUAL_ONLY_POLICY',
    },
    {
      platform: 'daangn_business',
      verificationMethods: [],
      collectionMode: 'blocked',
      blockerCode: 'PARTNER_API_UNAVAILABLE',
    },
    {
      platform: 'website',
      verificationMethods: ['dns_txt'],
      collectionMode: 'blocked',
      blockerCode: 'PUBLIC_SCRAPE_PROHIBITED',
    },
  ]

  const mockSource: LearningSource = {
    workspaceId,
    sourceId: 'src-1',
    revision: 1,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/my_shop',
    canonicalIdentity: 'my_shop',
    verification: 'verified',
    collection: 'review_required',
    lease: {
      workspaceId,
      sourceId: 'src-1',
      revision: 1,
      providerAccountId: 'ig-1',
      method: 'oauth',
      verifiedAt: '2026-11-10T00:00:00.000Z',
      expiresAt: '2026-11-11T00:00:00.000Z',
      revokedAt: null,
      evidenceRevision: 1,
    },
    consent: {
      text: true,
      images: false,
      revision: 1,
    },
    deletedAt: null,
  }

  const mockCandidate: LearningCandidate = {
    id: 'cand-1',
    source: {
      workspaceId,
      sourceId: 'src-1',
      revision: 1,
    },
    version: 1,
    category: 'business',
    content: '반려동물 동반 가능한 디저트 카페입니다.',
    evidence: {
      documentId: 'doc-1',
      excerpt: '반려견 동반 가능 카페',
      visionReceiptId: null,
    },
    evidenceState: 'observed',
    status: 'review_required',
    conflictsWithFactId: null,
  }

  let mockHookValues: ReturnType<typeof hookModule.useChannelLearning>

  beforeEach(() => {
    vi.clearAllMocks()

    mockHookValues = {
      sources: [mockSource],
      capabilities: mockCapabilities,
      isLoading: false,
      error: null,
      errorCode: null,
      refresh: vi.fn(),
      addSource: vi.fn().mockResolvedValue({ success: true, source: mockSource }),
      verifySource: vi.fn().mockResolvedValue({ success: true }),
      startCollection: vi.fn().mockResolvedValue({ success: true, jobId: 'job-1' }),
      cancelSource: vi.fn().mockResolvedValue({ success: true }),
      deleteSource: vi.fn().mockResolvedValue({ success: true }),
      reviewCandidates: vi.fn().mockResolvedValue({ success: true }),
      fetchSourceDetail: vi.fn().mockResolvedValue({
        source: mockSource,
        candidates: [mockCandidate],
        jobs: [],
      }),
    }

    vi.spyOn(hookModule, 'useChannelLearning').mockImplementation(() => mockHookValues)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('헤더, 채널 등록 폼, 등록된 출처 목록을 올바르게 렌더링한다', () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    expect(screen.getByRole('heading', { name: '공식 채널 지식 학습' })).toBeInTheDocument()
    expect(screen.getByText(/사장님의 공식 계정에서 가게 정보와 말투/)).toBeInTheDocument()
    expect(screen.getByLabelText(/채널 주소/)).toBeInTheDocument()
    expect(screen.getByText('https://instagram.com/my_shop')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '채널 등록하기' })).toBeInTheDocument()
  })

  it('차단된 플랫폼(당근마켓) URL 입력 시 자동 수집 차단 안내를 띄우고 등록을 막는다', async () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const urlInput = screen.getByLabelText(/채널 주소/)
    fireEvent.change(urlInput, { target: { value: 'https://daangn.com/business/cafe' } })

    expect(
      screen.getByText(/이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '채널 등록하기' })).toBeDisabled()
  })

  it('네이버 블로그 URL 입력 시 자동 수집 대신 수동 확인 안내를 표시한다', async () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const urlInput = screen.getByLabelText(/채널 주소/)
    fireEvent.change(urlInput, { target: { value: 'https://blog.naver.com/my_cafe' } })

    expect(
      screen.getByText(/네이버는 정책상 자동 수집을 지원하지 않으며/),
    ).toBeInTheDocument()
  })

  it('필수 텍스트 동의를 체크하고 등록하면 addSource가 호출된다', async () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const urlInput = screen.getByLabelText(/채널 주소/)
    fireEvent.change(urlInput, { target: { value: 'https://instagram.com/new_cafe' } })

    const textConsent = screen.getByLabelText(/게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다/)
    expect(textConsent).not.toBeChecked() // 기본 false로 미체크됨
    fireEvent.click(textConsent) // 사용자 명시 체크

    const submitBtn = screen.getByRole('button', { name: '채널 등록하기' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHookValues.addSource).toHaveBeenCalledWith({
        platform: 'instagram',
        url: 'https://instagram.com/new_cafe',
        consent: { text: true, images: false },
      })
    })
  })

  it('지식 검토하기 버튼 클릭 시 상세 지식 후보를 불러와 다이얼로그를 연다', async () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const reviewBtn = screen.getByRole('button', { name: '지식 검토하기' })
    fireEvent.click(reviewBtn)

    await waitFor(() => {
      expect(mockHookValues.fetchSourceDetail).toHaveBeenCalledWith('src-1')
      expect(screen.getByText('반려동물 동반 가능한 디저트 카페입니다.')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '지식 검토 및 승인' })).toBeInTheDocument()
    })
  })

  it('canManage가 false이면 보기 권한 안내가 노출되고 등록 버튼이 비활성화된다', () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={false} />)

    expect(screen.getByText(/보기 권한은 채널을 등록하거나 수정할 수 없습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '채널 등록하기' })).toBeDisabled()
  })

  it('에러가 있는 경우 안전한 한국어 에러를 노출하고 원시 코드나 크레딧 숫자를 숨긴다', () => {
    mockHookValues.error = '지식 정보가 변경되어 최신 상태가 아닙니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'

    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    expect(
      screen.getByText(/지식 정보가 변경되어 최신 상태가 아닙니다/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/credit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument()
  })

  it('모바일 탭을 전환하면 aria-selected와 data-state가 갱신된다', () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const tabRegister = screen.getByRole('tab', { name: '1. 채널 등록' })
    const tabList = screen.getByRole('tab', { name: /2. 학습 현황/ })

    expect(tabRegister).toHaveAttribute('aria-selected', 'true')
    expect(tabRegister).toHaveAttribute('data-state', 'active')
    expect(tabList).toHaveAttribute('aria-selected', 'false')
    expect(tabList).toHaveAttribute('data-state', 'inactive')

    fireEvent.click(tabList)

    expect(tabRegister).toHaveAttribute('aria-selected', 'false')
    expect(tabRegister).toHaveAttribute('data-state', 'inactive')
    expect(tabList).toHaveAttribute('aria-selected', 'true')
    expect(tabList).toHaveAttribute('data-state', 'active')
  })

  it('모바일 탭에서 ArrowRight/ArrowLeft 키 입력 시 탭 전환 및 포커스가 이동한다', () => {
    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    const tabRegister = screen.getByRole('tab', { name: '1. 채널 등록' })
    const tabList = screen.getByRole('tab', { name: /2. 학습 현황/ })

    fireEvent.keyDown(tabRegister, { key: 'ArrowRight' })
    expect(tabList).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(tabList, { key: 'ArrowLeft' })
    expect(tabRegister).toHaveAttribute('aria-selected', 'true')
  })

  it('리뷰 다이얼로그가 열려 있을 때 workspaceId가 변경되면 다이얼로그가 즉시 닫힌다 (source 오염 방지)', async () => {
    const { rerender } = render(
      <ChannelLearningPanel workspaceId={workspaceId} canManage={true} />,
    )

    const reviewBtn = screen.getByRole('button', { name: '지식 검토하기' })
    fireEvent.click(reviewBtn)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '지식 검토 및 승인' })).toBeInTheDocument()
    })

    // 워크스페이스 변경
    rerender(
      <ChannelLearningPanel workspaceId="other-workspace-id" canManage={true} />,
    )

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '지식 검토 및 승인' })).not.toBeInTheDocument()
    })
  })

  it('CONNECTION_REQUIRED 에러 발생 시 채널 연결 관리로 이동 링크를 제공한다', () => {
    mockHookValues.error = '채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.'
    mockHookValues.errorCode = 'CONNECTION_REQUIRED'

    render(<ChannelLearningPanel workspaceId={workspaceId} canManage={true} />)

    expect(
      screen.getByText(/채널 연결이 필요해요/),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /채널 연결 관리로 이동/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/app/channels')
  })
})
