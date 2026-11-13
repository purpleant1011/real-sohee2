import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  analyzeKnowledgeIntelligence: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-knowledge/intelligence-service', () => ({
  analyzeKnowledgeIntelligence: mocks.analyzeKnowledgeIntelligence,
}))

import { GET } from '../route'

function createJsonRequest(url: string, method = 'GET') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.analyzeKnowledgeIntelligence.mockReset()

  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
})

describe('Knowledge Intelligence API Route', () => {
  describe('GET /api/workspaces/[workspaceId]/knowledge/intelligence', () => {
    it('인증 실패 시 401을 반환하고 no-store 헤더를 설정한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'UNAUTHORIZED',
        message: '로그인이 필요해요.',
      })

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/intelligence`)
      const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(401)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.analyzeKnowledgeIntelligence).not.toHaveBeenCalled()
    })

    it('성공 시 분석 결과를 200 및 no-store 헤더와 함께 반환한다', async () => {
      const mockResult = {
        inquiry: {
          id: 'inq-1',
          category: 'FACILITIES',
          question: '고기 직접 구워주시나요?',
          reason: '필수 이용 정보',
          placeholder: '직접 구워드립니다.',
          suggestedChips: ['직접 구워드림'],
        },
        seasonTrigger: {
          id: 'season-1',
          seasonName: '가을 단풍 시즌',
          title: '가을 모임 시즌',
          description: '설명',
          actionPrompt: '프롬프트',
          targetCategory: 'MENU',
        },
        competitiveInsight: {
          id: 'comp-1',
          strengthHighlight: '무료 주차',
          recommendation: '청라 무료 주차 강조',
          targetKeyword: '청라 무료 주차',
        },
        lastAnalyzedAt: '2026-10-15T00:00:00.000Z',
      }
      mocks.analyzeKnowledgeIntelligence.mockResolvedValueOnce(mockResult)

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/intelligence`)
      const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json).toEqual({
        success: true,
        data: mockResult,
      })
      expect(mocks.analyzeKnowledgeIntelligence).toHaveBeenCalledWith(WS)
    })

    it('분석 중 에러가 발생하면 500 에러를 반환한다', async () => {
      mocks.analyzeKnowledgeIntelligence.mockRejectedValueOnce(new Error('DB_FAILED'))

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/intelligence`)
      const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(500)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(false)
      expect(json.error).toBe('INTELLIGENCE_ANALYSIS_FAILED')
    })
  })
})
