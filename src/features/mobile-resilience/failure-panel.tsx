'use client'

import { classifyFailure, type FailureView } from './resume-model'

export interface FailurePanelProps {
  status: number | 'network'
  onAction?: (next: FailureView['next']) => void
}

/** 오류별 다음 행동 1개. 오류를 빈 화면·성공 표시로 바꾸지 않는다. */
export function FailurePanel({ status, onAction }: FailurePanelProps) {
  const v = classifyFailure(status)
  return (
    <div role="alert" className="space-y-2 rounded-2xl border border-border bg-card p-4 text-foreground">
      <p className="text-base font-semibold">{v.title}</p>
      <p className="text-sm leading-5 text-muted-foreground">{v.message}</p>
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        onClick={() => onAction?.(v.next)}
      >
        {v.nextLabel}
      </button>
    </div>
  )
}
