import { z } from 'zod'
import type { ServerSupabaseClient, WorkItemStatus } from '@/features/operations/types'

type SummaryQueryResult = Promise<{
  data: unknown
  count: number | null
  error: unknown
}>

export type WorkSummaryGateway = Readonly<{
  listContentItems(workspaceId: string): SummaryQueryResult
  listWorkItems(workspaceId: string): SummaryQueryResult
  listFailedSchedules(workspaceId: string): SummaryQueryResult
  listApprovedVersions(workspaceId: string): SummaryQueryResult
}>

export type AvailableWorkSummary = Readonly<{
  all: number
  inProgress: number
  recovery: number
  approved: number
}>

export type WorkSummary = AvailableWorkSummary | Readonly<{ available: false }>

const uuidSchema = z.string().uuid()
const contentStatusSchema = z.enum([
  'draft',
  'review',
  'approved',
  'scheduled',
  'published',
  'archived',
])
const workStatusSchema = z.enum([
  'idea',
  'researching',
  'drafting',
  'review_required',
  'revision_requested',
  'revising',
  'approved',
  'schedule_required',
  'scheduled',
  'publishing',
  'published',
  'blocked',
  'publish_failed',
  'recovery_required',
  'cancelled',
  'archived',
])
const contentRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    status: contentStatusSchema,
    current_version_id: uuidSchema.nullable(),
  })
  .strict()
const workRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    status: workStatusSchema,
    content_item_id: uuidSchema.nullable(),
  })
  .strict()
const failedScheduleRowSchema = z
  .object({ workspace_id: uuidSchema, content_id: uuidSchema })
  .strict()
const approvedVersionRowSchema = z
  .object({
    workspace_id: uuidSchema,
    content_id: uuidSchema,
    version_id: uuidSchema,
    status: z.literal('approved'),
  })
  .strict()

type WorkBucket = 'inProgress' | 'recovery' | 'approved'

const recoveryWorkStatuses = new Set<WorkItemStatus>([
  'publish_failed',
  'recovery_required',
])
const approvedWorkStatuses = new Set<WorkItemStatus>([
  'approved',
  'schedule_required',
  'scheduled',
  'publishing',
  'published',
])

function unavailable(): WorkSummary {
  return { available: false }
}

function hasCompleteResult(
  result: Awaited<SummaryQueryResult>,
  parsedLength: number,
) {
  return !result.error && typeof result.count === 'number' && result.count === parsedLength
}

function workBucket(status: WorkItemStatus): WorkBucket {
  if (recoveryWorkStatuses.has(status)) return 'recovery'
  if (approvedWorkStatuses.has(status)) return 'approved'
  return 'inProgress'
}

export function isWorkSummaryAvailable(
  summary: WorkSummary,
): summary is AvailableWorkSummary {
  return !('available' in summary)
}

export function createWorkSummaryGateway(
  supabase: ServerSupabaseClient,
): WorkSummaryGateway {
  return {
    async listContentItems(workspaceId) {
      return supabase
        .from('content_items')
        .select('id, workspace_id, status, current_version_id', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .neq('status', 'archived')
    },
    async listWorkItems(workspaceId) {
      return supabase
        .from('work_items')
        .select('id, workspace_id, status, content_item_id', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .not('status', 'in', '(cancelled,archived)')
    },
    async listFailedSchedules(workspaceId) {
      return supabase
        .from('schedules')
        .select('workspace_id, content_id', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .eq('status', 'failed')
    },
    async listApprovedVersions(workspaceId) {
      return supabase
        .from('approvals')
        .select('workspace_id, content_id, version_id, status', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .eq('status', 'approved')
    },
  }
}

export async function getWorkSummary(
  workspaceId: string,
  providedGateway?: WorkSummaryGateway,
): Promise<WorkSummary> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return unavailable()

  try {
    let gateway = providedGateway
    if (!gateway) {
      const { createServerSupabaseClient } = await import('@/lib/supabase/server')
      gateway = createWorkSummaryGateway(await createServerSupabaseClient())
    }
    const [contentResult, workResult, failedResult, approvalResult] = await Promise.all([
      gateway.listContentItems(parsedWorkspaceId.data),
      gateway.listWorkItems(parsedWorkspaceId.data),
      gateway.listFailedSchedules(parsedWorkspaceId.data),
      gateway.listApprovedVersions(parsedWorkspaceId.data),
    ])
    const contents = z.array(contentRowSchema).safeParse(contentResult.data)
    const workItems = z.array(workRowSchema).safeParse(workResult.data)
    const failedSchedules = z.array(failedScheduleRowSchema).safeParse(failedResult.data)
    const approvals = z.array(approvedVersionRowSchema).safeParse(approvalResult.data)

    if (
      !contents.success ||
      !workItems.success ||
      !failedSchedules.success ||
      !approvals.success ||
      !hasCompleteResult(contentResult, contents.success ? contents.data.length : -1) ||
      !hasCompleteResult(workResult, workItems.success ? workItems.data.length : -1) ||
      !hasCompleteResult(failedResult, failedSchedules.success ? failedSchedules.data.length : -1) ||
      !hasCompleteResult(approvalResult, approvals.success ? approvals.data.length : -1)
    ) {
      return unavailable()
    }

    const ownContents = contents.data.filter(
      (row) => row.workspace_id === parsedWorkspaceId.data,
    )
    const ownWorkItems = workItems.data.filter(
      (row) => row.workspace_id === parsedWorkspaceId.data,
    )
    const failedContentIds = new Set(
      failedSchedules.data
        .filter((row) => row.workspace_id === parsedWorkspaceId.data)
        .map((row) => row.content_id),
    )
    const approvedVersionKeys = new Set(
      approvals.data
        .filter((row) => row.workspace_id === parsedWorkspaceId.data)
        .map((row) => `${row.content_id}:${row.version_id}`),
    )
    const bucketByWork = new Map<string, WorkBucket>()
    const activeContentIds = new Set(ownContents.map((content) => content.id))

    for (const content of ownContents) {
      const approvedCurrentVersion =
        content.current_version_id !== null &&
        approvedVersionKeys.has(`${content.id}:${content.current_version_id}`)
      const bucket: WorkBucket = failedContentIds.has(content.id)
        ? 'recovery'
        : approvedCurrentVersion &&
            ['approved', 'scheduled', 'published'].includes(content.status)
          ? 'approved'
          : 'inProgress'
      bucketByWork.set(`content:${content.id}`, bucket)
    }

    for (const work of ownWorkItems) {
      const bucket = workBucket(work.status)
      if (!work.content_item_id || !activeContentIds.has(work.content_item_id)) continue

      const key = `content:${work.content_item_id}`
      if (bucket === 'recovery') bucketByWork.set(key, bucket)
    }

    let inProgress = 0
    let recovery = 0
    let approved = 0
    for (const bucket of bucketByWork.values()) {
      if (bucket === 'recovery') recovery += 1
      else if (bucket === 'approved') approved += 1
      else inProgress += 1
    }

    return { all: bucketByWork.size, inProgress, recovery, approved }
  } catch {
    return unavailable()
  }
}
