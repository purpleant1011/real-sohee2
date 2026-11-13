// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MobileChannelsView, type ChannelsViewSnapshot } from '../channels-view'
import type { MobileChannelDto } from '../channel-readiness'
import * as hookModule from '@/features/channel-learning/use-channel-learning'
import type { Capability, LearningSource } from '@/features/channel-learning/contracts'

function ch(overrides: Partial<MobileChannelDto> = {}): MobileChannelDto {
  return {
    id: 'instagram',
    level: 'publish_verified',
    publishSupported: true,
    expired: false,
    restricted: false,
    needsExternalCheck: false,
    requiresDesktopConnector: false,
    connectedAccountMatches: true,
    lastCheckedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<ChannelsViewSnapshot> = {}): ChannelsViewSnapshot {
  return {
    loadState: 'ready',
    channels: [
      ch(),
      ch({ id: 'threads', level: 'account_connected' }),
    ],
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

describe('MobileChannelsView 채널 지식 학습 연동', () => {
  const workspaceId = 'ws-learning-test-456'

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
  ]

  const mockSource: LearningSource = {
    workspaceId,
    sourceId: 'src-test-1',
    revision: 1,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/my_shop',
    canonicalIdentity: 'my_shop',
    verification: 'verified',
    collection: 'review_required',
    lease: null,
    consent: {
      text: true,
      images: false,
      revision: 1,
    },
    deletedAt: null,
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
        candidates: [],
        jobs: [],
      }),
    }

    vi.spyOn(hookModule, 'useChannelLearning').mockImplementation(() => mockHookValues)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('workspaceId가 전달되어도 모바일 채널 연결 화면에서는 "소희에게 내 채널 가르치기" 및 학습 패널이 렌더링되지 않아야 한다 (가게 정보 메뉴로 이전)', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} workspaceId={workspaceId} />)

    expect(screen.queryByRole('heading', { name: '소희에게 내 채널 가르치기' })).not.toBeInTheDocument()
    expect(screen.queryByText(/소희에게 내 채널 가르치기/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/채널 주소/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '채널 등록하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '공식 채널 지식 학습' })).not.toBeInTheDocument()
  })

  it('workspaceId가 없을 때도 "소희에게 내 채널 가르치기" 섹션과 학습 패널이 렌더링되지 않는다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} />)

    expect(screen.queryByRole('heading', { name: '소희에게 내 채널 가르치기' })).not.toBeInTheDocument()
    expect(screen.queryByText(/소희에게 내 채널 가르치기/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/채널 주소/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '채널 등록하기' })).not.toBeInTheDocument()
  })

  it('채널 목록이 정상적으로 렌더링되고 학습 패널은 채널 목록에 포함되지 않는다', () => {
    render(<MobileChannelsView snapshot={makeSnapshot()} workspaceId={workspaceId} />)

    // 상단 채널 목록 영역 존재 확인
    const channelList = screen.getByRole('list', { name: '연결 채널' })
    expect(channelList).toBeInTheDocument()
    expect(within(channelList).getByText('인스타그램')).toBeInTheDocument()
    expect(within(channelList).getByText('스레드')).toBeInTheDocument()

    // 지식 학습 영역 부재 확인
    expect(screen.queryByRole('heading', { level: 2, name: '소희에게 내 채널 가르치기' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/채널 주소/)).not.toBeInTheDocument()
  })
})
