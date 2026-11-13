export type ResearchFlowPhase =
  | 'asking'
  | 'proposing'
  | 'awaiting_approval'
  | 'running'
  | 'done'

export type FlowTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown'
  | 'awaiting_approval'

export type ResearchPlanTask = {
  id: string
  title: string
  detail?: string
  channel?: string
  estimatedCredits?: number
  status?: FlowTaskStatus
}

export type FlowTaskItem = {
  id?: string
  title?: string
  detail?: string
  channel?: string
  estimatedCredits?: number
  durationMs?: number
  status: FlowTaskStatus
}

export type ResearchPlan = {
  summary: string
  direction: string[]
  tasks: ResearchPlanTask[]
  totalCredits?: number
}

export interface DeriveFlowPhaseInput {
  answeredQuestions?: boolean | number | readonly unknown[]
  plan?: ResearchPlan | null
  approved?: boolean
  tasks?: readonly FlowTaskItem[] | null
}

export interface TaskCountsResult {
  total: number
  completed: number
  inProgress: number
  in_progress: number
  pending: number
  failed: number
  cancelled: number
  unknown: number
  awaitingApproval: number
  awaiting_approval: number
}

export function taskCounts(tasks: readonly FlowTaskItem[]): TaskCountsResult {
  const completed = tasks.filter((t) => t.status === 'completed').length
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length
  const pending = tasks.filter((t) => t.status === 'pending').length
  const failed = tasks.filter((t) => t.status === 'failed').length
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length
  const unknown = tasks.filter((t) => t.status === 'unknown').length
  const awaitingApproval = tasks.filter((t) => t.status === 'awaiting_approval').length

  return {
    total: tasks.length,
    completed,
    inProgress,
    in_progress: inProgress,
    pending,
    failed,
    cancelled,
    unknown,
    awaitingApproval,
    awaiting_approval: awaitingApproval,
  }
}

/**
 * Calculates progress percentage (0 ~ 100).
 * - completed / total
 * - failed/unknown/pending/cancelled never counted as completed
 * - 100 only if all tasks are completed
 */
export function progressPercent(tasks: readonly FlowTaskItem[]): number {
  if (!tasks.length) return 0
  const completed = tasks.filter((t) => t.status === 'completed').length
  if (completed === tasks.length) return 100
  const raw = Math.floor((completed / tasks.length) * 100)
  return Math.min(99, Math.max(0, raw))
}

/**
 * Derives current flow phase:
 * `asking` -> `proposing` -> `awaiting_approval` -> `running` -> `done`
 */
export function deriveFlowPhase({
  answeredQuestions,
  plan,
  approved,
  tasks,
}: DeriveFlowPhaseInput): ResearchFlowPhase {
  const taskList = tasks ?? []
  const hasTasks = taskList.length > 0
  const allCompleted = hasTasks && taskList.every((t) => t.status === 'completed')

  if (allCompleted) {
    return 'done'
  }

  const hasRunningTasks = taskList.some(
    (t) => t.status === 'in_progress' || t.status === 'completed',
  )

  if (approved || hasRunningTasks) {
    return 'running'
  }

  if (plan) {
    return 'awaiting_approval'
  }

  const hasAnswered =
    typeof answeredQuestions === 'number'
      ? answeredQuestions > 0
      : Array.isArray(answeredQuestions)
        ? answeredQuestions.length > 0
        : Boolean(answeredQuestions)

  if (hasAnswered) {
    return 'proposing'
  }

  return 'asking'
}
