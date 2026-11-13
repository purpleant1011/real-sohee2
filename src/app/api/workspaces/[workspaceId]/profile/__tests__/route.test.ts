import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '../route'
import * as profileService from '@/lib/profile/workspace-profile-service'

vi.mock('@/lib/profile/workspace-profile-service', () => ({
  saveWorkspaceProfile: vi.fn(),
  getWorkspaceProfile: vi.fn(),
}))

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

const workspaceId = '00000000-0000-0000-0000-000000000001'
const context = { params: Promise.resolve({ workspaceId }) }
const memberAuth = { userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} }
const profileFixture = {
  business: {
    workspace_id: workspaceId,
    business_name: '살롱 드 바이름',
    industry: '뷰티',
    location: '인천 청라',
    summary: '전문 스튜디오',
    updated_at: '2026-09-07T12:00:00Z',
  },
  brand: {
    workspace_id: workspaceId,
    voice: '친절한 톤',
    keywords: ['뷰티'],
    prohibited_terms: [],
    updated_at: '2026-09-07T12:00:00Z',
  },
}

beforeEach(() => {
  authorize.mockReset()
  authorize.mockResolvedValue(memberAuth)
})

describe('Workspace Profile API Route (ANI-991)', () => {
  it('GET returns 200 with canonical profile', async () => {
    vi.mocked(profileService.getWorkspaceProfile).mockResolvedValueOnce(profileFixture)

    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/profile`)
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.profile.business.business_name).toBe('살롱 드 바이름')
    expect(authorize).toHaveBeenCalledWith(workspaceId)
  })

  it('POST rejects with 400 if businessName is missing', async () => {
    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/profile`, {
      method: 'POST',
      body: JSON.stringify({
        business: { businessName: '' },
      }),
    })

    const response = await POST(request, context)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toBe('INVALID_INPUT')
  })

  it('POST returns 200 with readback verification on successful atomic save', async () => {
    vi.mocked(profileService.saveWorkspaceProfile).mockResolvedValueOnce({
      ...profileFixture,
      readbackVerified: true,
      verifiedAt: '2026-09-07T12:00:01Z',
    })

    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/profile`, {
      method: 'POST',
      body: JSON.stringify({
        business: { businessName: '살롱 드 바이름' },
        brand: { voice: '친절한 톤' },
      }),
    })

    const response = await POST(request, context)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.readbackVerified).toBe(true)
    expect(json.profile.business.business_name).toBe('살롱 드 바이름')
  })
})

describe('Workspace Profile cross-tenant authorization (E2E-F F-2)', () => {
  const denial = () =>
    new Response(
      JSON.stringify({
        error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).',
      }),
      { status: 403 },
    )

  it('GET refuses a non-member with 403 before reading any workspace data', async () => {
    authorize.mockResolvedValueOnce(denial())
    vi.mocked(profileService.getWorkspaceProfile).mockClear()

    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/profile`)
    const response = await GET(request, context)

    expect(response.status).toBe(403)
    expect(profileService.getWorkspaceProfile).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('바이름')
  })

  it('POST refuses a non-member with 403 before writing any workspace data', async () => {
    authorize.mockResolvedValueOnce(denial())
    vi.mocked(profileService.saveWorkspaceProfile).mockClear()

    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/profile`, {
      method: 'POST',
      body: JSON.stringify({
        business: { businessName: '다른 사업장 덮어쓰기 시도' },
        brand: { voice: '무단 변경' },
      }),
    })

    const response = await POST(request, context)

    expect(response.status).toBe(403)
    expect(profileService.saveWorkspaceProfile).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('덮어쓰기')
  })
})
