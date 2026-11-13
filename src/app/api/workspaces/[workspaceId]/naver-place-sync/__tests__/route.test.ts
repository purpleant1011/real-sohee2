import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const USER_ID = 'usr-manager-1111-2222-3333-444455556666'
const PLACE_ID = '12345678'
const SOURCE_ID = 'source-naver-place-1111'

const mocks = vi.hoisted(() => ({
  authorizeQuickRequest: vi.fn(),
  isResponse: vi.fn(),
  resolveNaverPlaceId: vi.fn(),
  fetchNaverPlaceSummary: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorizeQuickRequest,
  isResponse: mocks.isResponse,
}))

vi.mock('@/features/knowledge/naver-place/place-extractor', () => ({
  resolveNaverPlaceId: mocks.resolveNaverPlaceId,
  fetchNaverPlaceSummary: mocks.fetchNaverPlaceSummary,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))

import { POST, GET } from '../route'

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/workspaces/[workspaceId]/naver-place-sync', () => {
  let mockSupabase: any
  let tableOperations: {
    business_profiles: { upsert: any[] }
    knowledge_sources: { insert: any[]; update: any[] }
    knowledge_candidates: { insert: any[] }
    knowledge_facts: { insert: any[]; update: any[] }
  }
  let existingFactsData: any[]

  beforeEach(() => {
    vi.clearAllMocks()

    tableOperations = {
      business_profiles: { upsert: [] },
      knowledge_sources: { insert: [], update: [] },
      knowledge_candidates: { insert: [] },
      knowledge_facts: { insert: [], update: [] },
    }
    existingFactsData = []

    mocks.isResponse.mockReturnValue(false)
    mocks.authorizeQuickRequest.mockResolvedValue({
      userId: USER_ID,
      role: 'manager',
      workspaceId: WS,
    })
    mocks.resolveNaverPlaceId.mockResolvedValue(PLACE_ID)

    mockSupabase = {
      from: vi.fn((table: string) => {
        let currentOperation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
        let insertData: any = null
        let updateData: any = null

        const builder: any = {
          upsert: vi.fn((data: any) => {
            currentOperation = 'upsert'
            tableOperations.business_profiles.upsert.push(data)
            return Promise.resolve({ data, error: null })
          }),
          select: vi.fn((cols?: string) => {
            return builder
          }),
          insert: vi.fn((data: any) => {
            currentOperation = 'insert'
            insertData = data
            if (table === 'knowledge_sources') {
              tableOperations.knowledge_sources.insert.push(data)
            } else if (table === 'knowledge_candidates') {
              tableOperations.knowledge_candidates.insert.push(data)
            } else if (table === 'knowledge_facts') {
              tableOperations.knowledge_facts.insert.push(data)
            }
            return builder
          }),
          update: vi.fn((data: any) => {
            currentOperation = 'update'
            updateData = data
            if (table === 'knowledge_sources') {
              tableOperations.knowledge_sources.update.push(data)
            } else if (table === 'knowledge_facts') {
              tableOperations.knowledge_facts.update.push(data)
            }
            return builder
          }),
          eq: vi.fn(() => builder),
          in: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(() => {
            if (table === 'knowledge_sources') {
              return Promise.resolve({ data: { id: SOURCE_ID }, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          }),
          single: vi.fn(() => {
            if (table === 'knowledge_sources') {
              return Promise.resolve({ data: { id: SOURCE_ID }, error: null })
            }
            if (table === 'knowledge_candidates') {
              return Promise.resolve({ data: { id: `cand-${Date.now()}` }, error: null })
            }
            if (table === 'knowledge_facts') {
              return Promise.resolve({ data: { id: `fact-${Date.now()}` }, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          }),
          then: (resolve: any, reject: any) => {
            if (table === 'knowledge_facts' && currentOperation === 'select') {
              return Promise.resolve({ data: existingFactsData, error: null }).then(resolve, reject)
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject)
          },
        }

        return builder
      }),
    }

    mocks.createAdminSupabaseClient.mockReturnValue(mockSupabase)
  })

  it('네이버 플레이스 연동 요청 시 비공식 스크래핑 정책으로 인해 즉시 403 POLICY_DISABLED 로 차단된다', async () => {
    const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/naver-place-sync`, 'POST', {
      urlOrPlaceId: 'https://naver.me/abcdef',
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WS }) })

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('search_scrape')
    expect(json.error).toContain('네이버 자동')
  })

  it('GET 요청 시에도 정책 차단 또는 빈 결과를 안전하게 반환한다', async () => {
    const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/naver-place-sync`, 'GET')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
  })
})
