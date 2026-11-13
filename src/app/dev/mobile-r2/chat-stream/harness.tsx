'use client'

import { useState } from 'react'
import { R2Chat } from '@/features/mobile-chat/r2-chat'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const THREAD = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'
const MISSION = '44444444-4444-4444-8444-444444444444'
const result = { content: '서버에서 다시 확인한 답변이에요.', threadId: THREAD, runId: RUN, missionId: MISSION, planVersion: 1,
  step: 'AWAITING_APPROVAL', planCard: { title: '이번 주 홍보 문안', steps: [{ name: '문안 검토' }] } }
const activity = { event_id: '55555555-5555-4555-8555-555555555555', workspace_id: WORKSPACE, run_id: RUN,
  mission_id: MISSION, step_id: null, sequence: 1, observed_at: '2026-10-28T00:00:00Z', kind: 'approval_needed', simulated: true }

/** 개발용 고정 응답만 사용한다. 인증·모델·저장·외부 실행은 호출하지 않는다. */
function createFixture() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let finished = false
  let requested = false
  const encoder = new TextEncoder()
  const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input)
    if (init?.method === 'POST') {
      if (!path.endsWith('/agent/chat')) return Response.json({}, { status: 409 })
      requested = true
      return new Response(new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
          value.enqueue(frame('run', { runId: RUN, threadId: THREAD }))
          value.enqueue(frame('activity', activity))
        },
        cancel() { controller = null },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }
    if (path.includes('/agent/activity?')) return Response.json({ events: [activity] })
    if (path.includes('?threadId=')) return Response.json({ success: true, messages: finished ? [{
      id: 'assistant-result', role: 'sohee', status: 'completed', content: result.content,
      runId: RUN, usageMetadata: { publicChatResult: result },
    }] : requested ? [{ id: 'owner-request', role: 'user', status: 'completed', content: '이번 주 홍보 문안을 준비해줘' }] : [] })
    return Response.json({ success: true, threads: [{ id: THREAD }] })
  }
  return {
    fetchImpl,
    finish(interrupted: boolean) {
      if (!controller) return
      if (!interrupted) {
        finished = true
        controller.enqueue(frame('result', result))
      }
      controller.close()
      controller = null
    },
  }
}

export function ChatStreamHarness() {
  const [session, setSession] = useState(0)
  return <ChatStreamSession key={session} onReset={() => setSession(value => value + 1)} />
}

function ChatStreamSession({ onReset }: { onReset: () => void }) {
  const [fixture] = useState(createFixture)
  return (
    <>
      <aside className="relative z-50 space-y-2 border-b bg-background p-3 text-sm">
        <p>개발용 고정 응답 · 실제 서버 호출과 외부 실행 없음</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="min-h-11 underline" onClick={() => fixture.finish(false)}>응답 완료</button>
          <button type="button" className="min-h-11 underline" onClick={() => fixture.finish(true)}>연결 중단</button>
          <button type="button" className="min-h-11 underline" onClick={onReset}>초기화</button>
        </div>
      </aside>
      <R2Chat workspaceId={WORKSPACE} fetchImpl={fixture.fetchImpl} />
    </>
  )
}
