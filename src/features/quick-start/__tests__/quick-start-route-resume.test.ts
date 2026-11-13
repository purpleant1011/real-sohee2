import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), profile: vi.fn(), details: vi.fn() }))
vi.mock('../route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: mocks.load }))
vi.mock('../quick-start-service', async importOriginal => ({
  ...await importOriginal<typeof import('../quick-start-service')>(),
  loadQuickStartProfile: mocks.profile,
  loadQuickStartPreferences: async () => ({ goal: '', tone: 'friendly' }),
}))
import { GET, PATCH } from '@/app/api/onboarding/quick-start/route'

describe('quick start resume API', () => {
  it('returns carried-forward owner facts via workspace-scoped loader', async () => {
    mocks.auth.mockResolvedValue({
      workspaceId: 'w1',
      userId: 'u1',
      admin: {
        from: (table: string) => {
          if (table === 'workspace_business_details') {
            const query = {
              select: () => query,
              eq: () => query,
              maybeSingle: mocks.details,
            }
            return query
          }
          throw new Error(`Unexpected admin table: ${table}`)
        },
      },
      supabase: {},
    })
    mocks.details.mockResolvedValue({ data: null, error: null })
    mocks.load.mockResolvedValue({ stage: 'PREPARE_ONLY', progressPercent: 0, connectionHint: '채널 연결', facts: {}, blockers: [] })
    mocks.profile.mockResolvedValue({ business_name: '가입한 가게', industry: '카페' })
    const res = await GET(new Request('https://local.invalid/api/onboarding/quick-start'))
    expect(res.status).toBe(200)
    expect((await res.json()).profile.business_name).toBe('가입한 가게')
    expect(mocks.profile).toHaveBeenCalledWith({ admin: expect.objectContaining({ from: expect.any(Function) }), workspaceId: 'w1', userId: 'u1' })
    expect(mocks.details).toHaveBeenCalledOnce()
  })
  it('requires manager authorization before saving partial input', async () => {
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const res = await PATCH(new Request('https://local.invalid', { method: 'PATCH', body: '{}' }))
    expect(res.status).toBe(403)
    expect(mocks.auth).toHaveBeenLastCalledWith(undefined, { requireRole: 'manager' })
  })
  it('returns an explicit retryable error rather than an empty profile on read failure', async () => {
    mocks.profile.mockRejectedValue(new Error('PROFILE_READ'))
    const res = await GET(new Request('https://local.invalid/api/onboarding/quick-start'))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('QUICK_START_READ_FAILED')
  })
})
