import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SoheeAgentDock } from '../sohee-agent-dock'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({ isRunning: false, actualMode: 'IDLE', killSwitchActive: false, isLoading: false, setAutonomy: vi.fn() }),
}))
vi.mock('@/hooks/use-credit-balance', () => ({ useCreditBalance: () => ({ balance: 5000, capacity: 5000 }) }))
vi.mock('@/hooks/use-agent-session', () => ({ useAgentSession: () => ({ sessionId: 'sess-1', threadId: 'thread-1', isLoading: false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/app', useSearchParams: () => ({ get: () => null }) }))

const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const event = (sequence: number, kind: string) => ({
  event_id: `00000000-0000-0000-0000-${String(sequence).padStart(12, '0')}`,
  workspace_id: workspaceId, run_id: runId, mission_id: null, step_id: null,
  sequence, observed_at: '2026-10-26T12:00:00Z', kind, simulated: false,
  user_visible_summary: 'secret raw arguments',
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

it('활동을 접고 펼치며 결과 미확인을 성공으로 바꾸지 않고 안전한 근거만 표시한다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{ id: 'saved', role: 'sohee', content: '이전 대화', runId }] })
    if (url.includes('/agent/activity?')) return Response.json({ events: [event(1, 'provider_accepted'), event(2, 'result_unknown')], run_status: 'completed' })
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  const toggle = await screen.findByRole('button', { name: /소희의 활동/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('list', { name: '확인된 작업 활동' })).toHaveTextContent('실행 결과를 아직 확인하지 못했습니다.')
  fireEvent.click(toggle)
  expect(screen.queryByRole('list', { name: '확인된 작업 활동' })).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(screen.getByRole('list', { name: '확인된 작업 활동' })).toHaveTextContent('외부 서비스가 요청을 접수했습니다. 결과 확인이 필요합니다.')
  fireEvent.click(screen.getByRole('button', { name: '확인한 근거 보기' }))
  expect(screen.getByRole('region', { name: '확인한 근거' })).toHaveTextContent('독립 조회로 확인된 결과가 아직 없습니다.')
  expect(screen.queryByText('secret raw arguments')).not.toBeInTheDocument()
  expect(screen.queryByText('외부 검증 완료')).not.toBeInTheDocument()
  view.unmount()
})

it('도구 정보 조회는 외부 실행 결과의 독립 조회 건수에 포함하지 않는다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{ id: 'saved', role: 'sohee', content: '조회 기록', runId }] })
    if (url.includes('/agent/activity?')) return Response.json({ events: [event(1, 'tool_read_verified')], run_status: 'completed' })
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByRole('region', { name: '판단 요약' })
  expect(screen.getByText(/독립 조회 기록 0건/)).toBeInTheDocument()
  expect(screen.getByRole('list', { name: '확인된 작업 활동' })).toHaveTextContent('도구의 정보 조회가 확인되었습니다.')
  view.unmount()
})

it('이전 대화를 읽는 동안 새 활동은 스크롤을 밀지 않고 명시적으로 이동한다', async () => {
  let resolveReplay!: (response: Response) => void
  const replay = new Promise<Response>(resolve => { resolveReplay = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{ id: 'saved', role: 'sohee', content: '이전 대화', runId }] })
    if (url.includes('/agent/activity?')) return replay
    return Response.json({ messages: [] })
  })
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByText('이전 대화', { selector: 'p' })
  const log = screen.getByRole('region', { name: '소희와의 대화' })
  Object.defineProperties(log, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 300 }, scrollTop: { configurable: true, writable: true, value: 100 } })
  fireEvent.scroll(log)
  scrollIntoView.mockClear()
  await act(async () => { resolveReplay(Response.json({ events: [event(1, 'request_received'), event(2, 'result_unknown')], run_status: 'completed' })); await replay })
  const jump = await screen.findByRole('button', { name: '새 활동 2건' })
  expect(scrollIntoView).not.toHaveBeenCalled()
  fireEvent.click(jump)
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
  expect(screen.queryByRole('button', { name: '새 활동 2건' })).not.toBeInTheDocument()
  view.unmount()
})

it('기존 미션 초안을 편집하면 이전 승인 버튼을 차단하고 게시 요청을 보내지 않는다', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') writes.push(url)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'editable-plan', role: 'sohee', content: '원고를 검토해 주세요', missionId: 'mission-1',
      planCard: { planId: 'plan-1', title: '홍보', steps: [], totalSC: 12, requiresApproval: true },
      approvalCard: { decisionId: 'old-approval', title: '홍보 승인', expectedVersion: 1, options: [{ id: 'publish', label: '발행' }] },
    }] })
    if (url.endsWith('/first-post/mission-1')) return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: {
      missionId: 'mission-1', workspaceId, approvalFingerprint: 'a'.repeat(64),
      copies: { instagram: { caption: '원본 인스타' }, threads: { content: '원본 스레드' } },
    } })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '홍보 초안 불러오기' }))
  expect(screen.getByRole('button', { name: '승인 및 실행' })).toBeInTheDocument()
  fireEvent.change(await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' }), { target: { value: '승인 전 수정 원고' } })
  expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument()
  expect(screen.getByText(/초안이 변경되어 이전 승인을 사용할 수 없습니다/)).toBeInTheDocument()
  expect(writes).toHaveLength(0)
  view.unmount()
})

it('복원된 일반 원고의 미션·실행·버전으로 검토하고 게시 요청을 보내지 않는다', async () => {
  const reads: URL[] = []
  const writes: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method && init.method !== 'GET') writes.push(url)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'general-draft', role: 'sohee', content: '일반 미션 원고', runId,
      usageMetadata: { missionId: 'mission-general' },
      contentDraftCard: { draftId: 'draft-general', topic: '서비스 안내', variants: [{
        channel: 'threads', caption: '초안', hashtags: [], status: 'READY', statusLabel: '보관할 수 있어요',
        issues: [], contentId: 'content-general', versionId: 'version-general', vaultSavable: true,
      }] },
    }] })
    if (url.includes('/agent/evidence?')) {
      reads.push(new URL(url, 'http://localhost'))
      return Response.json({ workspaceId, missionId: 'mission-general', runId,
        artifactReview: { preview: { workspaceId, contentId: 'content-general', versionId: 'version-general',
          account: { label: '@verified-scope' }, text: '서버 검토 원고', media: [] },
          cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: ['비용 확인 필요'] },
      })
    }
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '원고·사진·승인 조건 확인' }))
  await screen.findByText('서버 검토 원고')
  expect(Object.fromEntries(reads[0].searchParams)).toEqual({ missionId: 'mission-general', runId, contentId: 'content-general', versionId: 'version-general' })
  expect(screen.getByRole('button', { name: '승인 조건 확인 필요' })).toBeDisabled()
  expect(writes).toHaveLength(0)
  view.unmount()
})

it.each(['same-message', 'same-mission', 'same-run'])('일반 원고의 정확 승인 조건이 미확인인 동안 %s의 일반 실행 승인으로 우회하지 않는다', async linkage => {
  const writes: string[] = []
  const approvalCard = { decisionId: 'legacy-publish', title: '원고 게시', options: [{ id: 'publish', label: '발행' }] }
  const draftMessage = {
    id: 'general-draft', role: 'sohee', content: '일반 미션 원고', missionId: 'mission-general', runId,
    ...(linkage === 'same-message' ? { approvalCard } : {}),
    contentDraftCard: { draftId: 'draft-general', topic: '서비스 안내', variants: [{
      channel: 'threads', caption: '검토할 원고', hashtags: [], status: 'READY', statusLabel: '보관할 수 있어요',
      issues: [], contentId: 'content-general', versionId: 'version-general', vaultSavable: true,
    }] },
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') writes.push(String(input))
    if (String(input).includes('/agent/chat?')) return Response.json({ messages: [draftMessage,
      ...(linkage === 'same-message' ? [] : [{ id: 'legacy-approval', role: 'sohee', content: '이전 일반 승인', approvalCard,
        ...(linkage === 'same-mission' ? { missionId: 'mission-general', runId: 'other-run' } : { runId }) }]),
    ] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByText('일반 미션 원고', { selector: 'p' })
  expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument()
  expect(screen.getByText('원고·사진·계정·비용의 정확한 승인 조건을 먼저 확인해야 합니다.')).toBeInTheDocument()
  expect(writes).toHaveLength(0)
  view.unmount()
})

it.each(['unrelated-mission', 'no-draft', 'user-draft'])('%s의 별개 실행 승인은 원고 검토 차단에 묶이지 않는다', async scenario => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).includes('/agent/chat?')) return Response.json({ messages: [
      ...(scenario === 'no-draft' ? [] : [{ id: 'other-draft', role: scenario === 'user-draft' ? 'user' : 'sohee',
        content: '다른 원고', missionId: scenario === 'user-draft' ? 'approval-mission' : 'other-mission',
        runId: 'other-run', contentDraftCard: { draftId: 'other-draft', topic: '다른 원고', variants: [] } }]),
      { id: 'independent-approval', role: 'sohee', content: '별개 승인', missionId: 'approval-mission', runId,
        approvalCard: { decisionId: 'independent', title: '별개 업무 승인', options: [{ id: 'execute', label: '실행' }] } },
    ] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByRole('button', { name: '승인 및 실행' })).toBeEnabled()
  expect(screen.queryByText('원고·사진·계정·비용의 정확한 승인 조건을 먼저 확인해야 합니다.')).not.toBeInTheDocument()
  view.unmount()
})

it('복원된 계획의 버전으로 채널 변경을 요청하고 이전 승인 대신 새 diff를 보여준다', async () => {
  let chatBody: any
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/agent/chat') && init?.method === 'POST') {
      chatBody = JSON.parse(String(init.body))
      return Response.json({ content: '채널을 변경했습니다', step: 'AWAITING_APPROVAL', missionId: 'mission-1', planVersion: 2, runId,
        planCard: { planId: 'plan-new', title: '변경 계획', steps: [], totalSC: 12, requiresApproval: true, diffSummary: '인스타그램만 사용 · 할인 제외' } })
    }
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{ id: 'restored', role: 'sohee', content: '기존 계획', runId,
      usageMetadata: { missionId: 'mission-1', planVersion: 1 },
      planCard: { planId: 'plan-old', title: '홍보', steps: [], totalSC: 12, requiresApproval: true },
      approvalCard: { decisionId: 'old-approval', title: '이전 승인', options: [{ id: 'publish', label: '발행' }] },
    }] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByText('기존 계획', { selector: 'p' })
  const composer = screen.getByRole('textbox', { name: '소희에게 보낼 메시지' })
  fireEvent.change(composer, { target: { value: '인스타만 해줘' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  await screen.findByText('채널을 변경했습니다', { selector: 'p' })
  expect(chatBody).toMatchObject({ missionId: 'mission-1', previousRunId: runId, expectedPlanVersion: 1 })
  expect(screen.getByRole('region', { name: '계획 변경 내용' })).toHaveTextContent('인스타그램만 사용 · 할인 제외')
  expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument()
  view.unmount()
})

it('재진입하면 같은 미션의 이전 버전 승인만 차단하고 최신 승인은 유지한다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).includes('/agent/chat?')) return Response.json({ messages: [
      { id: 'old', role: 'sohee', content: '이전 계획', runId, usageMetadata: { missionId: 'mission-1', planVersion: 0 },
        approvalCard: { decisionId: 'old-approval', title: '이전 승인', options: [{ id: 'publish', label: '발행' }] } },
      { id: 'new', role: 'sohee', content: '새 계획', runId: 'run-new', usageMetadata: { missionId: 'mission-1', planVersion: 1 },
        approvalCard: { decisionId: 'new-approval', title: '새 승인', options: [{ id: 'publish', label: '발행' }] } },
    ] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByText('새 계획', { selector: 'p' })
  expect(screen.getAllByRole('button', { name: '승인 및 실행' })).toHaveLength(1)
  expect(screen.getByText(/초안이 변경되어 이전 승인을 사용할 수 없습니다/)).toBeInTheDocument()
  expect(screen.getByText('새 승인')).toBeInTheDocument()
  view.unmount()
})

it('복원된 미션과 실행으로 계획의 판단 근거를 연결한다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'restored-plan', role: 'sohee', content: '기존 작업 계획', runId,
      usageMetadata: { missionId: 'mission-1' },
      planCard: { planId: 'plan-1', title: '홍보', steps: [], totalSC: 12, requiresApproval: true },
    }] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByRole('button', { name: '판단 근거 펼치기' })).toBeInTheDocument()
  view.unmount()
})

it('여러 계획의 근거를 중복하지 않고 최신 미션의 독립 레일을 대화 밖에 연결한다', async () => {
  const evidenceReads: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [
      { id: 'old-plan', role: 'sohee', content: '이전 미션', runId, missionId: 'mission-old',
        planCard: { planId: 'plan-old', title: '이전 홍보', steps: [], totalSC: 12, requiresApproval: true } },
      { id: 'new-plan', role: 'sohee', content: '현재 미션', runId: 'run-current', missionId: 'mission-current',
        planCard: { planId: 'plan-current', title: '현재 홍보', steps: [], totalSC: 12, requiresApproval: true } },
    ] })
    if (url.includes('/agent/evidence?')) {
      evidenceReads.push(url)
      return Response.json({ workspaceId, missionId: 'mission-current', runId: 'run-current', evidence: {
        reservations: { state: 'UNKNOWN' }, channels: [], price: { state: 'UNKNOWN' },
      } })
    }
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  await screen.findByText('현재 미션', { selector: 'p' })
  const rail = screen.getByRole('complementary', { name: '미션 판단 근거' })
  expect(screen.getByRole('region', { name: '소희와의 대화' })).not.toContainElement(rail)
  expect(screen.getAllByRole('button', { name: '판단 근거 펼치기' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '판단 근거 펼치기' }))
  await screen.findByText('실제 조회 근거 확인 필요')
  expect(evidenceReads).toHaveLength(1)
  expect(new URL(evidenceReads[0], 'https://example.test').searchParams.get('missionId')).toBe('mission-current')
  expect(new URL(evidenceReads[0], 'https://example.test').searchParams.get('runId')).toBe('run-current')
  view.unmount()
})

it('계획 비용은 예상으로 표시하고 기존 승인을 대신하지 않는다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (String(input).includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'plan', role: 'sohee', content: '검토해 주세요', runId,
      planCard: { planId: 'plan-1', title: '홍보 초안', steps: [{ name: '초안 작성', sc: 12 }], totalSC: 12, requiresApproval: true },
    }] })
    return Response.json({ events: [], run_status: 'completed' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByText('예상 비용 · 12 크레딧')).toBeInTheDocument()
  expect(screen.getByText('계획 검토만으로 외부 작업이 실행되지 않습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '실행 승인' })).not.toBeInTheDocument()
  view.unmount()
})

it.each([undefined, { success: true }, { success: true, status: 'PROVIDER_ACCEPTED' }])('승인 접수 응답만으로 후속 실행 완료나 재개를 선언하지 않는다 (%j)', async executionResult => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/agent/approvals')) return Response.json({ success: true, status: 'APPROVED', executionResult })
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'approval', role: 'sohee', content: '발행 범위를 검토해 주세요',
      approvalCard: { decisionId: 'decision-1', title: '초안 발행 승인', options: [{ id: 'publish', label: '지금 발행' }] },
    }] })
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '승인 및 실행' }))
  await screen.findByText(/승인 완료/)
  expect(screen.queryAllByText(/후속 단계 실행을 완료|작업이 즉시 재개/)).toHaveLength(0)
  expect(screen.getAllByText(/실행 결과는 별도로 확인/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument()
  view.unmount()
})

it('승인 카드에서 검토한 버전을 보내고 버전 충돌을 승인 완료로 표시하지 않는다', async () => {
  let approvalBody: unknown
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/agent/approvals')) {
      approvalBody = JSON.parse(String(init?.body))
      return Response.json({ success: false, error: { code: 'VERSION_CONFLICT', message: '초안이 변경되었습니다.' } }, { status: 409 })
    }
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'approval', role: 'sohee', content: '발행 범위를 검토해 주세요',
      approvalCard: { decisionId: 'decision-1', title: '초안 발행 승인', expectedVersion: 3, options: [{ id: 'publish', label: '지금 발행' }] },
    }] })
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '승인 및 실행' }))
  await screen.findAllByText(/초안이 변경되었습니다/)
  expect(approvalBody).toEqual({ proposalId: 'decision-1', action: 'APPROVE', expectedVersion: 3 })
  expect(screen.queryByText(/승인 완료/)).not.toBeInTheDocument()
  expect(screen.getByText(/버전 충돌/)).toBeInTheDocument()
  view.unmount()
})

it('승인 반려를 이미 진행 중인 서버 작업의 취소 완료로 표현하지 않는다', async () => {
  const commands: unknown[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/agent/approvals')) {
      commands.push(JSON.parse(String(init?.body)))
      return Response.json({ success: true, status: 'REJECTED' })
    }
    if (url.includes('/agent/chat?')) return Response.json({ messages: [{
      id: 'approval', role: 'sohee', content: '발행 범위를 검토해 주세요',
      approvalCard: { decisionId: 'decision-1', title: '초안 발행 승인', options: [{ id: 'publish', label: '지금 발행' }] },
    }] })
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '반려' }))
  await screen.findByText(/반려가 기록되었습니다/)
  expect(screen.queryByText(/작업이 안전하게 취소/)).not.toBeInTheDocument()
  expect(commands).toEqual([{ proposalId: 'decision-1', action: 'REJECT' }])
  view.unmount()
})

it('작업 공간을 바꾸면 이전 대화와 새 활동 안내를 남기지 않는다', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(`/workspaces/${workspaceId}/agent/chat?`)) return Response.json({ messages: [{ id: 'old', role: 'sohee', content: '이전 작업 공간의 대화', runId }] })
    if (url.includes('/agent/activity?')) return Response.json({ events: [event(1, 'result_unknown')], run_status: 'completed' })
    return Response.json({ messages: [] })
  })
  const dock = (workspace: string) => <SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspace} /></ProposalBusProvider></SurfaceContextProvider>
  const view = render(dock(workspaceId))
  await screen.findByText('이전 작업 공간의 대화')
  await screen.findByRole('list', { name: '확인된 작업 활동' })
  view.rerender(dock('00000000-0000-0000-0000-000000000003'))
  await waitFor(() => expect(screen.queryByText('이전 작업 공간의 대화')).not.toBeInTheDocument())
  expect(screen.queryByRole('list', { name: '확인된 작업 활동' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /새 활동/ })).not.toBeInTheDocument()
  view.unmount()
})

it('한글 조합 중 Enter는 전송하지 않고 조합이 끝난 Enter만 전송한다', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    requests.push(String(input))
    return Response.json({ messages: [], reply: '초안을 준비합니다.' })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  const composer = screen.getByRole('textbox', { name: '소희에게 보낼 메시지' })
  fireEvent.change(composer, { target: { value: '금요일 빈 시간' } })
  fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
  expect(requests.filter(url => url.endsWith('/agent/chat'))).toHaveLength(0)
  expect(composer).toHaveValue('금요일 빈 시간')
  fireEvent.keyDown(composer, { key: 'Enter', isComposing: false })
  await screen.findByText('초안을 준비합니다.')
  expect(requests.filter(url => url.endsWith('/agent/chat'))).toHaveLength(1)
  view.unmount()
})

it('인증 만료 뒤에는 다음 확인 시각을 계속 약속하지 않는다', async () => {
  let requests = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/agent/chat')) {
      return new Response(`event: run\ndata: ${JSON.stringify({ runId })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url.includes('/agent/activity?')) {
      requests++
      return requests === 1 ? Response.json({ events: [], run_status: 'executing' }) : new Response('expired', { status: 401 })
    }
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} autoSendMessage={{ id: 'expired-follow', text: '작업 상태 알려줘' }} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByText(/다음 확인:/)).toBeInTheDocument()
  await waitFor(() => expect(requests).toBe(2), { timeout: 3_000 })
  await waitFor(() => expect(screen.queryByText(/다음 확인:/)).not.toBeInTheDocument())
  view.unmount()
})

it('실행 중 복구는 다음 확인 시각을 알리고 조회 중지만 제공하며 서버 작업을 취소하지 않는다', async () => {
  let replaySignal: AbortSignal | null | undefined
  const requests: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method })
    if (url.endsWith('/agent/chat')) {
      return new Response(`event: run\ndata: ${JSON.stringify({ runId })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url.includes('/agent/activity?')) {
      replaySignal = init?.signal
      return Response.json({ events: [], run_status: 'executing' })
    }
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} autoSendMessage={{ id: 'follow-test', text: '작업 상태 알려줘' }} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByText(/다음 확인:/)).toBeInTheDocument()
  expect(screen.getByText('화면 조회만 멈추며 진행 중인 작업은 유지돼요.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '활동 조회 멈추기' }))
  expect(replaySignal?.aborted).toBe(true)
  expect(await screen.findByText('활동 조회를 멈췄어요. 결과는 잠시 후 확인해 주세요.')).toBeInTheDocument()
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1)
  expect(requests.some(request => /cancel|pause/.test(request.url))).toBe(false)
  view.unmount()
})

it('재진입한 실행 중 대화도 다음 확인을 안내하고 GET으로 늦은 활동을 복원한다', async () => {
  let replays = 0
  const methods: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET')
    const url = String(input)
    if (url.includes('/agent/chat?')) return Response.json({ messages: [
      { id: 'saved-message', role: 'sohee', content: '이전 대화', runId },
    ] })
    if (url.includes('/agent/activity?')) {
      replays++
      return Response.json(replays === 1 ? { events: [], run_status: 'executing' }
        : { events: [event(1, 'result_unknown')], run_status: 'completed' })
    }
    return Response.json({ messages: [] })
  })
  const view = render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByText(/다음 확인:/)).toBeInTheDocument()
  expect(await screen.findByText('실행 결과를 아직 확인하지 못했습니다.', {}, { timeout: 3_000 })).toBeInTheDocument()
  expect(screen.queryByText(/다음 확인:/)).not.toBeInTheDocument()
  expect(replays).toBe(2)
  expect(methods.every(method => method === 'GET')).toBe(true)
  view.unmount()
})

it('새 Dock 두 개는 대화의 영속 run을 각각 GET으로 복원하며 POST를 보내지 않는다', async () => {
  const requests: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method })
    if (url.includes('/agent/chat?')) return Response.json({ messages: [
      { id: 'saved-message', role: 'sohee', content: '이전 대화', runId },
    ] })
    if (url.includes('/agent/activity?')) return Response.json({ events: [event(1, 'result_unknown')], run_status: 'completed' })
    return Response.json({ messages: [] })
  })
  const dock = <SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} /></ProposalBusProvider></SurfaceContextProvider>
  const first = render(dock)
  const second = render(dock)
  await waitFor(() => {
    expect(first.container.querySelector('[aria-label="확인된 작업 활동"]')).toHaveTextContent('실행 결과를 아직 확인하지 못했습니다.')
    expect(second.container.querySelector('[aria-label="확인된 작업 활동"]')).toHaveTextContent('실행 결과를 아직 확인하지 못했습니다.')
  })
  expect(requests.filter(r => r.url.includes('/agent/activity?'))).toHaveLength(2)
  expect(requests.some(r => r.method === 'POST')).toBe(false)
  first.unmount()
  second.unmount()
})

it('테넌트 변경 뒤 늦은 활동 복구 응답을 새 화면에 섞지 않는다', async () => {
  let resolveReplay!: (response: Response) => void
  let replaySignal: AbortSignal | null | undefined
  const replay = new Promise<Response>(resolve => { resolveReplay = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes(`/workspaces/${workspaceId}/agent/chat?`)) return Response.json({ messages: [
      { id: 'saved-message', role: 'sohee', content: '이전 대화', runId },
    ] })
    if (url.includes('/agent/activity?')) {
      replaySignal = init?.signal
      return replay
    }
    return Response.json({ messages: [] })
  })
  const dock = (workspace: string) => <SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspace} /></ProposalBusProvider></SurfaceContextProvider>
  const view = render(dock(workspaceId))
  await waitFor(() => expect(replaySignal).toBeDefined())
  view.rerender(dock('00000000-0000-0000-0000-000000000003'))
  expect(replaySignal?.aborted).toBe(true)
  await act(async () => { resolveReplay(Response.json({ events: [event(1, 'result_unknown')] })); await replay })
  expect(view.container.querySelector('[aria-label="확인된 작업 활동"]')).toBeNull()
  view.unmount()
})

it('Dock은 단절 후 GET으로 활동을 복구해 유지하고 실행 POST를 반복하지 않는다', async () => {
  const requests: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method })
    if (url.endsWith('/agent/chat')) {
      const text = `event: run\ndata: ${JSON.stringify({ runId })}\n\nevent: activity\ndata: ${JSON.stringify(event(1, 'request_received'))}\n\n`
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url.includes('/agent/activity?')) return Response.json({ events: [event(2, 'result_unknown')], run_status: 'completed' })
    return Response.json({ messages: [] })
  })
  render(<SurfaceContextProvider><ProposalBusProvider><SoheeAgentDock workspaceId={workspaceId} autoSendMessage={{ id: 'activity-test', text: '작업 상태 알려줘' }} /></ProposalBusProvider></SurfaceContextProvider>)
  expect(await screen.findByText('실행 결과를 아직 확인하지 못했습니다.')).toBeInTheDocument()
  expect(screen.getByText('요청을 접수했습니다.')).toBeInTheDocument()
  expect(screen.queryByText('secret raw arguments')).not.toBeInTheDocument()
  await waitFor(() => expect(requests.filter(r => r.url.endsWith('/agent/chat'))).toHaveLength(1))
  expect(requests.find(r => r.url.includes('/agent/activity?'))).toEqual({
    url: `/api/workspaces/${workspaceId}/agent/activity?runId=${runId}&last-seq=1`, method: 'GET',
  })
})
