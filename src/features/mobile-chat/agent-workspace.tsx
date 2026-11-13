'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Check, ChevronDown, Circle, FileText, LoaderCircle, PauseCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { projectActivityEvent, type AgentActivityEvent } from '@/features/agent-activity/activity-event'
import type { ChatViewSnapshot } from './mobile-chat-view'
import { activityTaskTimeline } from '@/features/agent-activity/task-timeline-adapter'

type WorkState = 'verified' | 'active' | 'unconfirmed' | 'blocked' | 'proposed' | 'simulated'

/** 최신 공개 사건만 사용한다. 제안·접수는 실행 완료로 바꾸지 않는다. */
function workState(event: AgentActivityEvent, sending: boolean): WorkState {
  if (event.simulated) return 'simulated'
  if (event.lifecycle === 'verified') return 'verified'
  if (['failed', 'blocked', 'approval_needed'].includes(event.lifecycle)) return 'blocked'
  if (event.lifecycle === 'result_unknown') return 'unconfirmed'
  if (event.lifecycle === 'proposed') return 'proposed'
  return sending ? 'active' : 'unconfirmed'
}

function currentActivities(snapshot: ChatViewSnapshot) {
  if (!snapshot.agentRunId) return []
  const seen = new Set<string>()
  const steps = new Map<string, AgentActivityEvent>()
  for (const raw of [...(snapshot.activities ?? [])].sort((a, b) => a.sequence - b.sequence)) {
    const event = projectActivityEvent(raw)
    if (!event || event.run_id !== snapshot.agentRunId || seen.has(event.event_id)) continue
    seen.add(event.event_id)
    // 한 도구 단계의 시작·후속 결과는 한 줄로, 단계 없는 사건은 개별 기록으로 남긴다.
    steps.set(event.step_id ? `step:${event.step_id}` : `event:${event.event_id}`, event)
  }
  return [...steps.values()].sort((a, b) => a.sequence - b.sequence)
}

/** 활동은 서버 근거만, 계획은 제안으로 표시한다. 응답 종료를 업무 완료로 바꾸지 않는다. */
export function AgentWorkspace({ snapshot, onRetry }: { snapshot: ChatViewSnapshot; onRetry?: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()
  const result = snapshot.agentResult
  const activities = currentActivities(snapshot)
  const timeline = snapshot.agentRunId ? activityTaskTimeline(activities, { runId: snapshot.agentRunId, live: snapshot.sending === true }) : null
  const latest = activities.at(-1)
  const needsCheck = activities.some(event => ['blocked', 'unconfirmed'].includes(workState(event, snapshot.sending === true)))
  const status = snapshot.uncertain ? '결과 확인 필요'
    : latest?.lifecycle === 'approval_needed' ? '사장님 확인 필요'
    : snapshot.sending ? '진행 중'
    : needsCheck ? '결과 확인 필요' : '작업 기록'
  const visible = snapshot.sending || snapshot.uncertain || activities.length || snapshot.activityUnavailable || result?.plan || result?.reviewHref || result?.links.length
  if (!visible) return null

  return <div className="min-w-0 space-y-3" data-agent-workspace>
    {snapshot.sending || activities.length ? <section aria-label="소희의 작업 활동 기록" className="overflow-hidden rounded-2xl border border-border bg-card">
      <button type="button" aria-label="소희의 활동" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}
        className="flex min-h-14 w-full items-center gap-2.5 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 text-sm font-semibold">소희의 작업<span className="ml-2 text-xs font-normal text-muted-foreground">{status}</span></span>
        {timeline ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeline.completedSteps} / {timeline.totalSteps} 완료</span> : null}
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded ? <div id={contentId} className="px-4 pb-4">
        {activities.length ? <ol aria-label="확인된 작업 활동" className="space-y-3 border-t border-border pt-3">
          {activities.map(event => {
            const state = workState(event, snapshot.sending === true)
            const Icon = state === 'verified' ? Check : state === 'active' ? LoaderCircle : state === 'blocked' ? PauseCircle : state === 'unconfirmed' ? AlertCircle : Circle
            return <li key={event.event_id} data-work-state={state} className="flex min-w-0 items-start gap-2.5">
              <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${state === 'active' ? 'animate-spin text-primary motion-reduce:animate-none' : state === 'blocked' || state === 'unconfirmed' ? 'text-muted-foreground' : state === 'verified' ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                {event.simulated ? <span className="mb-0.5 block text-xs font-medium text-muted-foreground">시안·연습</span> : null}
                <p className="break-words">{event.user_visible_summary}</p>
              </div>
            </li>
          })}
        </ol> : null}
        {snapshot.sending ? <p role="status" className="mt-3 flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden="true" />
          {snapshot.progress?.title ? (
            <span>
              <strong className="font-semibold text-foreground">{snapshot.progress.title}</strong>
              {snapshot.progress.detail ? <span className="ml-1.5">{snapshot.progress.detail}</span> : null}
            </span>
          ) : activities.length ? (
            '소희가 요청을 처리하고 있어요. 확인된 활동을 표시해요.'
          ) : (
            '요청을 전달하고 있어요. 작업 기록이 도착하면 여기에 표시해요.'
          )}
        </p> : null}
      </div> : null}
    </section> : null}
    {snapshot.uncertain ? <section aria-label="요청 결과 확인" className="space-y-2 rounded-xl border border-border p-4">
      <p className="text-sm leading-relaxed">요청 결과를 아직 확인하지 못했어요. 다시 보내지 않고 기존 결과를 조회해요.</p>
      {onRetry ? <Button variant="secondary" className="min-h-11" onClick={onRetry}>요청 결과 다시 확인</Button> : null}
    </section> : null}
    {snapshot.activityUnavailable ? <p role="note" className="text-sm text-muted-foreground">작업 활동을 불러오지 못했어요. 대화 결과와 별도로 다시 확인해 주세요.</p> : null}
    {result?.plan && !snapshot.sending ? <section aria-label="제안한 작업 계획" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><FileText className="size-4" aria-hidden="true" />제안한 작업 계획 · 실행 완료 내역이 아니에요</div>
      <h2 className="break-words text-base font-semibold">{result.plan.title}</h2>
      <ol className="space-y-2 text-sm leading-relaxed">{result.plan.steps.map((step, index) => <li key={index} className="flex items-start gap-2.5"><Circle className="mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-words">{step}</span></li>)}</ol>
    </section> : null}
    {!snapshot.sending && !snapshot.uncertain && result?.reviewHref ? <div className="space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-sm leading-relaxed text-muted-foreground">내용을 검토하고 바꿀 점은 대화로 알려 주세요. 최종 승인은 검토 화면에서 진행해요.</p>
      <Button asChild className="min-h-11 w-full"><Link href={result.reviewHref}>결과 검토·승인</Link></Button>
    </div> : null}
    {!snapshot.sending && result?.links.length ? <nav aria-label="작업 결과 링크" className="flex min-w-0 flex-col items-start">{result.links.map((link, index) => link.href.startsWith('/')
      ? <Link key={index} href={link.href} className="inline-flex min-h-11 max-w-full items-center break-words text-sm text-primary underline underline-offset-4">{link.label}</Link>
      : <a key={index} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center break-words text-sm text-primary underline underline-offset-4">{link.label}</a>)}</nav> : null}
  </div>
}
