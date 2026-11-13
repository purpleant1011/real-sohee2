import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  verifyPublishedPost: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}))

vi.mock('./readback', () => ({
  verifyPublishedPost: mocks.verifyPublishedPost,
}))

import { verifyNaverPublishedPostAction } from './verify-published-post.action'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const VALID_URL = 'https://blog.naver.com/testowner/123456789012'

describe('verifyNaverPublishedPostAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'manager', status: 'active' },
              error: null,
            }),
          }),
        }),
      }),
    })
  })

  it('rejects unauthenticated requests', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no user') })
    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: VALID_URL,
      expected: { title: '테스트', categoryName: null, imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.reasons).toContain('로그인이 필요해요.')
    expect(result.error?.message).toBe('로그인이 필요해요.')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })

  it('rejects non-members or non-reviewers', async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'viewer', status: 'active' },
              error: null,
            }),
          }),
        }),
      }),
    })

    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: VALID_URL,
      expected: { title: '테스트', categoryName: null, imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.reasons).toContain('이 매장에 접근할 수 없어요.')
    expect(result.error?.message).toBe('이 매장에 접근할 수 없어요.')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })

  it('rejects bad URL and never fetches arbitrary URLs (SSRF safe)', async () => {
    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: 'https://evil.attacker.com/some/path',
      expected: { title: '테스트', categoryName: null, imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.reasons).toContain('올바른 네이버 블로그 글 주소가 아니에요.')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: 외부 크롤링 차단 정책으로 인하여 외부 조회 대신 UNKNOWN/POLICY_DISABLED 반환 (외부 fetch 0회)
  it('returns UNKNOWN with POLICY_DISABLED before external readback fetch', async () => {
    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: VALID_URL,
      expected: { title: '테스트 제목', categoryName: '일상', imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.reasons[0]).toContain('직접')
    expect(result.errorCode).toBe('POLICY_DISABLED')
    expect(result.data?.status).toBe('UNKNOWN')
    expect(result.data?.errorCode).toBe('POLICY_DISABLED')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: MISMATCH 판단 이전 단계인 크롤링 진입점에서 UNKNOWN/POLICY_DISABLED 로 차단
  it('blocks mismatch check and returns UNKNOWN with POLICY_DISABLED', async () => {
    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: VALID_URL,
      expected: { title: '원래 제목', categoryName: null, imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.errorCode).toBe('POLICY_DISABLED')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })

  // V1.2 ADR-01/02: 읽기 불가 여부 확인 자체를 위한 외부 접근을 사전에 차단하고 UNKNOWN/POLICY_DISABLED 반환
  it('blocks private/unreadable post fetch and returns UNKNOWN with POLICY_DISABLED', async () => {
    const result = await verifyNaverPublishedPostAction({
      workspaceId: WORKSPACE,
      resultUrl: VALID_URL,
      expected: { title: '비공개 글', categoryName: null, imageCount: 4 },
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.errorCode).toBe('POLICY_DISABLED')
    expect(mocks.verifyPublishedPost).not.toHaveBeenCalled()
  })
})
