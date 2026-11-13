'use client'

import { useId, useState } from 'react'
import { CheckCircle2, Loader2, AlertCircle, Circle, ChevronDown, PauseCircle } from 'lucide-react'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { TaskProgressList } from './task-progress-list'
import type { TaskTimelineMessageArtifact, TaskTimelineStepStatus } from './stream-events'

const labels: Record<TaskTimelineStepStatus, string> = {
  pending: '대기', in_progress: '진행 중', completed: '완료', failed: '실패',
  cancelled: '중단', unknown: '결과 확인 필요', awaiting_approval: '승인 대기',
}

export interface ConversationTaskTimelineProps {
  timeline: TaskTimelineMessageArtifact
  defaultCollapsed?: boolean
  messageStatus?: 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled'
}

export function ConversationTaskTimeline({ timeline, defaultCollapsed, messageStatus }: Readonly<ConversationTaskTimelineProps>) {
  const contentId = useId()
  const completed = timeline.steps.filter(step => step.status === 'completed').length
  const allCompleted = timeline.steps.length > 0 && completed === timeline.steps.length
  const finalizing = allCompleted && (messageStatus === 'queued' || messageStatus === 'streaming')
  const unsuccessful = messageStatus === 'failed' || messageStatus === 'cancelled'
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const r2Mobile = useMobileR2Active()
  const isCollapsed = collapsed ?? (!timeline.isLive && allCompleted)
  if (!timeline.steps.length) return null
  // 모바일: 진행 중이거나 끝나지 않은 계획은 '소희가 일하고 있어요' 진행 목록으로 보여 준다(끝난 계획은 아래 접힌 요약).
  if (r2Mobile && (timeline.isLive || !allCompleted) && !unsuccessful) {
    return <TaskProgressList tasks={timeline.steps.map(step => ({ id: step.id, title: step.title, status: step.status, durationMs: step.durationMs }))} />
  }
  const needsCheck = timeline.steps.some(step => ['failed', 'unknown', 'cancelled', 'awaiting_approval'].includes(step.status))

  return <section aria-label="소희의 작업 진행 계획" className="my-3 min-w-0 overflow-hidden rounded-xl border border-border bg-card text-foreground">
    <button type="button" aria-label={isCollapsed ? '작업 내역 펼치기' : '작업 내역 접기'}
      aria-expanded={!isCollapsed} aria-controls={contentId} onClick={() => setCollapsed(!isCollapsed)}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
      {timeline.isLive || finalizing ? <Loader2 aria-hidden="true" className="size-4 shrink-0 text-primary motion-safe:animate-spin" />
        : allCompleted && !unsuccessful ? <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-primary" />
        : <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 break-words text-sm font-medium">{timeline.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{unsuccessful ? '결과 확인 필요' : finalizing ? '응답 마무리 중' : `${completed} / ${timeline.steps.length} 완료`}</span>
      <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground ${isCollapsed ? '' : 'rotate-180'}`} />
    </button>
    {needsCheck ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">{timeline.steps.some(step => step.status === 'awaiting_approval') ? '사장님 승인 대기' : '결과 확인 필요'}</p> : null}
    {!isCollapsed ? <ol id={contentId} aria-label="작업 단계" className="space-y-2 border-t border-border px-3 py-3">
      {timeline.steps.map(step => {
        const running = step.status === 'in_progress' && timeline.isLive
        const Icon = step.status === 'completed' ? CheckCircle2 : running ? Loader2
          : step.status === 'failed' || step.status === 'unknown' ? AlertCircle
          : step.status === 'cancelled' || step.status === 'awaiting_approval' ? PauseCircle : Circle
        return <li key={step.id} data-task-status={step.status} className="flex min-w-0 items-start gap-2 text-sm leading-relaxed">
          <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${running ? 'text-primary motion-safe:animate-spin' : 'text-muted-foreground'}`} />
          <span className={`min-w-0 flex-1 break-words ${step.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'}`}>{step.title}</span>
          <span className="shrink-0 text-xs leading-relaxed text-muted-foreground">{labels[step.status]}</span>
          {step.durationMs !== undefined ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{(step.durationMs / 1000).toFixed(1)}초</span> : null}
        </li>
      })}
    </ol> : null}
  </section>
}
