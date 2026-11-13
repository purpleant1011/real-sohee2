import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { projectActivityEvent } from '@/features/agent-activity/activity-event'
import { MobileChatView, type ChatViewSnapshot } from './mobile-chat-view'
import { AgentWorkspace } from './agent-workspace'

const RUN = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
function event(kind: string, sequence: number, step: string | null = null, run = RUN, simulated = false) {
  return projectActivityEvent({ event_id: `55555555-5555-4555-8555-${String(sequence).padStart(12, '0')}`, workspace_id: '11111111-1111-4111-8111-111111111111', run_id: run, mission_id: null, step_id: step, sequence, observed_at: '2026-10-28T01:00:00Z', kind, simulated })!
}
function snapshot(overrides: Partial<ChatViewSnapshot> = {}): ChatViewSnapshot {
  return { loadState: 'ready', complete: true, checkedAt: null, bubbles: [], agentRunId: RUN, ...overrides }
}

describe('대화 안의 에이전트 작업 내역', () => {
  it('모바일 작업 헤더는 중복 사건이 아닌 현재 작업의 완료 개수를 표시한다', () => {
    render(<AgentWorkspace snapshot={snapshot({ sending: true, activities: [event('tool_read_started', 1, '1'), event('tool_read_verified', 2, '1'), event('tool_read_started', 3, '2')] })} />)
    expect(screen.getByText('1 / 2 완료')).toBeVisible()
  })
  it('현재 요청의 작업을 답변 앞에 배치한다', () => {
    render(<MobileChatView onSend={vi.fn()} snapshot={snapshot({ bubbles: [
      { id: 'q', role: 'owner', text: '게시물 준비해줘', pending: false, evidence: [], approval: null },
      { id: 'a', role: 'sohee', text: '검토할 내용을 준비했어요.', pending: false, evidence: [], approval: null },
    ], activities: [event('request_received', 1), event('approval_needed', 2)] })} />)
    const transcript = screen.getByRole('list', { name: '대화 내용' })
    const work = within(transcript).getByRole('region', { name: '소희의 작업 활동 기록' })
    expect(work.compareDocumentPosition(screen.getByText('검토할 내용을 준비했어요.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('동일 단계의 시작·결과는 최신 한 줄로 합치고 실제 확인만 체크한다', () => {
    render(<AgentWorkspace snapshot={snapshot({ sending: true, activities: [event('tool_read_started', 1, '1'), event('tool_read_verified', 2, '1'), event('tool_read_started', 3, '2')] })} />)
    const list = screen.getByRole('list', { name: '확인된 작업 활동' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('도구의 정보 조회가 확인되었습니다.').closest('li')).toHaveAttribute('data-work-state', 'verified')
    expect(within(list).getByText('연결된 도구에서 정보를 조회하고 있습니다.').closest('li')).toHaveAttribute('data-work-state', 'active')
    expect(screen.getByRole('status')).toHaveTextContent('소희가 요청을 처리하고 있어요')
  })

  it('앞선 단계의 후속 사건도 최신 순서로 배치해 승인 필요 상태를 유지한다', () => {
    render(<AgentWorkspace snapshot={snapshot({ activities: [event('tool_read_started', 1, '1'), event('tool_read_verified', 2, '2'), event('approval_needed', 3, '1')] })} />)
    const items = within(screen.getByRole('list', { name: '확인된 작업 활동' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('실행 전 사장님의 승인이 필요합니다.')
    expect(screen.getByText('사장님 확인 필요')).toBeVisible()
  })

  it('응답이 끝나면 미확인 실행을 회전 표시나 완료로 바꾸지 않는다', () => {
    render(<AgentWorkspace snapshot={snapshot({ activities: [event('provider_accepted', 1, '1')] })} />)
    expect(screen.getByText('외부 서비스가 요청을 접수했습니다. 결과 확인이 필요합니다.').closest('li')).toHaveAttribute('data-work-state', 'unconfirmed')
    expect(screen.getByText('결과 확인 필요')).toBeVisible()
    expect(screen.queryByText('작업 완료')).not.toBeInTheDocument()
  })

  it('다른 실행·중복 이벤트를 제외하고 작업 내역을 접고 펼친다', () => {
    const item = event('approval_needed', 1)
    render(<AgentWorkspace snapshot={snapshot({ activities: [item, item, event('tool_read_verified', 2, '1', OTHER)] })} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    const toggle = screen.getByRole('button', { name: '소희의 활동' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: '확인된 작업 활동' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByRole('list', { name: '확인된 작업 활동' })).toBeVisible()
  })

  it('연습 기록은 실확인 체크로 바꾸지 않고 계획은 제안으로 남긴다', () => {
    render(<AgentWorkspace snapshot={snapshot({ activities: [event('tool_read_verified', 1, '1', RUN, true)], agentResult: { content: '검토해 주세요', links: [], plan: { title: '게시물 준비', steps: ['사진 고르기', '게시 전 검토'] } } })} />)
    expect(screen.getByText('도구의 정보 조회가 확인되었습니다.').closest('li')).toHaveAttribute('data-work-state', 'simulated')
    expect(screen.getByText('시안·연습')).toBeVisible()
    expect(screen.getByRole('region', { name: '제안한 작업 계획' })).toHaveTextContent('실행 완료 내역이 아니에요')
  })

  it('아직 활동이 없으면 가짜 체크리스트 대신 요청 전달 상태만 보여준다', () => {
    render(<AgentWorkspace snapshot={snapshot({ sending: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent('요청을 전달하고 있어요')
    expect(screen.queryByRole('list', { name: '확인된 작업 활동' })).not.toBeInTheDocument()
  })

  it('실시간 진행 상태(progress)가 전달되면 현재 단계 타이틀과 상세 안내를 표시한다', () => {
    render(<AgentWorkspace snapshot={snapshot({
      sending: true,
      progress: { kind: 'planning', stepIndex: 0, title: '작업 준비', detail: '요청을 확인하고 있습니다.' }
    })} />)
    const progressEl = screen.getByRole('status')
    expect(progressEl).toHaveTextContent('작업 준비')
    expect(progressEl).toHaveTextContent('요청을 확인하고 있습니다.')
  })
})
