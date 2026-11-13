import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'
import type { ExternalActionChannel, ExternalActionKind } from '@/features/external-actions/types'

export interface CreateActionRequestInput {
  workspaceId: string
  actorUserId: string
  channel: ExternalActionChannel
  actionKind: ExternalActionKind
  targetExternalId: string
  targetLabel: string
  exactPayload: Record<string, unknown>
  idempotencyKey?: string
  contentVersionId?: string
  approvalId?: string
  approvalFingerprint?: string
}

export interface CreateActionAttemptInput {
  workspaceId: string
  actionRequestId: string
  actorUserId: string
  attemptNumber?: number
}

export interface RecordReceiptInput {
  workspaceId: string
  actionRequestId: string
  attemptId: string
  receiptKind: 'submission' | 'provider_review' | 'observed_result' | 'manual_assist'
  providerReference?: string | null
  resultUrl?: string | null
  observedPayload: Record<string, unknown>
  actorUserId: string
}

export class ExternalActionService {
  private static getClient() {
    return createAdminSupabaseClient() as any
  }

  /**
   * Persists an external_action_request record fail-closed.
   */
  public static async createActionRequest(input: CreateActionRequestInput) {
    const client = this.getClient()
    const id = crypto.randomUUID()
    const idempotencyKey = input.idempotencyKey || `req-${input.workspaceId}-${input.channel}-${Date.now()}`

    const res = await client
      .from('external_action_requests')
      .insert({
        id,
        workspace_id: input.workspaceId,
        channel: input.channel,
        action_kind: input.actionKind,
        target_external_id: input.targetExternalId,
        target_label: input.targetLabel,
        exact_payload: input.exactPayload,
        content_version_id: input.contentVersionId || null,
        approval_id: input.approvalId || null,
        approval_fingerprint: input.approvalFingerprint || null,
        idempotency_key: idempotencyKey,
        status: 'prepared',
        created_by: input.actorUserId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id, workspace_id, channel, action_kind, status')
      .single()

    return assertSupabaseSuccess(res, 'createActionRequest')
  }

  /**
   * Persists an external_action_attempt record fail-closed.
   */
  public static async createActionAttempt(input: CreateActionAttemptInput) {
    const client = this.getClient()
    const id = crypto.randomUUID()
    const attemptNumber = input.attemptNumber || 1

    const res = await client
      .from('external_action_attempts')
      .insert({
        id,
        workspace_id: input.workspaceId,
        action_request_id: input.actionRequestId,
        attempt_number: attemptNumber,
        status: 'claimed',
        started_at: new Date().toISOString(),
        created_by: input.actorUserId,
      })
      .select('id, workspace_id, action_request_id, attempt_number, status')
      .single()

    return assertSupabaseSuccess(res, 'createActionAttempt')
  }

  /**
   * Persists an external_action_receipt record fail-closed.
   */
  public static async recordReceipt(input: RecordReceiptInput) {
    const client = this.getClient()
    const id = crypto.randomUUID()

    const res = await client
      .from('external_action_receipts')
      .insert({
        id,
        workspace_id: input.workspaceId,
        action_request_id: input.actionRequestId,
        attempt_id: input.attemptId,
        receipt_kind: input.receiptKind,
        provider_reference: input.providerReference || null,
        result_url: input.resultUrl || null,
        observed_payload: input.observedPayload,
        recorded_by: input.actorUserId,
        recorded_at: new Date().toISOString(),
      })
      .select('id, workspace_id, action_request_id, attempt_id, receipt_kind')
      .single()

    return assertSupabaseSuccess(res, 'recordReceipt')
  }

  /**
   * Updates an action request status.
   */
  public static async updateRequestStatus(
    workspaceId: string,
    actionRequestId: string,
    status: string,
    failureCode?: string | null,
  ) {
    const client = this.getClient()
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (failureCode !== undefined) {
      updateData.failure_code = failureCode
    }

    const res = await client
      .from('external_action_requests')
      .update(updateData)
      .eq('workspace_id', workspaceId)
      .eq('id', actionRequestId)
      .select('id, status')
      .single()

    return assertSupabaseSuccess(res, 'updateRequestStatus')
  }

  /**
   * Updates an action attempt status.
   */
  public static async updateAttemptStatus(
    workspaceId: string,
    attemptId: string,
    status: string,
    options?: {
      failureCode?: string | null
      providerRequestId?: string | null
      providerReference?: string | null
      finishedAt?: string | null
    },
  ) {
    const client = this.getClient()
    const updateData: Record<string, unknown> = { status }
    if (options?.failureCode !== undefined) updateData.failure_code = options.failureCode
    if (options?.providerRequestId !== undefined) updateData.provider_request_id = options.providerRequestId
    if (options?.providerReference !== undefined) updateData.provider_reference = options.providerReference
    if (options?.finishedAt !== undefined) updateData.finished_at = options.finishedAt

    const res = await client
      .from('external_action_attempts')
      .update(updateData)
      .eq('workspace_id', workspaceId)
      .eq('id', attemptId)
      .select('id, status')
      .single()

    return assertSupabaseSuccess(res, 'updateAttemptStatus')
  }
}
