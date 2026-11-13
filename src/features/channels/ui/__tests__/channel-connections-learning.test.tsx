import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChannelConnections } from '../channel-connections'
import type { Capability, LearningSource } from '@/features/channel-learning/contracts'

const workspaceId = 'ws-learning-test-123'

const verifiedInstagram = {
  status: 'VERIFIED',
  verified: true,
  username: '@my_sweet_bakery',
}

const disconnectedThreads = {
  status: 'NOT_CONNECTED',
  verified: false,
}

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

const mockRegisteredSource: LearningSource = {
  workspaceId,
  sourceId: 'src-insta-001',
  revision: 1,
  platform: 'instagram',
  canonicalUrl: 'https://instagram.com/my_sweet_bakery',
  canonicalIdentity: 'my_sweet_bakery',
  verification: 'verified',
  collection: 'review_required',
  lease: {
    workspaceId,
    sourceId: 'src-insta-001',
    revision: 1,
    providerAccountId: 'ig-acc-001',
    method: 'oauth',
    verifiedAt: '2026-11-10T00:00:00.000Z',
    expiresAt: '2026-11-17T00:00:00.000Z',
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/app/channels')
})

function setupFetchMock({
  hasWorkspaceId = true,
  sources = [] as LearningSource[],
  capabilities = mockCapabilities,
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url === '/api/channels') {
      return {
        ok: true,
        json: async () => ({
          workspaceId: hasWorkspaceId ? workspaceId : undefined,
          extendedScopesAllowed: false,
          instagram: verifiedInstagram,
          threads: disconnectedThreads,
        }),
      } as Response
    }

    if (url === '/api/channels/credentials') {
      return {
        ok: true,
        json: async () => ({
          connections: [
            {
              channel: 'instagram',
              status: 'connected',
              account_label: '@my_sweet_bakery',
            },
          ],
        }),
      } as Response
    }

    if (url.includes('/quick-post')) {
      return {
        ok: true,
        json: async () => ({ items: [] }),
      } as Response
    }

    if (url === `/api/workspaces/${workspaceId}/knowledge/channels`) {
      return {
        ok: true,
        json: async () => ({
          sources,
          capabilities,
        }),
      } as Response
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ChannelConnections - 채널 연결 화면에서 채널 학습 패널 분리 검증', () => {
  it('채널 연결 화면에서는 공식 채널 지식 학습 섹션 및 ChannelLearningPanel이 렌더링되지 않아야 한다 (가게 정보 메뉴로 이전)', async () => {
    setupFetchMock({ hasWorkspaceId: true, sources: [mockRegisteredSource] })

    render(<ChannelConnections />)

    // 인스타그램 연결 카드가 렌더링될 때까지 대기
    await screen.findByRole('article', { name: '인스타그램' })

    // 공식 채널 지식 학습 섹션 및 패널이 채널 연결 화면에 없어야 함
    expect(
      screen.queryByRole('region', { name: '공식 채널 지식 학습' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '소희에게 내 채널 가르치기' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '공식 채널 지식 학습' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('채널 주소 (URL)'),
    ).not.toBeInTheDocument()
  })

  it('workspaceId 유무와 관계없이 채널 연결 화면에 학습 패널이 노출되지 않는다', async () => {
    setupFetchMock({ hasWorkspaceId: false })

    render(<ChannelConnections />)

    await screen.findByRole('article', { name: '인스타그램' })

    expect(
      screen.queryByRole('region', { name: '공식 채널 지식 학습' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '소희에게 내 채널 가르치기' }),
    ).not.toBeInTheDocument()
  })
})
