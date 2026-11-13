import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  simulate: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-knowledge/simulate-service', () => ({
  simulateKnowledgeResponse: mocks.simulate,
}))

import { POST } from '../route'

function createRequest(body: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WS}/knowledge/simulate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

const call = (body: unknown) =>
  POST(createRequest(body), {
    params: Promise.resolve({ workspaceId: WS }),
  })

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.simulate.mockReset()
  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    role: 'owner',
    workspaceId: WS,
  })
  mocks.simulate.mockResolvedValue({
    answer: '손님께서 문의주시면 이렇게 답변드릴게요!',
    usedFacts: [{ id: 'fact-1', category: 'PARKING', content: '2시간 무료 주차' }],
    hasLearnedKnowledge: true,
  })
})

describe('POST /api/workspaces/[workspaceId]/knowledge/simulate', () => {
  const validPayload = {
    query: '손님이 주차 문의하면?',
    type: 'faq',
  }

  it('비인증 사용자는 401을 반환하고 no-store 헤더를 갖는다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    })

    const res = await call(validPayload)
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.simulate).not.toHaveBeenCalled()
  })

  it('멤버십이 없으면 403을 반환한다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: '권한이 없어요.',
    })

    const res = await call(validPayload)
    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.simulate).not.toHaveBeenCalled()
  })

  it('query가 누락되거나 빈 문자열이거나 500자를 초과하면 400을 반환한다', async () => {
    const invalidPayloads = [
      {},
      { query: '' },
      { query: '   ' },
      { query: 12345 },
      { query: 'a'.repeat(501) },
    ]

    for (const payload of invalidPayloads) {
      const res = await call(payload)
      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.simulate).not.toHaveBeenCalled()
    }
  })

  it('type이 유효하지 않은 값이면 400을 반환한다', async () => {
    const res = await call({ query: '주차 되나요?', type: 'invalid_type' })
    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.simulate).not.toHaveBeenCalled()
  })

  it('유효한 요청 시 200과 성공 결과를 반환한다', async () => {
    const res = await call(validPayload)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.hasLearnedKnowledge).toBe(true)
    expect(mocks.simulate).toHaveBeenCalledWith({
      workspaceId: WS,
      query: '손님이 주차 문의하면?',
      type: 'faq',
    })
  })

  it('서비스 실패 시 500 에러를 반환한다', async () => {
    mocks.simulate.mockRejectedValue(new Error('Simulate failed'))

    const res = await call(validPayload)
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body.success).toBe(false)
  })
})
