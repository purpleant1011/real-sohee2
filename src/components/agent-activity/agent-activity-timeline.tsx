'use client'

import React, { useId, useState, useMemo } from 'react'
import { ChevronDown, Circle, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'
import {
  projectActivityEvent,
  type AgentActivityEvent,
} from '@/features/agent-activity/activity-event'

export interface AgentActivityTimelineProps {
  events: AgentActivityEvent[]
  filterWorkspaceId?: string | null
  filterMissionId?: string | null
  filterRunId?: string | null
  title?: string
}

export function AgentActivityTimeline({
  events,
  filterWorkspaceId,
  filterMissionId,
  filterRunId,
  title = '소희의 작업 활동',
}: AgentActivityTimelineProps) {
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()

  const activities = useMemo(() => {
    return events
      .map(projectActivityEvent)
      .filter((ev): ev is AgentActivityEvent => {
        if (!ev) return false
        if (filterWorkspaceId && ev.workspace_id !== filterWorkspaceId) return false
        if (filterMissionId && ev.mission_id !== filterMissionId) return false
        if (filterRunId && ev.run_id !== filterRunId) return false
        return true
      })
      .sort((a, b) => a.sequence - b.sequence)
  }, [events, filterWorkspaceId, filterMissionId, filterRunId])

  if (activities.length === 0) return null

  const hasFailedOrUnknown = activities.some((ev) =>
    ['failed', 'blocked', 'result_unknown'].includes(ev.lifecycle)
  )

  return (
    <section
      aria-label="소희의 작업 활동 기록"
      className="min-w-0 rounded-2xl border border-border bg-card p-3.5 text-xs text-foreground shadow-2xs"
    >
      <button
        type="button"
        aria-label="소희의 활동"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-foreground hover:opacity-90 active:opacity-75 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span>
            {title} · {activities.length}건
          </span>
          {hasFailedOrUnknown && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              확인 필요
            </span>
          )}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div id={contentId} className="mt-2 space-y-3">
          <ol aria-label="확인된 작업 활동" className="divide-y divide-border">
            {activities.map((event) => {
              const verified = event.lifecycle === 'verified' && !event.simulated
              const isFailed = event.lifecycle === 'failed' || event.lifecycle === 'blocked'
              const isUnknown = event.lifecycle === 'result_unknown'

              // 24~28px circular status indicator
              return (
                <li
                  key={event.event_id}
                  className="flex min-w-0 items-start gap-2.5 py-3 first:pt-1 last:pb-1"
                >
                  <div
                    className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      verified
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : isFailed
                        ? 'bg-destructive/10 text-destructive'
                        : isUnknown
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-primary/10 text-primary'
                    }`}
                    aria-hidden="true"
                  >
                    {verified ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : isFailed ? (
                      <AlertCircle className="size-3.5" />
                    ) : isUnknown ? (
                      <AlertTriangle className="size-3.5" />
                    ) : (
                      <Circle className="size-2.5 fill-current" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words leading-relaxed text-foreground">
                      {event.simulated && (
                        <span className="font-semibold text-purple-600 dark:text-purple-400">
                          시안·연습 ·{' '}
                        </span>
                      )}
                      {event.user_visible_summary}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <time dateTime={event.observed_at}>
                        {new Date(event.observed_at).toLocaleTimeString('ko-KR', {
                          timeZone: 'Asia/Seoul',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </time>
                      {verified && <span>· 확인 완료</span>}
                      {isUnknown && <span>· 결과 확인 대기</span>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {hasFailedOrUnknown && (
            <div
              role="note"
              className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"
            >
              확인이 필요한 작업이 있어요. 이전 기록은 안전하게 보존돼요.
            </div>
          )}
        </div>
      )}
    </section>
  )
}
