import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChannelLearning } from './use-channel-learning'
import type { Capability, LearningCandidate, LearningSource } from './contracts'

describe('useChannelLearning', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const otherWorkspaceId = '20000000-0000-4000-8000-000000000002'
  let mockFetch: ReturnType<typeof vi.fn>

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
    sourceId: 'src-0000-0000-0000-000000000001',
    revision: 1,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/my_store',
    canonicalIdentity: 'my_store',
    verification: 'verified',
    collection: 'review_required',
    lease: {
      workspaceId,
      sourceId: 'src-0000-0000-0000-000000000001',
      revision: 1,
      providerAccountId: 'ig-12345',
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
    id: 'cand-0000-0000-0000-000000000001',
    source: {
      workspaceId,
      sourceId: mockSource.sourceId,
      revision: 1,
    },
    version: 1,
    category: 'hours',
    content: '매일 11:00 ~ 21:00 영업합니다.',
    evidence: {
      documentId: 'doc-0000-0000-0000-000000000001',
      excerpt: '프로필 영업시간: 11:00-21:00',
      visionReceiptId: null,
    },
    evidenceState: 'observed',
    status: 'review_required',
    conflictsWithFactId: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'

      if (url === `/api/workspaces/${workspaceId}/knowledge/channels` && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [mockSource],
            capabilities: mockCapabilities,
          }),
        }
      }

      if (url === `/api/workspaces/${otherWorkspaceId}/knowledge/channels` && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [],
            capabilities: mockCapabilities,
          }),
        }
      }

      if (url === `/api/workspaces/${workspaceId}/knowledge/channels` && method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            source: { ...mockSource, sourceId: 'src-0000-0000-0000-000000000002' },
          }),
        }
      }

      if (url.includes(`/api/workspaces/${workspaceId}/knowledge/channels/${mockSource.sourceId}`) && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            source: mockSource,
            candidates: [mockCandidate],
            jobs: [],
          }),
        }
      }

      if (url.includes('/verify') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            source: { ...mockSource, verification: 'verified' },
          }),
        }
      }

      if (url.includes('/collect') && method === 'POST') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: 'job-1',
            state: 'queued',
          }),
        }
      }

      if (url.includes('/review') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
          }),
        }
      }

      if (url.includes(mockSource.sourceId) && method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            source: { ...mockSource, collection: 'cancelled' },
          }),
        }
      }

      if (url.includes(mockSource.sourceId) && method === 'DELETE') {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            deletionJobId: 'del-job-1',
            status: 'pending',
          }),
        }
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not_found' }),
      }
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('초기 마운트 시 채널 출처 목록과 capability를 불러온다', async () => {
    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: true }),
    )

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.sources).toEqual([mockSource])
    expect(result.current.capabilities).toEqual(mockCapabilities)
    expect(result.current.error).toBeNull()
  })

  it('workspaceId가 변경되면 이전 응답을 무시하고 새 워크스페이스 데이터를 조회한다 (stale response 방지)', async () => {
    let resolveFirstFetch: (val: any) => void = () => {}
    const slowPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve
    })

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes(workspaceId)) {
        await slowPromise
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [mockSource],
            capabilities: mockCapabilities,
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sources: [],
          capabilities: mockCapabilities,
        }),
      }
    })

    const { result, rerender } = renderHook(
      ({ wsId }) => useChannelLearning({ workspaceId: wsId, canManage: true }),
      { initialProps: { wsId: workspaceId } },
    )

    // 즉시 워크스페이스를 변경
    rerender({ wsId: otherWorkspaceId })

    await waitFor(() => {
      expect(result.current.sources).toEqual([])
    })

    // 이전 워크스페이스 응답이 뒤늦게 오더라도 무시되어야 함
    resolveFirstFetch(null)

    await waitFor(() => {
      expect(result.current.sources).toEqual([])
    })
  })

  it('canManage가 false인 경우 변경 액션을 거부한다', async () => {
    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: false }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      const res = await result.current.addSource({
        platform: 'instagram',
        url: 'https://instagram.com/my_store',
        consent: { text: true, images: false },
      })
      expect(res.success).toBe(false)
      expect(res.error).toBe('채널 정보를 변경할 권한이 없습니다.')
    })

    expect(result.current.error).toBe('채널 정보를 변경할 권한이 없습니다.')
  })

  it('addSource 성공 시 새 출처를 등록하고 콜백을 호출한다', async () => {
    const onKnowledgeUpdated = vi.fn()
    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: true, onKnowledgeUpdated }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      const res = await result.current.addSource({
        platform: 'instagram',
        url: 'https://instagram.com/my_store',
        consent: { text: true, images: false },
      })
      expect(res.success).toBe(true)
    })

    expect(onKnowledgeUpdated).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/knowledge/channels`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          platform: 'instagram',
          url: 'https://instagram.com/my_store',
          consent: { text: true, images: false },
        }),
      }),
    )
  })

  it('reviewCandidates가 409 stale conflict를 반환하면 안전한 한국어 에러를 노출하고 provider 오류를 숨긴다', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/review')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: 'STALE_REVISION',
              message: 'Raw provider secret or internal mismatch: FB_TOKEN_REVOKED',
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sources: [mockSource], capabilities: mockCapabilities }),
      }
    })

    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: true }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      const res = await result.current.reviewCandidates({
        sourceId: mockSource.sourceId,
        revision: 1,
        evidenceRevision: 1,
        decisions: [
          {
            candidateId: mockCandidate.id,
            version: 1,
            decision: 'approved',
          },
        ],
      })
      expect(res.success).toBe(false)
    })

    // 안전한 한국어 에러 메시지 검증 (내부 provider secret이나 영어 코드 없음)
    expect(result.current.error).not.toContain('FB_TOKEN_REVOKED')
    expect(result.current.error).toContain('최신 상태가 아닙니다')
  })

  it('OAuth 미연결 상태에서 본인 확인 시 409 CONNECTION_REQUIRED를 감지하고 채널 연결 안내를 반환한다', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.includes('/verify')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: 'CONNECTION_REQUIRED',
              message: 'Instagram account connection required for OAuth verification',
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sources: [mockSource], capabilities: mockCapabilities }),
      }
    })

    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: true }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      const res = await result.current.verifySource({
        sourceId: mockSource.sourceId,
        revision: 1,
      })
      expect(res.success).toBe(false)
      expect(res.code).toBe('CONNECTION_REQUIRED')
      expect(res.error).toBe('채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.')
    })

    expect(result.current.error).toBe('채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.')
    expect(result.current.errorCode).toBe('CONNECTION_REQUIRED')
    expect(result.current.error).not.toContain('Instagram account connection required')
  })

  it('cancelSource 및 deleteSource 실패(403/409) 시 error가 순수 string이며 React 렌더링 crash를 방지한다', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.includes(mockSource.sourceId)) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: 'STALE_REVISION',
              message: 'Stale revision on cancel',
            },
          }),
        }
      }
      if (init?.method === 'DELETE' && url.includes(mockSource.sourceId)) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: {
              code: 'FORBIDDEN',
              message: 'Forbidden delete',
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sources: [mockSource], capabilities: mockCapabilities }),
      }
    })

    const { result } = renderHook(() =>
      useChannelLearning({ workspaceId, canManage: true }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // 1. cancelSource 409 실패 검증
    await act(async () => {
      const res = await result.current.cancelSource({
        sourceId: mockSource.sourceId,
        revision: 1,
      })
      expect(res.success).toBe(false)
      expect(typeof res.error).toBe('string')
      expect(res.code).toBe('STALE_REVISION')
    })

    expect(typeof result.current.error).toBe('string')
    expect(result.current.errorCode).toBe('STALE_REVISION')

    // 2. deleteSource 403 실패 검증
    await act(async () => {
      const res = await result.current.deleteSource({
        sourceId: mockSource.sourceId,
        revision: 1,
      })
      expect(res.success).toBe(false)
      expect(typeof res.error).toBe('string')
      expect(res.code).toBe('FORBIDDEN')
    })

    expect(typeof result.current.error).toBe('string')
    expect(result.current.errorCode).toBe('FORBIDDEN')
    expect(result.current.error).toBe('채널 정보를 변경할 권한이 없습니다.')
  })
})
