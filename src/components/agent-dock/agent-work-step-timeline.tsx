'use client'

import React, { useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Cpu,
} from 'lucide-react'

export interface WorkStepItem {
  stepIndex: number
  kind: 'planning' | 'step_started' | 'step_done' | 'step_failed' | 'awaiting_approval'
  title: string
  detail?: string
}

export interface AgentWorkStepTimelineProps {
  steps: readonly WorkStepItem[]
  isRunning?: boolean
}

export function AgentWorkStepTimeline({
  steps,
  isRunning = false,
}: Readonly<AgentWorkStepTimelineProps>) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (!steps || steps.length === 0) return null

  const doneCount = steps.filter((s) => s.kind === 'step_done').length
  const totalCount = steps.length

  return (
    <div
      aria-label="소희의 작업 진행 타임라인"
      className="rounded-xl border border-purple-200/80 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 p-3 text-xs space-y-2.5 transition-all shadow-2xs"
    >
      {/* 헤더 바 */}
      <div className="flex items-center justify-between gap-2 border-b border-purple-100 dark:border-purple-900/30 pb-2">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 aria-hidden="true" className="size-3.5 text-purple-600 animate-spin shrink-0" />
          ) : (
            <Cpu aria-hidden="true" className="size-3.5 text-purple-600 shrink-0" />
          )}
          <span className="font-extrabold text-foreground">
            {isRunning ? '소희가 업무를 수행하고 있어요' : '소희의 작업 진행 내역'}
          </span>
          <span className="px-1.5 py-0.2 rounded-md bg-purple-200/60 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 text-[10px] font-bold">
            {doneCount} / {totalCount}단계
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-[11px] font-bold text-muted-foreground hover:text-foreground flex items-center gap-0.5 cursor-pointer p-1 rounded-md hover:bg-muted/50"
          aria-label={isCollapsed ? '펼치기' : '접기'}
        >
          <span>{isCollapsed ? '펼치기' : '접기'}</span>
          {isCollapsed ? (
            <ChevronDown aria-hidden="true" className="size-3" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-3" />
          )}
        </button>
      </div>

      {/* 스텝 목록 */}
      {!isCollapsed ? (
        <ol className="space-y-2 pt-0.5">
          {steps.map((step) => {
            const isDone = step.kind === 'step_done'
            const isFailed = step.kind === 'step_failed'
            const isAwaiting = step.kind === 'awaiting_approval'
            const isRunningStep = step.kind === 'step_started' || step.kind === 'planning'

            return (
              <li
                key={`${step.stepIndex}-${step.title}`}
                className="flex items-start gap-2 text-[11px] leading-relaxed"
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" />
                  ) : isFailed ? (
                    <AlertCircle aria-hidden="true" className="size-3.5 text-rose-600" />
                  ) : isAwaiting ? (
                    <UserCheck aria-hidden="true" className="size-3.5 text-amber-600" />
                  ) : isRunningStep ? (
                    <Loader2 aria-hidden="true" className="size-3.5 text-purple-600 animate-spin" />
                  ) : (
                    <div className="size-3.5 rounded-full border border-border" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <span
                    className={`font-semibold ${
                      isDone
                        ? 'text-foreground/90'
                        : isRunningStep
                        ? 'text-purple-700 dark:text-purple-300 font-bold'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {step.title}
                  </span>
                  {step.detail ? (
                    <span className="text-[10px] text-muted-foreground ml-1.5 font-normal">
                      ({step.detail})
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
