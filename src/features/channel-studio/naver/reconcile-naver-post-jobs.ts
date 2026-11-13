import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { deterministicUuid } from './generate-naver-post'

export type NaverPostJobRow = {
  id: string
  workspace_id: string
  request_key: string
  user_id: string
  status: 'running' | 'succeeded' | 'failed'
  content_id: string | null
  version_id: string | null
  credit_reconcile_needed: boolean
  created_at: string
  updated_at: string
}

export type QuickPostReservationRow = {
  id: string
  workspace_id: string
  account_id?: string
  mission_id: string
  revision: number
  scope: string
  credits: number
  operation_key: string
  state: 'reserved' | 'settled' | 'released'
}

export type ReconcileNaverPostJobsSummary = {
  examined: number
  markedFailed: number
  completedFromSavedVersion: number
  released: number
  flagged: number
  errors: number
}

export interface ReconcileNaverPostJobsDependencies {
  findStuckRunningJobs?(admin: any, thresholdIso: string, limit: number): Promise<NaverPostJobRow[]>
  findFlaggedJobs?(admin: any, limit: number): Promise<NaverPostJobRow[]>
  findSavedVersion?(admin: any, workspaceId: string, requestKey: string, versionId?: string | null): Promise<{ contentId: string; versionId: string } | null>
  completeJob?(admin: any, workspaceId: string, requestKey: string, contentId: string, versionId: string, creditReconcileNeeded: boolean): Promise<void>
  failJob?(admin: any, workspaceId: string, requestKey: string, creditReconcileNeeded: boolean): Promise<void>
  clearReconcileFlag?(admin: any, jobId: string): Promise<void>
  setReconcileFlag?(admin: any, jobId: string): Promise<void>
  findReservations?(admin: any, workspaceId: string, missionIds: string[]): Promise<QuickPostReservationRow[]>
  settleReservation?(admin: any, workspaceId: string, reservationId: string, operationKey: string): Promise<void>
  releaseReservation?(admin: any, workspaceId: string, reservationId: string, operationKey: string): Promise<void>
}

export interface ReconcileNaverPostJobsParams {
  admin: SupabaseClient<Database>
  now?: Date
  limit?: number
  deps?: ReconcileNaverPostJobsDependencies
}

const STUCK_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

const defaultFindStuckRunningJobs = async (
  admin: any,
  thresholdIso: string,
  limit: number,
): Promise<NaverPostJobRow[]> => {
  const { data, error } = await admin
    .from('naver_post_jobs')
    .select('id, workspace_id, request_key, user_id, status, content_id, version_id, credit_reconcile_needed, created_at, updated_at')
    .eq('status', 'running')
    .lte('updated_at', thresholdIso)
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[reconcile-naver-post-jobs] findStuckRunningJobs query error:', error)
    return []
  }
  if (!Array.isArray(data)) {
    console.error('[reconcile-naver-post-jobs] findStuckRunningJobs returned no row list')
    return []
  }
  return data as NaverPostJobRow[]
}

const defaultFindFlaggedJobs = async (
  admin: any,
  limit: number,
): Promise<NaverPostJobRow[]> => {
  const { data, error } = await admin
    .from('naver_post_jobs')
    .select('id, workspace_id, request_key, user_id, status, content_id, version_id, credit_reconcile_needed, created_at, updated_at')
    .eq('credit_reconcile_needed', true)
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[reconcile-naver-post-jobs] findFlaggedJobs query error:', error)
    return []
  }
  if (!Array.isArray(data)) {
    console.error('[reconcile-naver-post-jobs] findFlaggedJobs returned no row list')
    return []
  }
  return data as NaverPostJobRow[]
}

const defaultFindSavedVersion = async (
  admin: any,
  workspaceId: string,
  requestKey: string,
  versionId?: string | null,
): Promise<{ contentId: string; versionId: string } | null> => {
  if (versionId) {
    const { data: byId } = await admin
      .from('content_versions')
      .select('id, content_id')
      .eq('id', versionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (byId?.id && byId?.content_id) {
      return { contentId: byId.content_id, versionId: byId.id }
    }
  }

  const { data: byReason, error } = await admin
    .from('content_versions')
    .select('id, content_id, revision_reason, content_items!content_versions_workspace_content_fkey!inner(channel)')
    .eq('workspace_id', workspaceId)
    .eq('content_items.channel', 'naver_blog')
    .eq('revision_reason', `naver_post:${requestKey}`)
    .maybeSingle()

  if (!error && byReason?.id && byReason?.content_id) {
    return { contentId: byReason.content_id, versionId: byReason.id }
  }

  return null
}

const defaultCompleteJob = async (
  admin: any,
  workspaceId: string,
  requestKey: string,
  contentId: string,
  versionId: string,
  creditReconcileNeeded: boolean,
): Promise<void> => {
  const { error } = await admin.rpc('complete_naver_post_job', {
    p_workspace_id: workspaceId,
    p_request_key: requestKey,
    p_content_id: contentId,
    p_version_id: versionId,
    p_credit_reconcile_needed: creditReconcileNeeded,
  })

  if (error) {
    await admin
      .from('naver_post_jobs')
      .update({
        status: 'succeeded',
        content_id: contentId,
        version_id: versionId,
        credit_reconcile_needed: creditReconcileNeeded,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('request_key', requestKey)
  }
}

const defaultFailJob = async (
  admin: any,
  workspaceId: string,
  requestKey: string,
  creditReconcileNeeded: boolean,
): Promise<void> => {
  const { error } = await admin.rpc('fail_naver_post_job', {
    p_workspace_id: workspaceId,
    p_request_key: requestKey,
    p_credit_reconcile_needed: creditReconcileNeeded,
  })

  if (error) {
    await admin
      .from('naver_post_jobs')
      .update({
        status: 'failed',
        credit_reconcile_needed: creditReconcileNeeded,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('request_key', requestKey)
  }
}

const defaultClearReconcileFlag = async (admin: any, jobId: string): Promise<void> => {
  const { error } = await admin
    .from('naver_post_jobs')
    .update({
      credit_reconcile_needed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    console.error('[reconcile-naver-post-jobs] clearReconcileFlag error:', error)
  }
}

const defaultSetReconcileFlag = async (admin: any, jobId: string): Promise<void> => {
  const { error } = await admin
    .from('naver_post_jobs')
    .update({
      credit_reconcile_needed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    console.error('[reconcile-naver-post-jobs] setReconcileFlag error:', error)
  }
}

const defaultFindReservations = async (
  admin: any,
  workspaceId: string,
  missionIds: string[],
): Promise<QuickPostReservationRow[]> => {
  const { data, error } = await admin
    .from('quick_post_credit_reservations')
    .select('id, workspace_id, account_id, mission_id, revision, scope, credits, operation_key, state')
    .eq('workspace_id', workspaceId)
    .in('mission_id', missionIds)

  if (error) {
    console.error('[reconcile-naver-post-jobs] findReservations error:', error)
    throw error
  }
  if (!Array.isArray(data)) {
    console.error('[reconcile-naver-post-jobs] findReservations returned no row list')
    throw new Error('QUICK_POST_RESERVATION_READ_FAILED')
  }
  return data as QuickPostReservationRow[]
}

const defaultSettleReservation = async (
  admin: any,
  workspaceId: string,
  reservationId: string,
  operationKey: string,
): Promise<void> => {
  const { error } = await admin.rpc('settle_quick_post_credits', {
    p_workspace_id: workspaceId,
    p_reservation_id: reservationId,
    p_operation_key: operationKey,
  })

  if (error) {
    console.error('[reconcile-naver-post-jobs] settle_quick_post_credits error:', error)
    throw error
  }
}

const defaultReleaseReservation = async (
  admin: any,
  workspaceId: string,
  reservationId: string,
  operationKey: string,
): Promise<void> => {
  const { error } = await admin.rpc('release_quick_post_credits', {
    p_workspace_id: workspaceId,
    p_reservation_id: reservationId,
    p_operation_key: operationKey,
  })

  if (error) {
    console.error('[reconcile-naver-post-jobs] release_quick_post_credits error:', error)
    throw error
  }
}

export async function reconcileNaverPostJobs(
  params: ReconcileNaverPostJobsParams,
): Promise<ReconcileNaverPostJobsSummary> {
  const admin = params.admin
  const now = params.now ?? new Date()
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100))
  const deps = params.deps ?? {}

  const findStuckRunning = deps.findStuckRunningJobs ?? defaultFindStuckRunningJobs
  const findFlagged = deps.findFlaggedJobs ?? defaultFindFlaggedJobs
  const findSavedVersion = deps.findSavedVersion ?? defaultFindSavedVersion
  const completeJob = deps.completeJob ?? defaultCompleteJob
  const failJob = deps.failJob ?? defaultFailJob
  const clearReconcileFlag = deps.clearReconcileFlag ?? defaultClearReconcileFlag
  const setReconcileFlag = deps.setReconcileFlag ?? defaultSetReconcileFlag
  const findReservations = deps.findReservations ?? defaultFindReservations
  const settleReservation = deps.settleReservation ?? defaultSettleReservation
  const releaseReservation = deps.releaseReservation ?? defaultReleaseReservation

  const summary: ReconcileNaverPostJobsSummary = {
    examined: 0,
    markedFailed: 0,
    completedFromSavedVersion: 0,
    released: 0,
    flagged: 0,
    errors: 0,
  }

  const thresholdIso = new Date(now.getTime() - STUCK_THRESHOLD_MS).toISOString()

  console.info('[reconcile-naver-post-jobs] starting sweep', {
    now: now.toISOString(),
    threshold: thresholdIso,
    limit,
  })

  let stuckJobs: NaverPostJobRow[] = []
  let flaggedJobs: NaverPostJobRow[] = []

  try {
    stuckJobs = await findStuckRunning(admin, thresholdIso, limit)
  } catch (err) {
    summary.errors++
    console.error('[reconcile-naver-post-jobs] failed to query stuck running jobs:', err)
  }

  try {
    flaggedJobs = await findFlagged(admin, limit)
  } catch (err) {
    summary.errors++
    console.error('[reconcile-naver-post-jobs] failed to query flagged jobs:', err)
  }

  // Merge candidates by ID and sort oldest updated first
  const candidateMap = new Map<string, NaverPostJobRow>()
  for (const job of [...stuckJobs, ...flaggedJobs]) {
    candidateMap.set(job.id, job)
  }

  const sortedCandidates = Array.from(candidateMap.values())
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    .slice(0, limit)

  summary.examined = sortedCandidates.length

  for (const job of sortedCandidates) {
    try {
      let isFlagged = Boolean(job.credit_reconcile_needed)

      // Handle running jobs
      if (job.status === 'running') {
        const jobUpdatedTime = new Date(job.updated_at).getTime()
        const isStuck = now.getTime() - jobUpdatedTime >= STUCK_THRESHOLD_MS

        if (!isStuck) {
          // Still within acceptable runtime window, do not interrupt
          continue
        }

        const savedVersion = await findSavedVersion(
          admin,
          job.workspace_id,
          job.request_key,
          job.version_id,
        )

        if (savedVersion) {
          // Dangerous branch protection: saved version exists, must NOT fail or refund!
          console.info('[reconcile-naver-post-jobs] recovering stuck job from saved version', {
            jobId: job.id,
            requestKey: job.request_key,
            contentId: savedVersion.contentId,
            versionId: savedVersion.versionId,
          })
          await completeJob(
            admin,
            job.workspace_id,
            job.request_key,
            savedVersion.contentId,
            savedVersion.versionId,
            false,
          )
          summary.completedFromSavedVersion++
          job.status = 'succeeded'
          job.content_id = savedVersion.contentId
          job.version_id = savedVersion.versionId
        } else {
          // No saved version exists, mark as failed
          console.info('[reconcile-naver-post-jobs] marking stuck job as failed (no saved version)', {
            jobId: job.id,
            requestKey: job.request_key,
          })
          await failJob(admin, job.workspace_id, job.request_key, false)
          summary.markedFailed++
          job.status = 'failed'
        }
      }

      // Reconcile deterministic credit reservations for this job
      const textMissionId = deterministicUuid(`${job.request_key}:text`)
      const imageMissionIds = [0, 1, 2, 3, 4, 5].map((i) =>
        deterministicUuid(`${job.request_key}:image:${i}`),
      )
      const allMissionIds = [textMissionId, ...imageMissionIds]

      const reservations = await findReservations(admin, job.workspace_id, allMissionIds)

      let allRpcSucceeded = true

      if (job.status === 'succeeded') {
        // For succeeded jobs, settle any unsettled holds (text / images); NEVER release!
        for (const res of reservations) {
          if (res.state === 'reserved') {
            try {
              await settleReservation(admin, job.workspace_id, res.id, res.operation_key)
            } catch (rpcErr) {
              allRpcSucceeded = false
              summary.errors++
              console.error('[reconcile-naver-post-jobs] settle reservation error:', {
                reservationId: res.id,
                operationKey: res.operation_key,
                error: rpcErr,
              })
            }
          }
          // res.state === 'settled' or 'released': keep untouched
        }
      } else if (job.status === 'failed') {
        // For failed jobs, release every unsettled hold; NEVER release settled holds!
        for (const res of reservations) {
          if (res.state === 'reserved') {
            try {
              await releaseReservation(admin, job.workspace_id, res.id, res.operation_key)
              summary.released++
            } catch (rpcErr) {
              allRpcSucceeded = false
              summary.errors++
              console.error('[reconcile-naver-post-jobs] release reservation error:', {
                reservationId: res.id,
                operationKey: res.operation_key,
                error: rpcErr,
              })
            }
          }
          // res.state === 'settled': stored images! Must NEVER be released.
          // res.state === 'released': already released! Must NOT double-release.
        }
      }

      // Update credit_reconcile_needed flag
      if (allRpcSucceeded) {
        if (job.credit_reconcile_needed) {
          await clearReconcileFlag(admin, job.id)
        }
      } else {
        // Release or settle RPC failed: flag stays or becomes true
        if (!job.credit_reconcile_needed) {
          await setReconcileFlag(admin, job.id)
        }
        isFlagged = true
      }

      if (isFlagged) {
        summary.flagged++
      }
    } catch (rowErr) {
      summary.errors++
      console.error('[reconcile-naver-post-jobs] unhandled error on candidate row:', {
        jobId: job.id,
        error: rowErr,
      })
    }
  }

  console.info('[reconcile-naver-post-jobs] sweep completed', summary)
  return summary
}
