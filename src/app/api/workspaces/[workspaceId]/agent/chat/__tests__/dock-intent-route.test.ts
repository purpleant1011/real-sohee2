import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const executeTurn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/agent-os/agent-orchestrator', () => ({ AgentOrchestrator: { executeTurn } }))
vi.mock('@/lib/auth/workspace-actor-guard', () => ({
  verifyWorkspaceActor: vi.fn().mockResolvedValue({ actorId: 'usr-1', isTestAccount: false }),
  handleWorkspaceActorError: vi.fn(),
  redactErrorPayload: vi.fn(() => 'sanitized'),
}))

import { POST } from '../route'

const workspaceId = '223e4567-e89b-42d3-a456-426614174000'
function post(message: string, dockIntent = true) {
  return POST(new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
    method: 'POST',
    body: JSON.stringify({ currentUserMessage: message, dockIntent }),
  }), { params: Promise.resolve({ workspaceId }) })
}

describe('agent chat Dock 의도 응답', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeTurn.mockResolvedValue({ replyContent: '기존 대화 응답', step: 'COMPLETED', sessionId: 's', threadId: 't' })
  })

  it('확정적인 초안 요청은 모델/오케스트레이터 실행 없이 제안만 반환한다', async () => {
    const response = await post('이번 주말 신메뉴 글 올려줘')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      reply: expect.stringContaining('초안'),
      actions: [{ type: 'create_post', topic: '이번 주말 신메뉴' }],
    })
    expect(executeTurn).not.toHaveBeenCalled()
  })

  it('모호한 Dock 발화는 안전한 Gemini 대화에만 위임하고 실행 명령을 내리지 않는다', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '손님께 따뜻하게 인사해 보세요.' }] } }] }),
    } as Response)
    try {
      const response = await post('오늘 고객에게 어떤 말을 하면 좋을까?')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ reply: '손님께 따뜻하게 인사해 보세요.', actions: [] })
      expect(executeTurn).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      fetchMock.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('모델 키가 없으면 위험한 기존 오케스트레이터 대신 안내만 반환한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    try {
      const response = await post('오늘 고객에게 어떤 말을 하면 좋을까?')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ actions: [], reply: expect.stringContaining('잠시 후') })
      expect(executeTurn).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('Dock 모델 타임아웃에는 첫 질문 정적 안내와 세 가지 추천 질문을 반환한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout'))
    try {
      const response = await post('오늘 고객에게 어떤 말을 하면 좋을까?')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ fallback: true, suggestedQuestions: [expect.any(String), expect.any(String), expect.any(String)], actions: [], content: expect.stringContaining('소희가 할 수 있는 일') })
    } finally { fetchMock.mockRestore(); vi.unstubAllEnvs() }
  })

  it('일반 채팅 DB 권한 거부도 500이 아닌 정직한 폴백으로 반환한다', async () => {
    executeTurn.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }))
    const response = await post('안녕', false)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ fallback: true, suggestedQuestions: [expect.any(String), expect.any(String), expect.any(String)], actions: [], content: expect.stringContaining('저장하는 과정') })
  })

  it('계획 수정의 미션·실행·버전을 서버 재검증에 전달한다', async () => {
    executeTurn.mockResolvedValueOnce({ replyContent: '수정 초안', step: 'AWAITING_APPROVAL', missionId: 'mission-1', planVersion: 2 })
    const response = await POST(new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST', body: JSON.stringify({ currentUserMessage: '인스타만 해줘', missionId: 'mission-1', previousRunId: 'run-1', expectedPlanVersion: 1 }),
    }), { params: Promise.resolve({ workspaceId }) })
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({ missionId: 'mission-1', previousRunId: 'run-1', expectedPlanVersion: 1 }))
    expect(await response.json()).toMatchObject({ missionId: 'mission-1', planVersion: 2 })
  })

  it('기존 일반 채팅은 새 의도 라우팅을 적용하지 않는다', async () => {
    const response = await post('이번 주말 신메뉴 글 올려줘', false)
    expect(response.status).toBe(200)
    expect((await response.json()).actions).toBeUndefined()
    expect(executeTurn).toHaveBeenCalledOnce()
  })
})
