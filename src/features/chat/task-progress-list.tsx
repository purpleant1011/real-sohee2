'use client'

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Hand,
  HelpCircle,
  Loader2,
  PauseCircle,
  Sparkles,
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import {
  progressPercent,
  type FlowTaskStatus,
} from './research-flow-model'

export type ProgressTaskItem = {
  id: string
  title: string
  detail?: string
  status: FlowTaskStatus
  channel?: string
  estimatedCredits?: number
  durationMs?: number
}

export interface TaskProgressListProps {
  tasks: readonly ProgressTaskItem[]
  title?: string
}

function StatusIcon({ status }: { status: FlowTaskStatus }) {
  switch (status) {
    case 'in_progress':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 motion-safe:animate-pulse"
        >
          <Loader2 className="size-3.5 text-primary motion-safe:animate-spin" />
        </span>
      )
    case 'completed':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10"
        >
          <CheckCircle2 className="size-3.5 text-primary" />
        </span>
      )
    case 'awaiting_approval':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
        >
          <Hand className="size-3.5" />
        </span>
      )
    case 'failed':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/10"
        >
          <AlertCircle className="size-3.5 text-destructive" />
        </span>
      )
    case 'cancelled':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
        >
          <PauseCircle className="size-3.5 text-muted-foreground" />
        </span>
      )
    case 'unknown':
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
        >
          <HelpCircle className="size-3.5 text-muted-foreground" />
        </span>
      )
    case 'pending':
    default:
      return (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
        >
          <Clock className="size-3.5 text-muted-foreground" />
        </span>
      )
  }
}

const statusLabels: Record<FlowTaskStatus, string> = {
  pending: '대기 중',
  in_progress: '진행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '중단',
  unknown: '확인 필요',
  awaiting_approval: '승인 대기',
}

export function TaskProgressList({
  tasks,
  title = '소희가 일하고 있어요',
}: Readonly<TaskProgressListProps>) {
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const totalCount = tasks.length
  const percent = progressPercent(tasks)
  const allCompleted = totalCount > 0 && completedCount === totalCount

  const inProgressTask = tasks.find((t) => t.status === 'in_progress')
  const awaitingApprovalTask = tasks.find((t) => t.status === 'awaiting_approval')
  const failedTask = tasks.find((t) => t.status === 'failed')

  let announcement = '소희의 작업 대기 중입니다.'
  if (allCompleted) {
    announcement = '소희의 모든 작업이 완료되었습니다.'
  } else if (inProgressTask) {
    announcement = `소희가 현재 작업 중이에요: ${inProgressTask.title}`
  } else if (awaitingApprovalTask) {
    announcement = `사장님의 확인을 기다리고 있어요: ${awaitingApprovalTask.title}`
  } else if (failedTask) {
    announcement = `소희의 작업 중 확인이 필요한 단계가 있어요: ${failedTask.title}`
  } else if (totalCount > 0) {
    announcement = `소희가 작업을 진행하고 있어요 (${completedCount}/${totalCount} 완료)`
  }

  return (
    <section
      aria-label="소희의 작업 진행 상황"
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xs"
    >
      {/* Live announcement region for screen readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {completedCount}/{totalCount} 완료
          </span>
        </div>

        <Progress value={percent} className="h-1.5 bg-muted" />
      </header>

      {tasks.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {tasks.map((task) => {
            const isCurrent = task.status === 'in_progress'

            return (
              <li
                key={task.id}
                data-task-status={task.status}
                data-active={isCurrent ? 'true' : undefined}
                className={`flex items-start gap-3 rounded-xl border motion-safe:transition-all ${
                  isCurrent
                    ? 'border-primary/40 bg-primary/10 p-3.5 shadow-xs dark:border-primary/50 dark:bg-primary/15'
                    : 'border-border/60 bg-card/60 p-2.5 dark:border-border/40'
                }`}
              >
                <div className="mt-0.5">
                  <StatusIcon status={task.status} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`min-w-0 flex-1 break-words text-sm font-medium leading-snug ${
                        task.status === 'completed'
                          ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                          : isCurrent
                            ? 'text-foreground font-semibold'
                            : 'text-foreground'
                      }`}
                    >
                      {task.title}
                    </span>
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        isCurrent
                          ? 'font-semibold text-primary'
                          : task.status === 'awaiting_approval'
                            ? 'font-medium text-primary'
                            : task.status === 'failed'
                              ? 'font-medium text-destructive'
                              : 'text-muted-foreground'
                      }`}
                    >
                      {statusLabels[task.status]}
                    </span>
                  </div>

                  {task.detail ? (
                    <p
                      className={`mt-1 break-words text-xs leading-relaxed ${
                        isCurrent ? 'text-foreground/80' : 'text-muted-foreground'
                      }`}
                    >
                      {task.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}
