import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PATCH } from './route'
import * as routeAuth from '@/features/quick-start/route-auth'
import * as server from '@/features/service-catalog/server'

// Keep the real `isResponse` guard; only the authorization lookup is replaced.
vi.mock('@/features/quick-start/route-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/quick-start/route-auth')>()),
  authorizeQuickRequest: vi.fn(),
}))
vi.mock('@/features/service-catalog/server')

const WS = '11111111-1111-4111-8111-111111111111'
const SVC = '33333333-3333-4333-8333-333333333333'
const NOW = '2026-10-22T09:00:00.000Z'
const row = {
  id: SVC, workspace_id: WS, name: '속눈썹 연장', price: 45000, duration_minutes: 90,
  resource_name: null, cancellation_policy: null, valid_from: null, valid_until: null,
  active: true, updated_at: NOW, knowledge_fact_id: null,
}

const ctx = { params: Promise.resolve({ workspaceId: WS, serviceId: SVC }) }
const req = (body: unknown) => new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) })

function actor(overrides: Record<string, any> = {}) {
  return {
    gateway: {
      list: vi.fn(), find: vi.fn().mockResolvedValue({ data: row, error: null }),
      insert: vi.fn(), update: vi.fn().mockResolvedValue({ data: row, error: null }),
      setFactLink: vi.fn().mockResolvedValue({ data: { ...row, knowledge_fact_id: 'f1' }, error: null }),
      countStaleSlots: vi.fn().mockResolvedValue({ count: 3, error: null }),
    },
    facts: {
      create: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'f1' }),
      findByContent: vi.fn().mockResolvedValue(null),
    },
    workspaceId: WS, role: 'owner',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue({
    userId: 'u1', workspaceId: WS, role: 'owner', supabase: {} as any, admin: {} as any,
  } as any)
  vi.mocked(server.createCatalogActor).mockReturnValue(actor() as any)
})

describe('PATCH /api/workspaces/[workspaceId]/service-catalog/[serviceId]', () => {
  it('저장하고 다시 확인해야 할 예약 가능 시간 개수를 알린다', async () => {
    const response = await PATCH(req({ expectedUpdatedAt: NOW, price: 50000 }), ctx)
    expect(response.status).toBe(200)
    expect((await response.json()).slotsRequiringReconfirmation).toBe(3)
  })

  it('버전이 어긋나면 409로 충돌을 알린다', async () => {
    const response = await PATCH(req({ expectedUpdatedAt: '2026-10-01T00:00:00.000Z', price: 50000 }), ctx)
    expect(response.status).toBe(409)
  })

  it('없는 서비스는 404', async () => {
    const a = actor()
    a.gateway.find.mockResolvedValue({ data: null, error: null })
    vi.mocked(server.createCatalogActor).mockReturnValue(a as any)
    const response = await PATCH(req({ expectedUpdatedAt: NOW, price: 50000 }), ctx)
    expect(response.status).toBe(404)
  })

  it('검증 실패는 422', async () => {
    const response = await PATCH(req({ expectedUpdatedAt: NOW, durationMinutes: 2000 }), ctx)
    expect(response.status).toBe(422)
  })
})
