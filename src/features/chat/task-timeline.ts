import { z } from 'zod'
import type { TaskTimelineItem, TaskTimelineMessageArtifact } from './stream-events'

const stepSchema = z.object({
  id: z.string().trim().min(1).max(120), title: z.string().trim().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'unknown', 'awaiting_approval']),
  durationMs: z.number().finite().nonnegative().optional(),
  capabilityId: z.enum(['comment.reply_draft', 'dm.reply_draft']).optional(),
}).strict()
const timelineSchema = z.object({
  id: z.string().trim().min(1).max(160), kind: z.literal('task_timeline'),
  title: z.string().trim().min(1).max(200),
  totalSteps: z.number().int().min(1).max(80), completedSteps: z.number().int().min(0).max(80),
  steps: z.array(stepSchema).min(1).max(80), isLive: z.boolean().optional(),
}).strict().refine(value => value.totalSteps === value.steps.length
  && value.completedSteps === value.steps.filter(step => step.status === 'completed').length
  && new Set(value.steps.map(step => step.id)).size === value.steps.length)

export function parseTaskTimeline(value: unknown): TaskTimelineMessageArtifact | null {
  const parsed = timelineSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function restoreTaskTimeline(value: unknown, status: string): TaskTimelineMessageArtifact | null {
  const timeline = parseTaskTimeline(value)
  if (!timeline) return null
  if (status === 'streaming' || status === 'queued') return timeline
  return { ...timeline, isLive: false, steps: timeline.steps.map(step => step.status === 'in_progress'
    ? { ...step, status: status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'unknown' }
    : step) }
}

/** 현재 요청의 실제 처리 경계만 기록한다. 시간 경과나 응답 종료로 완료를 추측하지 않는다. */
export function createTaskTracker(messageId: string, publish: (value: TaskTimelineMessageArtifact) => Promise<void>) {
  const steps: TaskTimelineItem[] = []
  const started = new Map<string, number>()
  let live = true
  async function emit() {
    await publish({ id: `tasks-${messageId}`, kind: 'task_timeline', title: '소희의 작업 계획',
      totalSteps: steps.length, completedSteps: steps.filter(step => step.status === 'completed').length,
      steps: steps.map(step => ({ ...step })), isLive: live })
  }
  return {
    async plan(items: readonly { id: string; title: string }[]) {
      for (const item of items) if (!steps.some(step => step.id === item.id)) steps.push({ ...item, status: 'pending' })
      if (steps.length) await emit()
    },
    async start(id: string, title: string) {
      const index = steps.findIndex(step => step.id === id)
      if (index >= 0 && steps[index].status !== 'pending') return
      started.set(id, Date.now())
      if (index < 0) steps.push({ id, title, status: 'in_progress' })
      else steps[index] = { ...steps[index], status: 'in_progress' }
      await emit()
    },
    async complete(id: string, detail?: string) {
      const index = steps.findIndex(step => step.id === id && step.status === 'in_progress')
      if (index < 0) return
      steps[index] = { ...steps[index], ...(detail ? { title: `${steps[index].title} · ${detail}`.slice(0, 200) } : {}),
        status: 'completed', durationMs: Math.max(0, Date.now() - started.get(id)!) }
      await emit()
    },
    /** 일부만 확인된 작업은 완료로 세지 않는다. */
    async incomplete(id: string, detail: string) {
      const index = steps.findIndex(step => step.id === id && step.status === 'in_progress')
      if (index < 0) return
      steps[index] = { ...steps[index], title: `${steps[index].title} · ${detail}`.slice(0, 200), status: 'unknown' }
      await emit()
    },
    async stop(status: 'failed' | 'cancelled' | 'unknown' | 'completed') {
      live = false
      for (let i = 0; i < steps.length; i++) if (steps[i].status === 'in_progress') {
        steps[i] = { ...steps[i], status: status === 'completed' ? 'unknown' : status }
      }
      if (steps.length) await emit()
    },
  }
}
