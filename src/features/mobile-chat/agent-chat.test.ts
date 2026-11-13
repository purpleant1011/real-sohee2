import { describe, expect, it } from 'vitest'
import { readAgentChatResponse, agentMessagesSnapshot, agentThreadLookup } from './agent-chat'

const WS = '11111111-1111-4111-8111-111111111111'
const RUN = '33333333-3333-4333-8333-333333333333'
const THREAD = '22222222-2222-4222-8222-222222222222'
const result = { content: '초안을 준비했어요.', runId: RUN, threadId: THREAD, step: 'AWAITING_APPROVAL' }
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const activity = { event_id: '44444444-4444-4444-8444-444444444444', workspace_id: WS, run_id: RUN, mission_id: null, step_id: null, sequence: 1, observed_at: '2026-10-28T00:00:00Z', kind: 'provider_accepted', simulated: false }

describe('모바일 canonical agent transport', () => {
  it('서버 run과 같은 공개 활동만 소비하고 terminal 결과를 반환한다', async () => {
    const events: unknown[] = []
    const response = new Response(frame('run', { runId: RUN, threadId: THREAD }) + frame('activity', { ...activity, raw_args: 'SECRET' }) + frame('result', result), { headers: { 'content-type': 'text/event-stream' } })
    const output = await readAgentChatResponse(response, WS, { onActivity: event => events.push(event) })
    expect(output).toMatchObject({ runId: RUN, content: '초안을 준비했어요.' })
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('SECRET')
    expect(JSON.stringify(events)).not.toContain('게시 완료')
  })
  it('SSE progress 이벤트를 파싱하여 onProgress 콜백을 호출한다', async () => {
    const progresses: unknown[] = []
    const progressData = { kind: 'planning', stepIndex: 0, title: '작업 준비', detail: '요청을 확인하고 있습니다.' }
    const response = new Response(
      frame('run', { runId: RUN, threadId: THREAD }) +
      frame('progress', progressData) +
      frame('progress', { kind: 'unknown_corrupted', stepIndex: -1 }) +
      frame('result', result),
      { headers: { 'content-type': 'text/event-stream' } }
    )
    const output = await readAgentChatResponse(response, WS, {
      onProgress: p => progresses.push(p),
    })
    expect(output).toMatchObject({ runId: RUN })
    expect(progresses).toHaveLength(1)
    expect(progresses[0]).toEqual(progressData)
  })
  it.each([
    frame('run', { runId: RUN }),
    frame('run', { runId: RUN }) + frame('error', { message: 'PRIVATE' }),
    frame('run', { runId: RUN }) + frame('result', { ...result, runId: THREAD }),
    frame('run', { runId: RUN }) + frame('activity', { ...activity, workspace_id: THREAD }) + frame('result', result),
    frame('run', { runId: RUN }) + frame('activity', { ...activity, run_id: THREAD }) + frame('result', result),
  ])('중단·오류·다른 매장/실행 결과를 성공으로 처리하지 않는다', async body => {
    await expect(readAgentChatResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), WS, {})).rejects.toThrow()
  })
  it('JSON 전용 안내도 처리하되 FAILED 응답을 거부한다', async () => {
    expect(await readAgentChatResponse(Response.json({ content: '연결이 필요해요.' }), WS, {})).toMatchObject({ content: '연결이 필요해요.' })
    await expect(readAgentChatResponse(Response.json({ status: 'FAILED', content: '오류' }), WS, {})).rejects.toThrow()
  })
  it('답변 없는 마지막 요청은 새로고침 후에도 재전송을 잠근다', () => {
    expect(agentMessagesSnapshot({ success: true, messages: [{ id: 'm2', role: 'user', content: '게시 요청', status: 'completed' }] }, WS, THREAD).uncertain).toBe(true)
  })
  it('다른 thread/run에 묶인 결과는 업무 맥락으로 복원하지 않는다', () => {
    const snapshot = agentMessagesSnapshot({ success: true, messages: [{ id: 'm1', role: 'sohee', content: '답변', runId: RUN, usageMetadata: { publicChatResult: { ...result, threadId: RUN } } }] }, WS, THREAD)
    expect(snapshot.agentResult).toBeUndefined()
  })
  it('조회 오류와 확인된 빈 목록을 구분한다', () => {
    expect(agentThreadLookup({ success: false, threads: [] }).ok).toBe(false)
    expect(agentThreadLookup({ success: true, threads: [] })).toEqual({ ok: true, threadId: null })
  })
  it('서버 저장 메시지에서 실행 결과와 업무 버전을 복원한다', () => {
    const snapshot = agentMessagesSnapshot({ success: true, messages: [{ id: 'm1', role: 'sohee', content: result.content, status: 'completed', workspaceId: WS, threadId: THREAD, runId: RUN, usageMetadata: { publicChatResult: { ...result, missionId: THREAD, planVersion: 2 } } }] }, WS, THREAD)
    expect(snapshot.bubbles[0].text).toBe(result.content)
    expect(snapshot.agentResult).toMatchObject({ runId: RUN, missionId: THREAD, planVersion: 2 })
    expect(agentMessagesSnapshot({ success: true, messages: [{ id: 'x', workspaceId: THREAD, role: 'sohee', content: '누출' }] }, WS, THREAD).bubbles).toEqual([])
  })
})
