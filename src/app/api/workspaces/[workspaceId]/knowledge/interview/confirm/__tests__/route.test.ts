import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  confirmFact: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-interview/service', () => ({
  confirmInterviewFact: mocks.confirmFact,
}))

import { POST } from '../route'

function createRequest(body: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WS}/knowledge/interview/confirm`,
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
  mocks.confirmFact.mockReset()
  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
  mocks.confirmFact.mockResolvedValue({
    factId: 'fact-123',
    category: 'MENU',
    content: '대표 메뉴는 [시그니처 라떼]입니다.',
  })
})

describe('POST /api/workspaces/[workspaceId]/knowledge/interview/confirm', () => {
  const validPayload = {
    questionId: 'q_menu',
    rawAnswer: '시그니처 라떼',
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
    expect(mocks.confirmFact).not.toHaveBeenCalled()
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
    expect(mocks.confirmFact).not.toHaveBeenCalled()
  })

  it('owner 또는 manager가 아닌 역할(viewer, reviewer, member)은 403과 지정된 메시지를 반환한다', async () => {
    const forbiddenRoles = ['viewer', 'reviewer', 'member', 'guest']

    for (const role of forbiddenRoles) {
      mocks.guard.mockResolvedValue({
        ok: true,
        userId: 'user-other',
        role,
        workspaceId: WS,
      })

      const res = await call(validPayload)
      expect(res.status).toBe(403)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const body = await res.json()
      expect(body.message).toBe('지식을 확정할 권한이 없어요.')
      expect(mocks.confirmFact).not.toHaveBeenCalled()
    }
  })

  it('manager 역할은 정상적으로 승인된다', async () => {
    mocks.guard.mockResolvedValue({
      ok: true,
      userId: 'user-manager-1',
      role: 'manager',
      workspaceId: WS,
    })

    const res = await call(validPayload)
    expect(res.status).toBe(200)
    expect(mocks.confirmFact).toHaveBeenCalledTimes(1)
  })

  it('유효하지 않은 questionId는 400을 반환한다', async () => {
    const invalidQuestionPayloads = [
      { questionId: '', rawAnswer: '답변' },
      { questionId: 'q_not_exist', rawAnswer: '답변' },
      { questionId: 123, rawAnswer: '답변' },
      { rawAnswer: '답변' },
    ]

    for (const payload of invalidQuestionPayloads) {
      const res = await call(payload)
      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.confirmFact).not.toHaveBeenCalled()
    }
  })

  it('rawAnswer가 없거나 공백이거나 1000자 초과 또는 타입 오류면 400을 반환한다', async () => {
    const invalidAnswerPayloads = [
      { questionId: 'q_menu', rawAnswer: '' },
      { questionId: 'q_menu', rawAnswer: '   ' },
      { questionId: 'q_menu', rawAnswer: 'A'.repeat(1001) },
      { questionId: 'q_menu', rawAnswer: 12345 },
      { questionId: 'q_menu' },
    ]

    for (const payload of invalidAnswerPayloads) {
      const res = await call(payload)
      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.confirmFact).not.toHaveBeenCalled()
    }
  })

  it('클라이언트가 보낸 category/key/summarizedContent는 무시하고 서버에서 도출하여 confirmFact를 호출한다', async () => {
    const spoofedPayload = {
      questionId: 'q_menu',
      rawAnswer: '  시그니처 라떼  ',
      category: 'HACKED_CATEGORY',
      key: 'hacked_key',
      summarizedContent: '클라이언트가 조작한 요약문',
    }

    const res = await call(spoofedPayload)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.factId).toBe('fact-123')

    expect(mocks.confirmFact).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: 'user-owner-1',
        questionId: 'q_menu',
        category: 'MENU', // questions.ts에서 도출
        key: 'menu', // questions.ts에서 도출
        rawAnswer: '시그니처 라떼', // trim된 rawAnswer
        summarizedContent: '대표 메뉴는 [시그니처 라떼]입니다.', // 서버 summarizeAnswer 도출
      }),
    )
  })

  it('서비스 실패 시 500 에러를 반환한다', async () => {
    mocks.confirmFact.mockRejectedValue(new Error('DB connection failed'))

    const res = await call(validPayload)
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})
