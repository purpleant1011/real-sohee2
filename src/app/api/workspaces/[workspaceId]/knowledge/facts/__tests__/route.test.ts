import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const FACT_ID = 'fact-1111-2222-3333-444455556666'

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listWorkspaceFacts: vi.fn(),
  createCustomFact: vi.fn(),
  updateFactContent: vi.fn(),
  expireFact: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-knowledge/facts-service', () => ({
  listWorkspaceFacts: mocks.listWorkspaceFacts,
  createCustomFact: mocks.createCustomFact,
  updateFactContent: mocks.updateFactContent,
  expireFact: mocks.expireFact,
}))

import { GET, POST } from '../route'
import { DELETE, PATCH } from '../[factId]/route'

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.listWorkspaceFacts.mockReset()
  mocks.createCustomFact.mockReset()
  mocks.updateFactContent.mockReset()
  mocks.expireFact.mockReset()

  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
})

describe('Knowledge Facts API Routes', () => {
  describe('GET /api/workspaces/[workspaceId]/knowledge/facts', () => {
    it('인증 실패 시 401을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'UNAUTHORIZED',
        message: '로그인이 필요해요.',
      })

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/facts`, 'GET')
      const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(401)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.listWorkspaceFacts).not.toHaveBeenCalled()
    })

    it('성공 시 팩트 목록을 200 및 no-store 헤더와 함께 반환한다', async () => {
      mocks.listWorkspaceFacts.mockResolvedValueOnce([
        {
          id: 'fact-1',
          category: 'MENU',
          content: '시그니처 라떼 5,000원',
          createdAt: '2026-10-15T10:00:00Z',
          source: 'interview',
        },
      ])

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/facts`, 'GET')
      const res = await GET(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.facts).toHaveLength(1)
      expect(json.data.facts[0].id).toBe('fact-1')
    })
  })

  describe('POST /api/workspaces/[workspaceId]/knowledge/facts', () => {
    it('권한이 member인 경우 403을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: true,
        userId: 'user-member-1',
        role: 'member',
        workspaceId: WS,
      })

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/facts`, 'POST', {
        category: 'MENU',
        content: '신메뉴',
      })
      const res = await POST(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(403)
      expect(mocks.createCustomFact).not.toHaveBeenCalled()
    })

    it('content 길이가 유효하지 않으면 400을 반환한다', async () => {
      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/facts`, 'POST', {
        category: 'MENU',
        content: '   ',
      })
      const res = await POST(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(400)
      expect(mocks.createCustomFact).not.toHaveBeenCalled()
    })

    it('정상 등록 시 201과 등록된 팩트를 반환한다', async () => {
      mocks.createCustomFact.mockResolvedValueOnce({
        id: 'fact-created-1',
        category: 'DIFFERENTIATOR',
        content: '국내산 원두 사용',
        createdAt: '2026-10-15T11:00:00Z',
        source: 'manual',
      })

      const req = createJsonRequest(`http://localhost/api/workspaces/${WS}/knowledge/facts`, 'POST', {
        category: 'DIFFERENTIATOR',
        content: '국내산 원두 사용',
      })
      const res = await POST(req, { params: Promise.resolve({ workspaceId: WS }) })

      expect(res.status).toBe(201)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.fact.id).toBe('fact-created-1')
      expect(mocks.createCustomFact).toHaveBeenCalledWith({
        workspaceId: WS,
        userId: 'user-owner-1',
        category: 'DIFFERENTIATOR',
        content: '국내산 원두 사용',
      })
    })
  })

  describe('PATCH /api/workspaces/[workspaceId]/knowledge/facts/[factId]', () => {
    it('권한이 없는 사용자는 403을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: true,
        userId: 'user-member-1',
        role: 'member',
        workspaceId: WS,
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/facts/${FACT_ID}`,
        'PATCH',
        { content: '수정된 내용' },
      )
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: WS, factId: FACT_ID }),
      })

      expect(res.status).toBe(403)
      expect(mocks.updateFactContent).not.toHaveBeenCalled()
    })

    it('내용이 비어있으면 400을 반환한다', async () => {
      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/facts/${FACT_ID}`,
        'PATCH',
        { content: '' },
      )
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: WS, factId: FACT_ID }),
      })

      expect(res.status).toBe(400)
      expect(mocks.updateFactContent).not.toHaveBeenCalled()
    })

    it('정상 수정 시 200과 갱신된 팩트를 반환한다', async () => {
      mocks.updateFactContent.mockResolvedValueOnce({
        id: 'fact-updated-1',
        category: 'HOURS',
        content: '매일 11:00-23:00',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'interview',
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/facts/${FACT_ID}`,
        'PATCH',
        { content: '매일 11:00-23:00' },
      )
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: WS, factId: FACT_ID }),
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.fact.id).toBe('fact-updated-1')
      expect(mocks.updateFactContent).toHaveBeenCalledWith({
        workspaceId: WS,
        userId: 'user-owner-1',
        factId: FACT_ID,
        content: '매일 11:00-23:00',
      })
    })
  })

  describe('DELETE /api/workspaces/[workspaceId]/knowledge/facts/[factId]', () => {
    it('권한이 없는 사용자는 403을 반환한다', async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: true,
        userId: 'user-member-1',
        role: 'member',
        workspaceId: WS,
      })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/facts/${FACT_ID}`,
        'DELETE',
      )
      const res = await DELETE(req, {
        params: Promise.resolve({ workspaceId: WS, factId: FACT_ID }),
      })

      expect(res.status).toBe(403)
      expect(mocks.expireFact).not.toHaveBeenCalled()
    })

    it('정상 삭제 시 200을 반환한다', async () => {
      mocks.expireFact.mockResolvedValueOnce({ success: true })

      const req = createJsonRequest(
        `http://localhost/api/workspaces/${WS}/knowledge/facts/${FACT_ID}`,
        'DELETE',
      )
      const res = await DELETE(req, {
        params: Promise.resolve({ workspaceId: WS, factId: FACT_ID }),
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(mocks.expireFact).toHaveBeenCalledWith({
        workspaceId: WS,
        userId: 'user-owner-1',
        factId: FACT_ID,
      })
    })
  })
})
