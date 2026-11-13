import { projectActivityEvent, type AgentActivityEvent } from './activity-event'
import type { TaskTimelineItem, TaskTimelineMessageArtifact } from '@/features/chat/stream-events'

/** 공개 영속 사건의 최신 상태를 투영한다. 접수·시안·응답 종료는 검증 완료가 아니다. */
export function activityTaskTimeline(events: readonly AgentActivityEvent[], scope: {
  workspaceId?: string | null; runId: string; missionId?: string | null; live: boolean
}): TaskTimelineMessageArtifact | null {
  const latest = new Map<string, AgentActivityEvent>()
  for (const raw of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const event = projectActivityEvent(raw)
    if (!event || event.run_id !== scope.runId || (scope.workspaceId && event.workspace_id !== scope.workspaceId)
      || (scope.missionId && event.mission_id !== scope.missionId)) continue
    latest.set(event.step_id ? `step-${event.step_id}` : `event-${event.event_id}`, event)
  }
  const steps: TaskTimelineItem[] = [...latest].slice(-80).map(([id, event]) => ({ id,
    title: `${event.simulated ? '시안·연습 · ' : ''}${event.step_id ? `작업 ${event.step_id} · ` : ''}${event.user_visible_summary}`,
    status: event.simulated ? 'unknown' : event.lifecycle === 'verified' ? 'completed'
      : event.lifecycle === 'approval_needed' ? 'awaiting_approval'
      : event.lifecycle === 'failed' || event.lifecycle === 'blocked' ? 'failed'
      : event.lifecycle === 'result_unknown' ? 'unknown'
      : event.lifecycle === 'queued' || event.lifecycle === 'proposed' ? 'pending'
      : scope.live ? 'in_progress' : 'unknown',
  }))
  if (!steps.length) return null
  return { id: `activity-tasks-${scope.runId}`, kind: 'task_timeline', title: '소희의 작업 계획', steps,
    totalSteps: steps.length, completedSteps: steps.filter(step => step.status === 'completed').length, isLive: scope.live }
}
