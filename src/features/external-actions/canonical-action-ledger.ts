/**
 * Canonical External Action Ledger Service (ANI-1020)
 *
 * Implements strict, durable external action state machine:
 * REQUESTED -> ATTEMPTING -> PROVIDER_ACCEPTED -> VERIFYING -> VERIFIED
 *
 * Enforces Fail-Closed DB SSOT:
 * - external_action_requests
 * - external_action_attempts
 * - external_action_receipts
 *
 * Prohibits provider writes without persistent request/attempt rows.
 */

import crypto from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PersistenceError } from '@/lib/errors/persistence-error'
import { findMatchingActionRequest } from '@/lib/external-actions/action-request-contract'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'

export type ExternalActionChannel = 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn_business'
export type ExternalActionKind =
  | 'profile_edit'
  | 'news_post'
  | 'blog_post'
  | 'business_news_post'
  | 'feed_publish'
  | 'thread_publish'
  | 'comment_reply'
  | 'story_publish'
  | 'dm_reply'

export interface CreateActionRequestParams {
  workspaceId: string
  channel: ExternalActionChannel
  actionKind: ExternalActionKind
  targetExternalId: string
  targetLabel: string
  exactPayload: Record<string, unknown>
  contentVersionId?: string
  approvalId?: string
  approvalFingerprint?: string
  idempotencyKey?: string
  createdBy?: string
  adminClient?: any
}

export interface StartAttemptParams {
  workspaceId: string
  actionRequestId: string
  attemptNumber?: number
  createdBy?: string
  adminClient?: any
}

export interface RecordReceiptParams {
  workspaceId: string
  actionRequestId: string
  attemptId: string
  providerReference: string
  resultUrl: string
  observedPayload: Record<string, unknown>
  recordedBy?: string
  adminClient?: any
}

export interface CreateActionResult {
  requestId: string
  status: string
  idempotencyKey: string
  isExisting: boolean
  resultUrl?: string
  receiptId?: string
  providerReference?: string
}

export interface MarkUnknownResultParams {
  workspaceId: string
  actionRequestId: string
  attemptId?: string
  reason?: string
  adminClient?: any
}

export interface MarkFailedAttemptParams {
  workspaceId: string
  actionRequestId: string
  attemptId: string
  failureCode?: string
  reason?: string
}

export interface ReconcileUnknownRequestParams {
  workspaceId: string
  actionRequestId: string
  readbackFn: () => Promise<{
    isLive: boolean
    externalPostId?: string
    permalink?: string
    observedPayload?: Record<string, unknown>
  }>
}

export interface ReconcileOutcome {
  reconciled: boolean
  status: 'succeeded' | 'failed' | 'unknown_result'
  resultUrl?: string
  receiptId?: string
}

export class CanonicalActionLedgerService {
  /**
   * 1. Creates durable external_action_requests row BEFORE any provider call.
   * Enforces idempotency: if request with idempotency_key already exists, returns existing state without duplicate insert.
   */
  public static async createActionRequest(params: CreateActionRequestParams): Promise<CreateActionResult> {
    const {
      workspaceId,
      channel,
      actionKind,
      targetExternalId,
      targetLabel,
      exactPayload,
      contentVersionId,
      approvalId,
      approvalFingerprint,
      idempotencyKey = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdBy = '00000000-0000-0000-0000-000000000000',
    } = params

    const requestId = crypto.randomUUID()

    try {
      const db = (params.adminClient || (await createServerSupabaseClient())) as any

      const contract = {
        workspace_id: workspaceId, channel, action_kind: actionKind,
        target_external_id: targetExternalId, exact_payload: exactPayload,
        content_version_id: contentVersionId, approval_id: approvalId,
        approval_fingerprint: approvalFingerprint,
      }
      const reuse = async (existing: any): Promise<CreateActionResult> => {
        let resultUrl: string | undefined
        let receiptId: string | undefined
        let providerReference: string | undefined

        if (existing.status === 'succeeded') {
          const { data: receipt, error: receiptError } = await db
            .from('external_action_receipts')
            .select('id, result_url, provider_reference')
            .eq('workspace_id', workspaceId)
            .eq('action_request_id', existing.id)
            .maybeSingle()

          if (receiptError) throw new PersistenceError('reuseActionRequest', '기존 결과를 조회하지 못했습니다.', receiptError)
          if (receipt) {
            resultUrl = receipt.result_url
            receiptId = receipt.id
            providerReference = receipt.provider_reference
          }
        }

        return {
          requestId: existing.id,
          status: existing.status,
          idempotencyKey: existing.idempotency_key,
          isExisting: true,
          resultUrl,
          receiptId,
          providerReference,
        }
      }

      const existing = await findMatchingActionRequest(db, idempotencyKey, contract)
      if (existing) return reuse(existing)

      const record: Record<string, unknown> = {
        id: requestId,
        workspace_id: workspaceId,
        channel,
        action_kind: actionKind,
        target_external_id: targetExternalId,
        target_label: targetLabel,
        exact_payload: exactPayload,
        idempotency_key: idempotencyKey,
        status: 'prepared',
        created_by: createdBy,
      }

      if (contentVersionId) record.content_version_id = contentVersionId
      if (approvalId) record.approval_id = approvalId
      if (approvalFingerprint) record.approval_fingerprint = approvalFingerprint

      const mutation = await db
        .from('external_action_requests')
        .insert(record)
        .select('id, status, idempotency_key')
        .single()

      if (mutation.error?.code === '23505') {
        const winner = await findMatchingActionRequest(db, idempotencyKey, contract)
        if (!winner) throw new PersistenceError('createActionRequest', '동시 요청 결과를 확인하지 못했습니다.', mutation.error)
        return reuse(winner)
      }
      const data = assertSupabaseSuccess<any>(mutation, 'CanonicalActionLedger.createActionRequest')

      return {
        requestId: data.id,
        status: data.status,
        idempotencyKey: data.idempotency_key,
        isExisting: false,
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalActionLedger] Error creating action request:', err)
      throw new PersistenceError('createActionRequest', (err as Error).message || 'Failed to persist action request', err)
    }
  }

  /**
   * Transitions request and attempt to unknown_result state upon provider timeout or ambiguous error
   */
  public static async markUnknownResult(params: MarkUnknownResultParams): Promise<void> {
    const { workspaceId, actionRequestId, attemptId, adminClient } = params

    try {
      const db = (adminClient || (await createServerSupabaseClient())) as any

      await db
        .from('external_action_requests')
        .update({
          status: 'unknown_result',
          failure_code: 'UNKNOWN_RESULT',
          updated_at: new Date().toISOString(),
        })
        .eq('id', actionRequestId)
        .eq('workspace_id', workspaceId)

      if (attemptId) {
        await db
          .from('external_action_attempts')
          .update({
            status: 'unknown_result',
            failure_code: 'UNKNOWN_RESULT',
            finished_at: new Date().toISOString(),
          })
          .eq('id', attemptId)
          .eq('workspace_id', workspaceId)
      }
    } catch (err) {
      console.error('[CanonicalActionLedger] Error marking unknown result:', err)
      throw new PersistenceError('markUnknownResult', (err as Error).message || 'Failed to mark unknown result', err)
    }
  }

  /**
   * Reconciles unknown_result request via independent readback verification
   */
  public static async reconcileUnknownRequest(params: ReconcileUnknownRequestParams): Promise<ReconcileOutcome> {
    const { workspaceId, actionRequestId, readbackFn } = params

    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const { data: request } = await db
        .from('external_action_requests')
        .select('id, status, channel')
        .eq('workspace_id', workspaceId)
        .eq('id', actionRequestId)
        .maybeSingle()

      if (!request) {
        throw new PersistenceError('reconcileUnknownRequest', 'Request not found')
      }

      const { data: attempt } = await db
        .from('external_action_attempts')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('action_request_id', actionRequestId)
        .order('attempt_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      const attemptId = attempt?.id || crypto.randomUUID()
      const readback = await readbackFn()

      if (readback.isLive && readback.externalPostId && readback.permalink) {
        const verified = await this.recordReceiptAndVerify({
          workspaceId,
          actionRequestId,
          attemptId,
          providerReference: readback.externalPostId,
          resultUrl: readback.permalink,
          observedPayload: readback.observedPayload || {},
        })

        return {
          reconciled: true,
          status: 'succeeded',
          resultUrl: verified.resultUrl,
          receiptId: verified.receiptId,
        }
      }

      return {
        reconciled: false,
        status: 'unknown_result',
      }
    } catch (err) {
      console.error('[CanonicalActionLedger] Error reconciling unknown request:', err)
      throw new PersistenceError('reconcileUnknownRequest', (err as Error).message || 'Failed to reconcile unknown request', err)
    }
  }

  /**
   * 2. Starts attempt row immediately prior to provider invocation
   */
  public static async startAttempt(params: StartAttemptParams): Promise<{
    attemptId: string
    attemptNumber: number
    status: string
  }> {
    const {
      workspaceId,
      actionRequestId,
      attemptNumber = 1,
      createdBy = '00000000-0000-0000-0000-000000000000',
    } = params

    const attemptId = crypto.randomUUID()

    try {
      const db = (params.adminClient || (await createServerSupabaseClient())) as any

      const mutation = await db
        .from('external_action_attempts')
        .insert({
          id: attemptId,
          workspace_id: workspaceId,
          action_request_id: actionRequestId,
          attempt_number: attemptNumber,
          status: 'submitted',
          created_by: createdBy,
        })
        .select('id, attempt_number, status')
        .single()

      const data = assertSupabaseSuccess<any>(mutation, 'CanonicalActionLedger.startAttempt')

      // Transition request status to executing
      await db
        .from('external_action_requests')
        .update({ status: 'executing' })
        .eq('id', actionRequestId)
        .eq('workspace_id', workspaceId)

      return {
        attemptId: data.id,
        attemptNumber: data.attempt_number,
        status: data.status,
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalActionLedger] Error starting attempt:', err)
      throw new PersistenceError('startAttempt', (err as Error).message || 'Failed to persist attempt', err)
    }
  }

  /**
   * 3. Records verified receipt and transitions attempt and request to succeeded
   */
  public static async recordReceiptAndVerify(params: RecordReceiptParams): Promise<{
    receiptId: string
    actionRequestId: string
    status: 'succeeded'
    resultUrl: string
  }> {
    const {
      workspaceId,
      actionRequestId,
      attemptId,
      providerReference,
      resultUrl,
      observedPayload,
      recordedBy = '00000000-0000-0000-0000-000000000000',
    } = params

    const receiptId = crypto.randomUUID()

    try {
      const db = (params.adminClient || (await createServerSupabaseClient())) as any

      // 1. Insert external_action_receipts
      const receiptMutation = await db
        .from('external_action_receipts')
        .insert({
          id: receiptId,
          workspace_id: workspaceId,
          action_request_id: actionRequestId,
          attempt_id: attemptId,
          receipt_kind: 'observed_result',
          provider_reference: providerReference,
          result_url: resultUrl,
          observed_payload: observedPayload,
          recorded_by: recordedBy,
        })
        .select('id')
        .single()

      assertSupabaseSuccess(receiptMutation, 'CanonicalActionLedger.recordReceiptAndVerify:receipt')

      // 2. Update attempt to succeeded
      await db
        .from('external_action_attempts')
        .update({
          status: 'succeeded',
          provider_reference: providerReference,
          finished_at: new Date().toISOString(),
        })
        .eq('id', attemptId)
        .eq('workspace_id', workspaceId)

      // 3. Update request to succeeded
      await db
        .from('external_action_requests')
        .update({
          status: 'succeeded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', actionRequestId)
        .eq('workspace_id', workspaceId)

      return {
        receiptId,
        actionRequestId,
        status: 'succeeded',
        resultUrl,
      }
    } catch (err) {
      if (err instanceof PersistenceError) throw err
      console.error('[CanonicalActionLedger] Error recording receipt:', err)
      throw new PersistenceError('recordReceiptAndVerify', (err as Error).message || 'Failed to persist receipt', err)
    }
  }
}
