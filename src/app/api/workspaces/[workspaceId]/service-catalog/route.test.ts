import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, POST } from './route'
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
  resource_name: '원장', cancellation_policy: null, valid_from: null, valid_until: null,
  active: true, updated_at: NOW, knowledge_fact_id: null,
}

function actor(overrides: Record<string, any> = {}) {
  return {
    gateway: {
      list: vi.fn().mockResolvedValue({ data: [row], error: null }),
      find: vi.fn().mockResolvedValue({ data: row, error: null }),
      insert: vi.fn().mockResolvedValue({ data: row, error: null }),
      update: vi.fn().mockResolvedValue({ data: row, error: null }),
      setFactLink: vi.fn().mockResolvedValue({ data: { ...row, knowledge_fact_id: 'f1' }, error: null }),
      countStaleSlots: vi.fn().mockResolvedValue({ count: 1, error: null }),
    },
    facts: {
      create: vi.fn().mockResolvedValue({ id: 'f1' }),
      update: vi.fn().mockResolvedValue({ id: 'f1' }),
      findByContent: vi.fn().mockResolvedValue(null),
    },
    workspaceId: WS,
    role: 'owner',
    ...overrides,
  }
}

function auth(role = 'owner') {
  return { userId: 'u1', workspaceId: WS, role, supabase: {} as any, admin: {} as any }
}

const ctx = { params: Promise.resolve({ workspaceId: WS }) }
const req = (body: unknown) => new Request(`http://localhost/api/workspaces/${WS}/service-catalog`, {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => vi.clearAllMocks())

describe('GET /api/workspaces/[workspaceId]/service-catalog', () => {
  it('사장님이 입력한 서비스와 예약 준비 상태를 돌려준다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(auth() as any)
    vi.mocked(server.createCatalogActor).mockReturnValue(actor() as any)
    const response = await GET(new Request('http://localhost'), ctx)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.canEdit).toBe(true)
    expect(body.services[0]).toMatchObject({ name: '속눈썹 연장', durationMinutes: 90, readiness: { ready: true } })
  })

  it('로그인하지 않았으면 인증 라우트의 응답을 그대로 돌려준다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(
      NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 }) as any,
    )
    const response = await GET(new Request('http://localhost'), ctx)
    expect(response.status).toBe(401)
    expect(server.createCatalogActor).not.toHaveBeenCalled()
  })

  it('조회 실패를 빈 목록으로 감추지 않는다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(auth() as any)
    const a = actor()
    a.gateway.list.mockResolvedValue({ data: null, error: { message: 'down' } })
    vi.mocked(server.createCatalogActor).mockReturnValue(a as any)
    const response = await GET(new Request('http://localhost'), ctx)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('불러오지 못했어요')
  })
})

describe('POST /api/workspaces/[workspaceId]/service-catalog', () => {
  it('저장하고 사실 동기화 결과를 숨기지 않고 알린다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(auth() as any)
    vi.mocked(server.createCatalogActor).mockReturnValue(actor() as any)
    const response = await POST(req({ name: '속눈썹 연장', price: 45000, durationMinutes: 90 }), ctx)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.service.name).toBe('속눈썹 연장')
    expect(body.factSync).toEqual({ status: 'SYNCED', factId: 'f1' })
  })

  it('잘못된 입력은 422와 필드 메시지를 돌려준다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(auth() as any)
    vi.mocked(server.createCatalogActor).mockReturnValue(actor() as any)
    const response = await POST(req({ name: '컷', durationMinutes: 0 }), ctx)
    expect(response.status).toBe(422)
    expect((await response.json()).issues[0].path).toBe('durationMinutes')
  })

  it('본문이 JSON이 아니어도 500이 아니라 422로 답한다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(auth() as any)
    vi.mocked(server.createCatalogActor).mockReturnValue(actor() as any)
    const response = await POST(new Request('http://localhost', { method: 'POST', body: 'not json' }), ctx)
    expect(response.status).toBe(422)
  })

  it('권한 없는 역할은 라우트에서 먼저 막는다', async () => {
    vi.mocked(routeAuth.authorizeQuickRequest).mockResolvedValue(
      NextResponse.json({ error: '이 작업은 매장 대표 또는 관리자만 할 수 있어요' }, { status: 403 }) as any,
    )
    const response = await POST(req({ name: '컷' }), ctx)
    expect(response.status).toBe(403)
    expect(routeAuth.authorizeQuickRequest).toHaveBeenCalledWith(WS, { requireRole: 'manager' })
  })
})
