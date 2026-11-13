import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ShellScreen: ({ children, composer }: { children?: ReactNode; composer?: ReactNode }) => <>{children}{composer}</>,
}))
import { R2Chat } from './r2-chat'

const WS = '11111111-1111-4111-8111-111111111111'
const THREAD = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'
const MISSION = '44444444-4444-4444-8444-444444444444'
const PATH = `/api/workspaces/${WS}/agent/chat`
const row = { id: 'm1', role: 'sohee', content: '초안을 준비했어요.', status: 'completed' }
const result = { content: '검토할 문안을 준비했어요.', threadId: THREAD, runId: RUN, missionId: MISSION, planVersion: 2, step: 'AWAITING_APPROVAL', planCard: { title: '이번 주 홍보', steps: [{ name: '문안 검토' }] } }
const activity = { event_id: '55555555-5555-4555-8555-555555555555', workspace_id: WS, run_id: RUN, mission_id: MISSION, step_id: null, sequence: 1, observed_at: '2026-10-28T00:00:00Z', kind: 'provider_accepted', simulated: false }
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const stream = (body = frame('run', { runId: RUN, threadId: THREAD }) + frame('result', result)) => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
interface Script {
  threads?: () => Response
  messages?: () => Response
  post?: () => Response
  activities?: () => Response
}
function fixture(script: Script = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}) })
    if (method === 'POST') return script.post?.() ?? stream()
    if (url.includes('/agent/activity?')) return script.activities?.() ?? Response.json({ events: [] })
    if (url.includes('?threadId=')) return script.messages?.() ?? Response.json({ success: true, messages: [row] })
    return script.threads?.() ?? Response.json({ success: true, threads: [{ id: THREAD }] })
  }
  return { calls, fetchImpl }
}
function mount(script: Script = {}) {
  const f = fixture(script)
  return { ...f, view: render(<R2Chat workspaceId={WS} fetchImpl={f.fetchImpl} />) }
}
function send(text = '이번 주 홍보해줘') {
  fireEvent.change(screen.getByRole('textbox', { name: '메시지 내용' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
}

describe('R2 canonical 에이전트 작업 공간', () => {
  it('실제 에이전트 GET 계약으로 읽고 조회 중 입력을 잠근다', async () => {
    const { calls } = mount()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(await screen.findByText(row.content)).toBeVisible()
    expect(calls.map(c => [c.method, c.url])).toEqual([['GET', PATH], ['GET', `${PATH}?threadId=${THREAD}`]])
  })
  it('확인된 빈 목록만 빈 대화로 표시한다', async () => {
    mount({ threads: () => Response.json({ success: true, threads: [] }) })
    expect(await screen.findByText('아직 나눈 대화가 없어요.')).toBeVisible()
    expect(screen.getByRole('textbox')).toBeEnabled()
  })
  it('빈 대화에서 퀵 제안 칩을 클릭하면 해당 메시지가 에이전트로 전송된다', async () => {
    const { calls } = mount({ threads: () => Response.json({ success: true, threads: [] }) })
    expect(await screen.findByText('아직 나눈 대화가 없어요.')).toBeVisible()

    const chip = screen.getByRole('button', { name: '이번 주 인스타 피드 게시물 만들어줘' })
    fireEvent.click(chip)

    await waitFor(() => {
      const postCall = calls.find(c => c.method === 'POST')
      expect(postCall).toBeDefined()
      expect(postCall?.body?.message).toBe('이번 주 인스타 피드 게시물 만들어줘')
    })
  })
  it.each([500, 200])('조회 실패 또는 깨진 계약(%i)은 빈 대화가 아니다', async status => {
    mount({ messages: () => Response.json({ unexpected: true }, { status }) })
    expect(await screen.findByText('확인 실패')).toBeVisible()
    expect(screen.queryByText('아직 나눈 대화가 없어요.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
  it.each([401, 403])('권한 거부(%i)는 오류나 빈 목록과 구분한다', async status => {
    mount({ threads: () => Response.json({}, { status }) })
    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
  it('동일 업무·버전을 POST하고 결과/활동을 새로 조회해 복원한다', async () => {
    let reads = 0
    const { calls } = mount({ messages: () => Response.json({ success: true, messages: [{ ...row, content: ++reads === 1 ? row.content : result.content, runId: RUN, usageMetadata: { publicChatResult: result } }] }), activities: () => Response.json({ events: [activity] }) })
    await screen.findByText(row.content)
    await screen.findByRole('region', { name: '소희의 작업 활동 기록' })
    send()
    expect(await screen.findByText(result.content)).toBeVisible()
    expect(await screen.findByRole('link', { name: '결과 검토·승인' })).toHaveAttribute('href', `/app/missions/${MISSION}`)
    expect(screen.getByText('이번 주 홍보')).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('')
    const post = calls.find(c => c.method === 'POST')!
    expect(post.url).toBe(PATH)
    expect(post.body).toMatchObject({ threadId: THREAD, currentUserMessage: '이번 주 홍보해줘', missionId: MISSION, previousRunId: RUN, expectedPlanVersion: 2 })
    expect(post.body?.dockIntent).toBeUndefined()
  })
  it('새 대화는 별도 conversations POST 없이 canonical 실행이 만든다', async () => {
    const { calls } = mount({ threads: () => Response.json({ success: true, threads: [] }) })
    await screen.findByText('아직 나눈 대화가 없어요.')
    send()
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1))
    expect(calls.find(c => c.method === 'POST')?.body?.threadId).toBeUndefined()
  })
  it('결과 전에도 공개 활동을 표시하고 중복 전송을 막는다', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const { calls } = mount({ post: () => new Response(new ReadableStream({ start(c) { controller = c } }), { headers: { 'content-type': 'text/event-stream' } }) })
    await screen.findByText(row.content)
    send()
    await act(async () => controller.enqueue(encoder.encode(frame('run', { runId: RUN, threadId: THREAD }) + frame('activity', activity))))
    expect(await screen.findByRole('region', { name: '소희의 작업 활동 기록' })).toBeVisible()
    expect(screen.getByText(/소희가 요청을 처리하고 있어요/)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
    await act(async () => { controller.enqueue(encoder.encode(frame('result', result))); controller.close() })
  })
  it('응답 유실은 재전송하지 않고 조회만 허용하며 이전 결과로 잠금을 풀지 않는다', async () => {
    const { calls } = mount({ post: () => stream(frame('run', { runId: RUN, threadId: THREAD })) })
    await screen.findByText(row.content)
    send()
    expect(await screen.findByText('요청 결과를 아직 확인하지 못했어요. 다시 보내지 않고 기존 결과를 조회해요.')).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('이번 주 홍보해줘')
    expect(screen.getByRole('textbox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '요청 결과 다시 확인' }))
    await waitFor(() => expect(calls.filter(c => c.url.includes('?threadId=')).length).toBe(2))
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })
  it('유실된 동일 실행의 영속 결과가 확인되면 입력을 다시 연다', async () => {
    let restored = false
    mount({ post: () => stream(frame('run', { runId: RUN, threadId: THREAD })), messages: () => Response.json({ success: true, messages: restored ? [{ ...row, runId: RUN, usageMetadata: { publicChatResult: result } }] : [row] }) })
    await screen.findByText(row.content)
    send()
    await screen.findByRole('button', { name: '요청 결과 다시 확인' })
    restored = true
    fireEvent.click(screen.getByRole('button', { name: '요청 결과 다시 확인' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
    expect(screen.queryByText('요청 결과를 아직 확인하지 못했어요. 다시 보내지 않고 기존 결과를 조회해요.')).not.toBeInTheDocument()
  })
  it('새로고침 후 답변 없는 요청은 조회로만 복구하고 재전송을 잠근다', async () => {
    let answered = false
    const { calls } = mount({ messages: () => Response.json({ success: true, messages: answered
      ? [{ ...row, runId: RUN, usageMetadata: { publicChatResult: result } }]
      : [{ id: 'pending-user', role: 'user', content: '이미 요청한 업무', status: 'completed' }] }) })
    await screen.findByText('이미 요청한 업무')
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '요청 결과 다시 확인' })).toBeVisible()
    answered = true
    fireEvent.click(screen.getByRole('button', { name: '요청 결과 다시 확인' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })
  it('HTTP 요청 시간 초과는 미실행으로 단정하지 않고 재전송을 잠근다', async () => {
    mount({ post: () => Response.json({}, { status: 408 }) })
    await screen.findByText(row.content)
    send()
    await screen.findByRole('button', { name: '요청 결과 다시 확인' })
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
  it('명확한 권한 거부에는 재확인으로 재전송을 열지 않는다', async () => {
    mount({ post: () => Response.json({}, { status: 403 }) })
    await screen.findByText(row.content)
    send()
    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
  it('JSON 안내도 수용하고 조회 실패 시 확인된 결과를 보존한다', async () => {
    let reads = 0
    mount({ post: () => Response.json({ content: '채널 연결이 필요해요.', threadId: THREAD }), messages: () => ++reads === 1 ? Response.json({ success: true, messages: [row] }) : Response.json({}, { status: 500 }) })
    await screen.findByText(row.content)
    send()
    expect(await screen.findByText('채널 연결이 필요해요.')).toBeVisible()
    expect(await screen.findByText('이전에 확인한 내용')).toBeVisible()
  })
  it('활동 조회 실패는 빈 성공 기록이 아니다', async () => {
    mount({ messages: () => Response.json({ success: true, messages: [{ ...row, runId: RUN }] }), activities: () => Response.json({}, { status: 500 }) })
    expect(await screen.findByText('작업 활동을 불러오지 못했어요. 대화 결과와 별도로 다시 확인해 주세요.')).toBeVisible()
    expect(screen.getByText(row.content)).toBeVisible()
  })
  it('매장 변경 즉시 이전 대화를 지우고 늦은 응답도 표시하지 않는다', async () => {
    const { view, fetchImpl } = mount()
    await screen.findByText(row.content)
    const next = fixture({ threads: () => Response.json({ success: true, threads: [] }) })
    view.rerender(<R2Chat workspaceId={MISSION} fetchImpl={next.fetchImpl} />)
    expect(screen.queryByText(row.content)).not.toBeInTheDocument()
    await screen.findByText('아직 나눈 대화가 없어요.')
    send('새 매장 업무')
    await waitFor(() => expect(next.calls.some(c => c.method === 'POST')).toBe(true))
    expect(next.calls.find(c => c.method === 'POST')?.url).toBe(`/api/workspaces/${MISSION}/agent/chat`)
    expect(fetchImpl).toBeDefined()
  })
})
