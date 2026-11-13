'use client'

import { useState } from 'react'
import { MessageCard } from '@/features/chat/message-card'
import { AgentWorkspace } from '@/features/mobile-chat/agent-workspace'
import { projectActivityEvent } from '@/features/agent-activity/activity-event'
import type { TaskTimelineMessageArtifact, TaskTimelineStepStatus } from '@/features/chat/stream-events'
import { Button } from '@/components/ui/button'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const kinds = ['tool_read_verified', 'tool_read_started'] as const
const activities = kinds.map((kind, index) => projectActivityEvent({ event_id: `33333333-3333-4333-8333-33333333333${index}`,
  workspace_id: workspaceId, run_id: runId, mission_id: null, step_id: String(index + 1), sequence: index + 1,
  observed_at: '2026-10-28T00:00:00Z', kind, simulated: false })!)
const titles = ['승인된 가게 정보 확인', '독자 질문에 맞춰 원고 작성', '원고의 사실·표현 검수', '이미지 준비와 결과물 저장']

export function TaskTimelinePreview() {
  const [state, setState] = useState<'running' | 'complete' | 'failed' | 'unknown' | 'cancelled'>('running')
  const statuses: TaskTimelineStepStatus[] = state === 'complete' ? titles.map(() => 'completed')
    : ['completed', state === 'running' ? 'in_progress' : state, 'pending', 'pending']
  const timeline: TaskTimelineMessageArtifact = { id: 'preview', kind: 'task_timeline', title: '소희의 작업 계획',
    steps: titles.map((title, i) => ({ id: String(i), title, status: statuses[i] })),
    totalSteps: 4, completedSteps: state === 'complete' ? 4 : 1, isLive: state === 'running' }
  return <main className="mx-auto max-w-3xl space-y-5 p-4 text-foreground">
    <header className="space-y-2"><p className="text-xs text-muted-foreground">개발 검증 · 합성 시나리오</p>
      <h1 className="text-lg font-semibold">소희의 작업이 보이는 대화</h1>
      <p className="text-sm text-muted-foreground">제품 컴포넌트의 상태 확인용입니다. 실제 조회·생성·DB 저장·외부 게시·비용 차감은 실행하지 않습니다.</p></header>
    <nav aria-label="검증 상태 선택" className="flex flex-wrap gap-2">
      {([['running','진행 중'],['complete','완료'],['failed','실패'],['unknown','연결 끊김'],['cancelled','중단']] as const).map(([value,label]) =>
        <Button key={value} variant={state === value ? 'default' : 'outline'} className="min-h-11" onClick={() => setState(value)}>{label}</Button>)}
    </nav>
    <ol aria-label="제품 대화 컴포넌트"><MessageCard artifacts={[timeline]} message={{ id: 'preview-message', workspaceId,
      threadId: runId, role: 'sohee', content: state === 'complete' ? '검토할 원고를 준비했어요. 게시 전 확인해 주세요.' : '사장님이 확인한 정보로 원고를 준비하고 있어요.',
      status: state === 'running' ? 'streaming' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'cancelled' : 'completed',
      workItemId: null, createdAt: '2026-10-28T00:00:00Z', completedAt: null }} /></ol>
    <section aria-label="모바일 R2 동일 사건 표시" className="space-y-2"><h2 className="text-sm font-medium">모바일 R2 · 영속 활동 연동</h2>
      <AgentWorkspace snapshot={{ loadState: 'ready', complete: true, bubbles: [], checkedAt: null,
        agentRunId: runId, activities, sending: state === 'running', uncertain: state === 'unknown' }} />
    </section>
  </main>
}
