import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  crossPostToSocial: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/features/channel-studio/naver/cross-post-to-social', () => ({
  crossPostToSocial: mocks.crossPostToSocial,
}))

import { POST } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const VERSION_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-4444-444444444444'

const post = (body: unknown = { versionId: VERSION_ID }) =>
  POST(
    new Request(`http://localhost/api/workspaces/${WORKSPACE}/naver-posts/${CONTENT_ID}/cross-post`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ workspaceId: WORKSPACE, contentId: CONTENT_ID }),
    },
  )

describe('POST /api/workspaces/[workspaceId]/naver-posts/[contentId]/cross-post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      workspaceId: WORKSPACE,
      userId: USER_ID,
      role: 'manager',
      supabase: {},
      admin: {},
    })
  })

  it('rejects unauthorized requests with auth response', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '인증 실패' }), { status: 401 }))

    const res = await post()
    expect(res.status).toBe(401)
  })

  it('validates request payload schema', async () => {
    const res = await post({ versionId: 'invalid-uuid' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('요청 정보를 확인해 주세요.')
  })

  it('calls crossPostToSocial and returns success response', async () => {
    mocks.crossPostToSocial.mockResolvedValue({
      instagram: { contentId: 'ig-123', versionId: 'ig-ver-123' },
      threads: { contentId: 'th-123', versionId: 'th-ver-123' },
    })

    const res = await post()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.instagram.contentId).toBe('ig-123')
    expect(json.data.threads.contentId).toBe('th-123')
  })
})
