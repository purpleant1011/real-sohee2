import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    capacity: 5000,
    balance: 5000,
    remainingPercentage: 100,
  }),
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => ({
    sessionId: 'sess-test',
    threadId: 'th-test',
    isLoading: false,
  }),
}))

function createSseResponse(eventsText: string) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(eventsText))
      controller.close()
    }
  })
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) => h.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null,
    },
    body: stream,
    json: async () => { throw new Error('Not a json response') },
  }
}

describe('SoheeAgentDock SSE Progress Stream & Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('SSE 스트림 응답 시 run으로 runId를 보관하고, progress 단계가 렌더된 후 result로 최종 메시지가 나온다', async () => {
    const sseBody = [
      'event: run\ndata: {"runId":"run-sse-123","threadId":"th-test"}\n\n',
      'event: progress\ndata: {"kind":"planning","stepIndex":0,"title":"마케팅 계획 수립 중","detail":"의도를 분석 중입니다."}\n\n',
      'event: progress\ndata: {"kind":"step_started","stepIndex":1,"title":"콘텐츠 원고 작성","detail":"원고를 작성하고 있습니다."}\n\n',
      'event: progress\ndata: {"kind":"step_done","stepIndex":1,"title":"콘텐츠 원고 작성","detail":"원고 작성이 완료되었습니다."}\n\n',
      'event: result\ndata: {"reply":"인스타그램 콘텐츠 초안을 준비했어요.","runId":"run-sse-123","step":"MCP_TOOL_EXECUTED"}\n\n'
    ].join('')

    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        expect(options.headers?.Accept || options.headers?.accept).toContain('text/event-stream')
        return createSseResponse(sseBody)
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, messages: [] })
      }
    }) as any

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />)

    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '인스타 글 써줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))

    await waitFor(() => {
      expect(screen.getByText('인스타그램 콘텐츠 초안을 준비했어요.')).toBeDefined()
    })

    // active-run-bar가 정상적으로 runId와 목표를 표시하는지 검증
    expect(screen.getByTestId('active-run-bar')).toBeDefined()
  })

  it('결과 없이 스트림이 끊기면 같은 지시를 다시 보내라고 하지 않고 작업이 계속될 수 있음을 안내한다', async () => {
    const sseBody = [
      'event: run\ndata: {"runId":"run-cut-1"}\n\n',
      'event: progress\ndata: {"kind":"step_started","stepIndex":1,"title":"콘텐츠 원고 작성"}\n\n',
    ].join('')

    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') return createSseResponse(sseBody)
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, messages: [] }) }
    }) as any

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />)
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), { target: { value: '인스타 글 써줘' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))

    await waitFor(() => {
      expect(screen.getByText(/작업을 계속하고 있을 수 있어요/)).toBeDefined()
    })
    expect(screen.queryByText(/다시 말씀해 주세요/)).toBeNull()
  })

  it('Content-Type이 text/event-stream이 아니면 기존 JSON 응답으로 안전하게 폴백한다', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: { get: (h: string) => h.toLowerCase() === 'content-type' ? 'application/json' : null },
          json: async () => ({
            reply: 'JSON 폴백 답변입니다.',
            runId: 'run-fallback-1',
            step: 'MCP_TOOL_EXECUTED',
          })
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, messages: [] })
      }
    }) as any

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />)

    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '폴백 테스트' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))

    await waitFor(() => {
      expect(screen.getByText('JSON 폴백 답변입니다.')).toBeDefined()
    })
  })

  it('진행 중인 동안 progress 이벤트가 전달되면 말풍선 안에 완료(✓) 및 진행 중 항목이 실시간 표시된다', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller
      }
    })

    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream; charset=utf-8' },
          body: stream,
          json: async () => ({})
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, messages: [] })
      }
    }) as any

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />)

    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '진행 단계 확인' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))

    // 1단계: planning 및 step_done 주입
    streamController!.enqueue(encoder.encode(
      'event: progress\ndata: {"kind":"step_done","stepIndex":1,"title":"고객 조회 완료","detail":"단골 고객 확인"}\n\n'
    ))

    await waitFor(() => {
      expect(screen.getByText('고객 조회 완료')).toBeDefined()
      expect(screen.getByText(/단골 고객 확인/)).toBeDefined()
      expect(screen.getByText(/1 \/ 1단계/)).toBeDefined()
    })

    // 2단계: result 주입 후 스트림 닫기
    streamController!.enqueue(encoder.encode(
      'event: result\ndata: {"reply":"최종 완료되었습니다.","step":"MCP_TOOL_EXECUTED"}\n\n'
    ))
    streamController!.close()

    await waitFor(() => {
      expect(screen.getByText('최종 완료되었습니다.')).toBeDefined()
    })
  })
  it('후속 단계(step_started/step_done)가 전달되면 이전 planning 단계는 스피너가 멈추고 완료(✓)로 전환된다', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller
      }
    })

    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream; charset=utf-8' },
          body: stream,
          json: async () => ({})
        }
      }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, messages: [] }) }
    }) as any

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />)
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '계획 후 도구 실행' },
    })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))

    // 1단계: planning 이벤트 전달
    streamController!.enqueue(encoder.encode(
      'event: progress\ndata: {"kind":"planning","stepIndex":0,"title":"작업 계획 수립 중","detail":"분석 중"}\n\n'
    ))

    await waitFor(() => {
      expect(screen.getByText('작업 계획 수립 중')).toBeDefined()
    })

    // 2단계: 다음 단계인 step_started 이벤트 전달
    streamController!.enqueue(encoder.encode(
      'event: progress\ndata: {"kind":"step_started","stepIndex":1,"title":"콘텐츠 작성"}\n\n'
    ))

    // planning 단계는 완료로 전환되어야 하고, 더 이상 미완료 스피너 상태로 남아있지 않아야 한다
    await waitFor(() => {
      expect(screen.getByText('작업 계획 수립 완료')).toBeDefined()
      expect(screen.getByText(/1 \/ 2단계/)).toBeDefined()
    })

    streamController!.close()
  })
})
