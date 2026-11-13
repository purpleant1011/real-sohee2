import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { MarketingMissionAggregate, MissionStatus } from './mission-types'
import { assertEvidenceBackedTransition } from './mission-state-machine'
import {
  restoreExternalActionReceipt,
  type ExternalActionReceipt,
} from '@/features/publishing/external-action-receipt-engine'

export interface StalledMissionCandidate {
  missionId: string
  workspaceId: string
  status: MissionStatus
  lastUpdatedAt: string
  minutesStalled: number
  stalledPhase: string
}

export interface ReconcileResult {
  missionId: string
  previousStatus: MissionStatus
  recoveredStatus: MissionStatus
  resumePoint: string
  actionTaken: string
  isBlindRetryBlocked: boolean
}

export class MissionRecoveryService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Scans a workspace for marketing missions that have stayed in in-flight states
   * without updates beyond the stall timeout (default: 30 minutes).
   */
  public async detectStalledMissions(
    workspaceId: string,
    timeoutMinutes = 30
  ): Promise<StalledMissionCandidate[]> {
    const thresholdDate = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString()

    const { data: rows, error } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['PLANNING', 'PRODUCING', 'EXECUTING', 'RESULT_UNKNOWN'])
      .lt('updated_at', thresholdDate)

    if (error || !Array.isArray(rows)) {
      throw new Error(`[DETECT_STALLED_MISSIONS_FAILED] ${error?.message ?? 'no row list'}`)
    }

    const now = Date.now()
    return rows.map((row: any) => {
      const updatedTime = new Date(row.updated_at).getTime()
      const minutesStalled = Math.max(0, Math.floor((now - updatedTime) / (1000 * 60)))
      return {
        missionId: row.id,
        workspaceId: row.workspace_id,
        status: row.status as MissionStatus,
        lastUpdatedAt: row.updated_at,
        minutesStalled,
        stalledPhase: `Stalled in ${row.status} for ${minutesStalled}m`,
      }
    })
  }

  /**
   * Reconciles an interrupted or orphan mission, guarding against blind retries
   * on external mutations and safely resolving a valid resume point.
   */
  public async reconcileInterruptedMission(
    mission: MarketingMissionAggregate,
    failureContext?: { errorCode?: string; workerInterrupted?: boolean }
  ): Promise<ReconcileResult> {
    const previousStatus = mission.status
    let recoveredStatus: MissionStatus = previousStatus
    let resumePoint = 'NO_OP'
    let actionTaken = 'NONE'
    let isBlindRetryBlocked = false

    // 1. Critical External Mutation Interruption Guard:
    // If mission was EXECUTING or RESULT_UNKNOWN and an external action request was initiated,
    // blind retry is strictly prohibited to prevent duplicate public social media posts.
    // Receipt ID existence alone NEVER authorizes elevation to PUBLISHED_VERIFIED;
    // only a tenant-scoped receipt with verified state and concrete providerPostId can elevate.
    if (mission.status === 'EXECUTING' || mission.status === 'RESULT_UNKNOWN') {
      const hasOutgoingRequest = Boolean(mission.external_action_request_id || mission.metadata?.in_flight_action)
      const receiptId = mission.external_action_receipt_id

      let isReceiptActuallyVerified = false
      let receiptPostId: string | null = null

      if (receiptId) {
        try {
          const { data: receiptRow, error: receiptError } = await (this.client as any)
            .from('external_action_receipts')
            .select('*')
            .eq('id', receiptId)
            .eq('workspace_id', mission.workspace_id)
            .maybeSingle()

          // Fail-closed: DB error, missing receipt, or tenant mismatch prohibits elevation to verified
          if (!receiptError && receiptRow && receiptRow.workspace_id === mission.workspace_id) {
            let restoredReceipt: ExternalActionReceipt | null = null
            try {
              restoredReceipt = restoreExternalActionReceipt(receiptRow)
            } catch {
              restoredReceipt = null
            }

            // Reject contradictory states: FAILED / failed state or status
            const rawState = (receiptRow.state || '').toUpperCase()
            const rawStatus = (receiptRow.status || '').toUpperCase()
            const isExplicitlyFailed = rawState === 'FAILED' || rawStatus === 'FAILED' || restoredReceipt?.state === 'FAILED'

            let isStateVerified = false
            let postId: string | null = null

            if (!isExplicitlyFailed) {
              if (restoredReceipt && restoredReceipt.state === 'VERIFIED') {
                isStateVerified = true
                postId = restoredReceipt.providerPostId || null
              } else if (
                receiptRow.receipt_kind === 'observed_result' &&
                receiptRow.observed_payload &&
                typeof receiptRow.observed_payload === 'object'
              ) {
                // Canonical action ledger format:
                // Require verified === true AND read_after_write === true AND concrete post reference
                const obs = receiptRow.observed_payload as Record<string, unknown>
                if (obs.verified === true && obs.read_after_write === true) {
                  postId = (receiptRow.provider_reference as string) || (obs.published_post_id as string) || null
                  if (postId) {
                    isStateVerified = true
                  }
                }
              }
            }

            // Strict lineage verification (fail-closed, exact equality, required anchors):
            // 1. Channel lineage match (strict equality, no synthetic fallback)
            // Invariants:
            // - Mission MUST specify a known channel ('instagram' | 'threads'). Both lacking channel is prohibited.
            // - Receipt MUST have at least one explicit raw channel evidence.
            // - ALL non-empty raw channel fields on the receipt must be known and unanimously match each other and mission.
            // - Conflicting channels (e.g. row.channel='instagram' vs action_kind='threads_publish') are rejected fail-closed.
            const KNOWN_CHANNELS = new Set(['instagram', 'threads'])
            const missionChannel = (mission.target_channel || (mission.metadata?.channel as string) || '')
              .toLowerCase()
              .trim()

            let channelMatch = false
            if (missionChannel && KNOWN_CHANNELS.has(missionChannel)) {
              const rawChannelEvidenceList = [
                (receiptRow.channel || '').toLowerCase().trim(),
                (receiptRow.action_kind || '').toLowerCase().replace(/_publish$/, '').trim(),
                ((receiptRow.observed_payload as any)?.channel || '').toLowerCase().trim(),
                ((receiptRow.additional_evidence as any)?.channel || '').toLowerCase().trim(),
              ].filter(Boolean)

              if (
                rawChannelEvidenceList.length > 0 &&
                rawChannelEvidenceList.every(c => KNOWN_CHANNELS.has(c) && c === missionChannel)
              ) {
                channelMatch = true
              }
            }

            // 2. Request lineage match (fail-closed if mission has request id)
            let requestMatch = true
            const receiptRequestId =
              receiptRow.action_request_id ||
              receiptRow.request_id ||
              (restoredReceipt?.evidence?.action_request_id as string) ||
              (restoredReceipt?.evidence?.actionRequestId as string) ||
              (receiptRow.additional_evidence?.action_request_id as string) ||
              (receiptRow.additional_evidence?.actionRequestId as string) ||
              null
            if (mission.external_action_request_id) {
              if (!receiptRequestId || receiptRequestId !== mission.external_action_request_id) {
                requestMatch = false
              }
            }

            // 3. Schedule lineage match (fail-closed if mission has schedule id)
            let scheduleMatch = true
            const missionScheduleId = (mission.metadata?.schedule_id as string) || null
            const receiptScheduleId = restoredReceipt?.scheduleId || receiptRow.schedule_id || null
            if (missionScheduleId) {
              if (!receiptScheduleId || receiptScheduleId !== missionScheduleId) {
                scheduleMatch = false
              }
            }

            // 4. Mission ID correlation (if specified on receipt)
            let missionIdMatch = true
            const receiptMissionId =
              restoredReceipt?.evidence?.mission_id ||
              restoredReceipt?.evidence?.missionId ||
              (receiptRow.additional_evidence?.mission_id as string) ||
              (receiptRow.additional_evidence?.missionId as string) ||
              receiptRow.mission_id ||
              null
            if (receiptMissionId && receiptMissionId !== mission.id) {
              missionIdMatch = false
            }

            // Require at least one verifiable anchor (request ID, schedule ID, or mission ID)
            // AND all applicable matches must pass strictly. Missing required correlation defaults to false (UNKNOWN).
            const hasVerifiableAnchor = Boolean(mission.external_action_request_id || missionScheduleId || receiptMissionId)
            const lineageMatches = hasVerifiableAnchor && channelMatch && requestMatch && scheduleMatch && missionIdMatch

            if (isStateVerified && postId && lineageMatches) {
              isReceiptActuallyVerified = true
              receiptPostId = postId
            }
          }
        } catch {
          isReceiptActuallyVerified = false
        }
      }

      if (isReceiptActuallyVerified) {
        recoveredStatus = 'PUBLISHED_VERIFIED'
        resumePoint = 'ADVANCE_TO_LISTENING'
        actionTaken = 'RESTORED_VERIFIED_PUBLISH_FROM_RECEIPT'
        if (receiptPostId) {
          mission.metadata = {
            ...mission.metadata,
            provider_post_reference: receiptPostId,
          }
        }
      } else if (hasOutgoingRequest || receiptId || mission.status === 'RESULT_UNKNOWN') {
        recoveredStatus = 'RESULT_UNKNOWN'
        resumePoint = 'PROVIDER_READBACK_REQUIRED'
        actionTaken = 'TRANSITIONED_TO_RESULT_UNKNOWN_PREVENTING_DUPLICATE_PUBLISH'
        isBlindRetryBlocked = true
      } else {
        // No request was actually fired before crash -> safe to retry execution
        recoveredStatus = 'APPROVED'
        resumePoint = 'RETRY_SAFE_EXECUTION'
        actionTaken = 'RESET_TO_APPROVED_SAFE_RETRY'
      }
    } else if (mission.status === 'PRODUCING') {
      if (mission.content_id) {
        recoveredStatus = 'AWAITING_APPROVAL'
        resumePoint = 'SUBMIT_FOR_OWNER_APPROVAL'
        actionTaken = 'RECOVERED_COMPLETED_CONTENT_DRAFT'
      } else {
        recoveredStatus = 'PLANNING'
        resumePoint = 'RESTART_CONTENT_GENERATION'
        actionTaken = 'RESET_TO_PLANNING_FOR_DRAFT_RETRY'
      }
    } else if (mission.status === 'PLANNING') {
      recoveredStatus = 'PLANNING'
      resumePoint = 'RESTART_STRATEGY_SYNTHESIS'
      actionTaken = 'RETAINED_PLANNING_FOR_RETRY'
    }

    // Enforce evidence check if status changed
    if (recoveredStatus !== previousStatus) {
      assertEvidenceBackedTransition({
        fromStatus: previousStatus,
        toStatus: recoveredStatus,
        mission,
        reason: `Automated recovery reconcile: ${actionTaken} (${failureContext?.errorCode || 'TIMEOUT_OR_INTERRUPTION'})`,
      })

      const now = new Date().toISOString()
      const updatedMetadata = {
        ...mission.metadata,
        last_reconciled_at: now,
        recovery_action: actionTaken,
        previous_status: previousStatus,
      }

      // Atomic CAS update to prevent overwriting concurrent state transitions (e.g. owner pause/cancel)
      const { data: updatedRows, error: updateErr } = await (this.client as any)
        .from('marketing_missions')
        .update({
          status: recoveredStatus,
          metadata: updatedMetadata,
          updated_at: now,
        })
        .eq('id', mission.id)
        .eq('workspace_id', mission.workspace_id)
        .eq('status', previousStatus)
        .eq('updated_at', mission.updated_at)
        .select('id')

      if (updateErr || !Array.isArray(updatedRows) || updatedRows.length === 0) {
        console.error('[mission-recovery] Failed to persist recovered mission status (CAS failed or DB error):', updateErr)
        // Invariant: If DB/CAS update failed (e.g. concurrent owner pause, epoch bump, or updated_at mismatch),
        // fail-closed! Return previousStatus and resumePoint: 'NO_OP' to prevent caller from falsely treating recovery as successful.
        return {
          missionId: mission.id,
          previousStatus,
          recoveredStatus: previousStatus,
          resumePoint: 'NO_OP',
          actionTaken: 'CAS_UPDATE_REJECTED_CONCURRENT_MUTATION',
          isBlindRetryBlocked,
        }
      }

      // Append recovery event to mission_events only if CAS update succeeded
      await (this.client as any)
        .from('mission_events')
        .insert({
          workspace_id: mission.workspace_id,
          mission_id: mission.id,
          trace_id: mission.trace_id,
          from_status: previousStatus,
          to_status: recoveredStatus,
          actor_type: 'system',
          event_name: 'MISSION_RECOVERY_RECONCILED',
          payload: {
            previousStatus,
            recoveredStatus,
            resumePoint,
            actionTaken,
            isBlindRetryBlocked,
            failureContext,
          },
          occurred_at: now,
        })
    }

    return {
      missionId: mission.id,
      previousStatus,
      recoveredStatus,
      resumePoint,
      actionTaken,
      isBlindRetryBlocked,
    }
  }

  /**
   * Owner explicit Pause command
   */
  public async pauseMission(
    workspaceId: string,
    missionId: string,
    reason: string
  ): Promise<void> {
    const now = new Date().toISOString()
    const { data: mission, error: fetchErr } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchErr || !mission) {
      throw new Error(`[PAUSE_MISSION_FAILED] Mission not found: ${missionId}`)
    }

    assertEvidenceBackedTransition({
      fromStatus: mission.status,
      toStatus: 'PAUSED',
      mission,
      reason,
    })

    await (this.client as any)
      .from('marketing_missions')
      .update({ status: 'PAUSED', updated_at: now })
      .eq('id', missionId)

    await (this.client as any)
      .from('mission_events')
      .insert({
        workspace_id: workspaceId,
        mission_id: missionId,
        trace_id: mission.trace_id,
        from_status: mission.status,
        to_status: 'PAUSED',
        actor_type: 'user',
        event_name: 'OWNER_PAUSED_MISSION',
        payload: { reason },
        occurred_at: now,
      })
  }

  /**
   * Owner explicit Cancel command
   */
  public async cancelMission(
    workspaceId: string,
    missionId: string,
    reason: string
  ): Promise<void> {
    const now = new Date().toISOString()
    const { data: mission, error: fetchErr } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (fetchErr || !mission) {
      throw new Error(`[CANCEL_MISSION_FAILED] Mission not found: ${missionId}`)
    }

    assertEvidenceBackedTransition({
      fromStatus: mission.status,
      toStatus: 'CANCELLED',
      mission,
      reason,
    })

    await (this.client as any)
      .from('marketing_missions')
      .update({ status: 'CANCELLED', updated_at: now })
      .eq('id', missionId)

    await (this.client as any)
      .from('mission_events')
      .insert({
        workspace_id: workspaceId,
        mission_id: missionId,
        trace_id: mission.trace_id,
        from_status: mission.status,
        to_status: 'CANCELLED',
        actor_type: 'user',
        event_name: 'OWNER_CANCELLED_MISSION',
        payload: { reason },
        occurred_at: now,
      })
  }
}
