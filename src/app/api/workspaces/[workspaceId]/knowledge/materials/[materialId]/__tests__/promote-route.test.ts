import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const MATERIAL_ID = 'mat-1111-2222-3333-444455556666'

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  promoteSuggestions: vi.fn(),
  supabaseFrom: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))

vi.mock('@/features/sohee-materials/extraction-service', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    promoteSuggestionsToFacts: mocks.promoteSuggestions,
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: mocks.supabaseFrom,
  }),
}))

import { GET as getSuggestions } from '../suggestions/route'
import { POST as postPromote } from '../promote/route'

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function mockQueryChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
})

describe('Materials Suggestions & Promotion Routes', () => {
  describe('GET /api/workspaces/[workspaceId]/knowledge/materials/[materialId]/suggestions', () => {
    it('비인증 사용자는 401 및 no-store를 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(401)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.supabaseFrom).not.toHaveBeenCalled()
    })

    it('비인가 사용자는 403 및 no-store를 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '접근 권한이 없습니다.',
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(403)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.supabaseFrom).not.toHaveBeenCalled()
    })

    it('자료가 존재하지 않는 경우 404를 반환한다', async () => {
      // knowledge_items 조회 실패(null) -> knowledge_sources 조회 실패(null)
      mocks.supabaseFrom
        .mockReturnValueOnce(mockQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(mockQueryChain({ data: null, error: null }))

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(404)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(false)
    })

    it('knowledge_items에 이미 evidence.suggestions가 저장되어 있으면 즉시 반환한다', async () => {
      const storedSuggestions = [
        { id: 'sug-1', category: 'MENU', content: '김치찌개 8,000원' },
      ]
      mocks.supabaseFrom.mockReturnValueOnce(
        mockQueryChain({
          data: {
            id: MATERIAL_ID,
            name: '메뉴판.jpg',
            evidence: { suggestions: storedSuggestions },
          },
          error: null,
        }),
      )

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.materialId).toBe(MATERIAL_ID)
      expect(json.data.materialName).toBe('메뉴판.jpg')
      expect(json.data.suggestions).toEqual(storedSuggestions)
    })

    it('evidence.suggestions가 없으면 evidence.extractedText로부터 추천 지식을 자동 생성한다', async () => {
      mocks.supabaseFrom.mockReturnValueOnce(
        mockQueryChain({
          data: {
            id: MATERIAL_ID,
            name: '안내문.txt',
            evidence: {
              extractedText: '영업시간: 매일 10:00 ~ 22:00\n대표 메뉴 된장찌개 9,000원',
            },
          },
          error: null,
        }),
      )

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.suggestions.length).toBeGreaterThan(0)
      expect(json.data.suggestions.some((s: any) => s.category === 'HOURS')).toBe(true)
    })

    it('knowledge_items에 없고 knowledge_sources에 있는 경우 display_name 기반으로 생성하여 반환한다', async () => {
      mocks.supabaseFrom
        .mockReturnValueOnce(mockQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(
          mockQueryChain({
            data: {
              id: MATERIAL_ID,
              display_name: '네이버 플레이스 연동 매장 정보',
            },
            error: null,
          }),
        )

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/suggestions`,
        'GET',
      )
      const res = await getSuggestions(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.materialName).toBe('네이버 플레이스 연동 매장 정보')
      expect(json.data.suggestions.length).toBeGreaterThan(0)
    })
  })

  describe('POST /api/workspaces/[workspaceId]/knowledge/materials/[materialId]/promote', () => {
    it('비인증 사용자는 401을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/promote`,
        'POST',
        { materialName: '메뉴판', suggestions: [{ category: 'MENU', content: '커피' }] },
      )
      const res = await postPromote(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(401)
      expect(mocks.promoteSuggestions).not.toHaveBeenCalled()
    })

    it('member 권한 사용자는 승격 권한이 없으므로 403을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: true,
        userId: 'user-member-1',
        role: 'member',
        workspaceId: WS,
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/promote`,
        'POST',
        { materialName: '메뉴판', suggestions: [{ category: 'MENU', content: '커피' }] },
      )
      const res = await postPromote(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(403)
      expect(mocks.promoteSuggestions).not.toHaveBeenCalled()
    })

    it('suggestions 배열이 비어있으면 400을 반환한다', async () => {
      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/promote`,
        'POST',
        { materialName: '메뉴판', suggestions: [] },
      )
      const res = await postPromote(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(400)
      expect(mocks.promoteSuggestions).not.toHaveBeenCalled()
    })

    it('owner 또는 manager 권한으로 유효한 제안들을 전달하면 promoteSuggestionsToFacts를 호출하고 200을 반환한다', async () => {
      mocks.promoteSuggestions.mockResolvedValueOnce({
        promotedCount: 2,
        factIds: ['fact-1', 'fact-2'],
      })

      const inputSuggestions = [
        { category: 'MENU', content: '된장찌개 8,000원' },
        { category: 'HOURS', content: '매일 10:00 - 22:00' },
      ]

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/materials/${MATERIAL_ID}/promote`,
        'POST',
        { materialName: '메뉴판.pdf', suggestions: inputSuggestions },
      )
      const res = await postPromote(req, {
        params: Promise.resolve({ workspaceId: WS, materialId: MATERIAL_ID }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data).toEqual({
        promotedCount: 2,
        factIds: ['fact-1', 'fact-2'],
      })
      expect(mocks.promoteSuggestions).toHaveBeenCalledWith({
        workspaceId: WS,
        userId: 'user-owner-1',
        materialId: MATERIAL_ID,
        materialName: '메뉴판.pdf',
        suggestions: inputSuggestions,
      })
    })
  })

  describe('listWorkspaceMaterials suggestionsCount integration', () => {
    it('knowledge_items의 evidence.suggestions 개수를 suggestionsCount로 계산한다', async () => {
      const { listWorkspaceMaterials } = await import('@/features/sohee-materials/materials-service')

      const fakeClient: any = {
        from: vi.fn((table: string) => {
          if (table === 'knowledge_items') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'item-with-suggestions',
                        name: '메뉴.pdf',
                        status: 'approved',
                        created_at: '2026-10-15T10:00:00Z',
                        evidence: {
                          suggestions: [
                            { id: '1', category: 'MENU', content: '커피' },
                            { id: '2', category: 'PRICE', content: '5000원' },
                          ],
                        },
                      },
                      {
                        id: 'item-empty-evidence',
                        name: '빈문서.pdf',
                        status: 'approved',
                        created_at: '2026-10-15T11:00:00Z',
                        evidence: null,
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            }
          }
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }),
      }

      const result = await listWorkspaceMaterials(WS, fakeClient)
      const itemWithSug = result.items.find((i) => i.id === 'item-with-suggestions')
      const itemEmpty = result.items.find((i) => i.id === 'item-empty-evidence')

      expect(itemWithSug?.suggestionsCount).toBe(2)
      expect(itemEmpty?.suggestionsCount).toBe(0)
    })
  })
})
