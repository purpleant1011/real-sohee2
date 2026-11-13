'use client'

import React, { useId, useState, useMemo } from 'react'
import {
  projectActivityEvent,
  type AgentActivityEvent,
} from '@/features/agent-activity/activity-event'

export interface AgentReasonSummaryProps {
  events: AgentActivityEvent[]
  filterWorkspaceId?: string | null
  filterMissionId?: string | null
  filterRunId?: string | null
}

export function AgentReasonSummary({
  events,
  filterWorkspaceId,
  filterMissionId,
  filterRunId,
}: AgentReasonSummaryProps) {
  const [expanded, setExpanded] = useState(false)
  const evidenceId = useId()

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

  // Verified facts: only externally verified independent readbacks, excluding simulations
  const facts = activities.filter(
    (event) => event.kind === 'externally_verified' && !event.simulated
  )

  const latest = activities.at(-1)!
  const nextAction =
    latest.lifecycle === 'approval_needed' || latest.lifecycle === 'proposed'
      ? '초안을 검토해 주세요. 승인 전에는 실행하지 않아요.'
      : ['result_unknown', 'failed', 'blocked'].includes(latest.lifecycle)
      ? '연결 상태를 확인해 주세요. 자동으로 다시 발송하지 않습니다.'
      : '새 활동을 기다리고 있어요. 확인된 결과만 표시해요.'

  return (
    <section
      aria-label="판단 요약"
      className="min-w-0 space-y-3 rounded-2xl border border-purple-200/80 bg-purple-50/60 p-3.5 text-xs leading-relaxed text-foreground dark:border-purple-900/40 dark:bg-purple-950/20 shadow-2xs"
    >
      <h3 className="font-semibold text-purple-700 dark:text-purple-300">
        판단 요약 · 확인한 범위
      </h3>

      <div className="space-y-1.5 text-foreground/90">
        <p>
          <strong className="text-foreground">확인된 사실</strong> · 독립 조회 기록 {facts.length}건
        </p>
        <p>
          <strong className="text-foreground">판단·가설</strong> · 활동 기록만으로 성과를 단정하지 않아요.
        </p>
        <p>
          <strong className="text-foreground">다음 행동</strong> · {nextAction}
        </p>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={evidenceId}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-h-11 items-center text-left font-semibold text-purple-700 underline-offset-4 hover:underline dark:text-purple-300 cursor-pointer"
        >
          {expanded ? '확인한 근거 접기' : '확인한 근거 보기'}
        </button>

        {expanded && (
          <div
            id={evidenceId}
            role="region"
            aria-label="확인한 근거"
            className="space-y-2 border-t border-purple-200/60 pt-3 dark:border-purple-900/30"
          >
            {facts.length > 0 ? (
              <ul className="space-y-1.5 pl-3 list-disc">
                {facts.map((event) => (
                  <li key={event.event_id} className="text-foreground/90">
                    {event.user_visible_summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">독립 조회로 확인된 결과가 아직 없습니다.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              확인된 활동 기록만 표시해요.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
