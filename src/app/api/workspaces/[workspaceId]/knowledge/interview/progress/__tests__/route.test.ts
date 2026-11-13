import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getProgress: vi.fn(),
}))

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mocks.guard,
}))
vi.mock('@/features/sohee-interview/progress-service', () => ({
  getInterviewProgress: mocks.getProgress,
}))

import { GET } from '../route'

function createRequest() {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WS}/knowledge/interview/progress`,
    {
      method: 'GET',
    },
  )
}

const call = () =>
  GET(createRequest(), {
    params: Promise.resolve({ workspaceId: WS }),
  })

beforeEach(() => {
  mocks.guard.mockReset()
  mocks.getProgress.mockReset()
  mocks.guard.mockResolvedValue({
    ok: true,
    userId: 'user-owner-1',
    role: 'owner',
    workspaceId: WS,
  })
  mocks.getProgress.mockResolvedValue({
    totalQuestions: 8,
    answeredQuestionIds: ['q_menu'],
    nextQuestionId: 'q_price',
    progressPercent: 13,
    isCompleted: false,
  })
})

describe('GET /api/workspaces/[workspaceId]/knowledge/interview/progress', () => {
  it('비인증 사용자는 401을 반환하고 no-store 헤더를 갖는다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    })

    const res = await call()
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.getProgress).not.toHaveBeenCalled()
  })

  it('멤버십이 없으면 403을 반환한다', async () => {
    mocks.guard.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: '권한이 없어요.',
    })

    const res = await call()
    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.getProgress).not.toHaveBeenCalled()
  })

  it('인증된 사용자의 경우 인터뷰 진행 상태를 성공적으로 반환한다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = await res.json()
    expect(body).toEqual({
      success: true,
      data: {
        totalQuestions: 8,
        answeredQuestionIds: ['q_menu'],
        nextQuestionId: 'q_price',
        progressPercent: 13,
        isCompleted: false,
      },
    })
    expect(mocks.getProgress).toHaveBeenCalledWith(WS)
  })

  it('서비스 실패 시 500 에러를 반환한다', async () => {
    mocks.getProgress.mockRejectedValue(new Error('DB failure'))

    const res = await call()
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})
