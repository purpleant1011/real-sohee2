'use client'

import { CheckCircle2 } from 'lucide-react'
import type { ResearchPlan } from './research-flow-model'

export interface ResearchPlanCardProps {
  plan: ResearchPlan
  onApprove?: () => void
  onRequestChange?: () => void
  disabled?: boolean
  approved?: boolean
}

export function ResearchPlanCard({
  plan,
  onApprove,
  onRequestChange,
  disabled = false,
  approved = false,
}: Readonly<ResearchPlanCardProps>) {
  return (
    <section
      aria-label="계획 제안"
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xs"
    >
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">이 방향으로 진행할게요</h3>
        {plan.summary ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{plan.summary}</p>
        ) : null}
      </header>

      {plan.direction && plan.direction.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-3.5">
          <span className="text-xs font-medium text-muted-foreground">핵심 진행 방향</span>
          <ul className="mt-2 space-y-1.5 text-sm">
            {plan.direction.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-foreground">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.tasks && plan.tasks.length > 0 ? (
        <div className="mt-4">
          <span className="text-xs font-medium text-muted-foreground">할 일 목록</span>
          <ol className="mt-2 space-y-2">
            {plan.tasks.map((task, index) => (
              <li
                key={task.id || index}
                className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{task.title}</span>
                  </div>
                  {task.detail ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {task.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {approved ? (
        <div
          role="status"
          className="mt-5 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="font-medium text-foreground">승인했어요</span>
          <span className="text-xs text-muted-foreground">· 소희가 곧 작업을 시작해요</span>
        </div>
      ) : (
        <footer className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            disabled={disabled || !onRequestChange}
            onClick={onRequestChange}
            className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          >
            수정할래요
          </button>
          <button
            type="button"
            disabled={disabled || !onApprove}
            onClick={onApprove}
            className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          >
            이대로 시작
          </button>
        </footer>
      )}
    </section>
  )
}
