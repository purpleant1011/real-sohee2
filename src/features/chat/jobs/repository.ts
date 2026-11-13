import { z } from 'zod'
import type {
  ClaimConversationJobResult,
  ConversationJob,
  ConversationJobStatus,
  RecordedJobUsage,
} from './types'

type RpcResult = Promise<Readonly<{ data: unknown; error: unknown }>>
export type ConversationJobGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): RpcResult
}>

const uuid = z.string().uuid()
const jobStatus = z.enum(['queued', 'running', 'cancel_requested', 'succeeded', 'needs_attention', 'cancelled'])
const jobRow = z.object({
  id: uuid,
  workspace_id: uuid,
  thread_id: uuid,
  user_message_id: uuid,
  assistant_message_id: uuid,
  reservation_id: uuid,
  status: jobStatus,
  kind: z.enum(['chat', 'content_generation', 'image_generation', 'publish_preparation']),
  sequence_number: z.number().int().positive(),
  worker_id: uuid.nullable(),
}).passthrough()

const claimResult = z.discriminatedUnion('state', [
  z.object({ state: z.literal('claimed'), job: jobRow }).strict(),
  z.object({ state: z.literal('terminal'), job: jobRow }).strict(),
  z.object({ state: z.enum(['blocked_by_predecessor', 'missing', 'not_claimed']) }).strict(),
])

function mapJob(value: z.infer<typeof jobRow>): ConversationJob {
  return Object.freeze({
    id: value.id,
    workspaceId: value.workspace_id,
    threadId: value.thread_id,
    userMessageId: value.user_message_id,
    assistantMessageId: value.assistant_message_id,
    reservationId: value.reservation_id,
    status: value.status,
    kind: value.kind,
    sequenceNumber: value.sequence_number,
    workerId: value.worker_id,
  })
}

function validUsage(input: RecordedJobUsage, credits: number) {
  const values = Object.values(input.event.usage)
  return z.string().trim().min(1).max(200).safeParse(input.providerCallKey).success
    && z.number().int().positive().safeParse(credits).success
    && values.every((value) => Number.isSafeInteger(value) && value >= 0)
    && input.event.usage.cachedTextInputTokens <= input.event.usage.textInputTokens
}

export function createConversationJobRepository(gateway: ConversationJobGateway) {
  return Object.freeze({
    async claim(jobId: string, workerId: string): Promise<ClaimConversationJobResult> {
      const ids = z.object({ jobId: uuid, workerId: uuid }).safeParse({ jobId, workerId })
      if (!ids.success) throw new Error('CONVERSATION_JOB_CLAIM_INVALID')
      const response = await gateway.rpc('claim_conversation_job', {
        p_job_id: ids.data.jobId,
        p_worker_id: ids.data.workerId,
        p_now: new Date().toISOString(),
      })
      const parsed = claimResult.safeParse(response.data)
      if (response.error || !parsed.success) throw new Error('CONVERSATION_JOB_CLAIM_FAILED')
      if ('job' in parsed.data && parsed.data.job.id !== ids.data.jobId) throw new Error('CONVERSATION_JOB_CLAIM_FAILED')
      if (parsed.data.state === 'terminal' && parsed.data.job.status === 'needs_attention' && parsed.data.job.worker_id
        && (parsed.data.job.safe_error_code === 'CONVERSATION_CONTEXT_UNAVAILABLE' || parsed.data.job.safe_error_code === 'CREDIT_STATE_UNAVAILABLE')) {
        // Completion may have committed before the reconciliation call was interrupted.
        // Redelivery retries only the zero-effect proof, using the original worker fence.
        const reconciled = await gateway.rpc('resolve_unstarted_conversation_job_attention', {
          p_workspace_id: parsed.data.job.workspace_id, p_job_id: parsed.data.job.id, p_worker_id: parsed.data.job.worker_id,
        })
        if (reconciled.error || typeof reconciled.data !== 'boolean') throw new Error('CONVERSATION_JOB_ATTENTION_RECONCILIATION_FAILED')
      }
      return 'job' in parsed.data
        ? Object.freeze({ state: parsed.data.state, job: mapJob(parsed.data.job) })
        : Object.freeze({ state: parsed.data.state })
    },
    async recordUsage(job: ConversationJob, usage: RecordedJobUsage, credits: number) {
      if (!validUsage(usage, credits)) throw new Error('CONVERSATION_JOB_USAGE_INVALID')
      const response = await gateway.rpc('record_ai_usage_event_v2', {
        p_provider: usage.event.provider,
        p_workspace_id: job.workspaceId,
        p_job_id: job.id,
        p_message_id: job.assistantMessageId,
        p_provider_call_key: usage.providerCallKey,
        p_provider_request_id: usage.event.providerRequestId,
        p_model: usage.event.model,
        p_operation: usage.event.operation,
        p_text_input_tokens: usage.event.usage.textInputTokens,
        p_cached_text_input_tokens: usage.event.usage.cachedTextInputTokens,
        p_text_output_tokens: usage.event.usage.textOutputTokens,
        p_image_input_tokens: usage.event.usage.imageInputTokens,
        p_image_output_tokens: usage.event.usage.imageOutputTokens,
        p_provider_total_tokens: usage.event.usage.providerTotalTokens,
        p_usage_source: usage.event.usageSource,
        p_policy_version: 'v08-test-2000-1',
        p_computed_credits: credits,
      })
      if (response.error || response.data !== true) throw new Error('CONVERSATION_JOB_USAGE_WRITE_FAILED')
    },
    async complete(job: ConversationJob, status: Extract<ConversationJobStatus, 'succeeded' | 'needs_attention' | 'cancelled'>, safeErrorCode: string | null) {
      if (!job.workerId) throw new Error('CONVERSATION_JOB_WORKER_MISSING')
      const response = await gateway.rpc('complete_conversation_job_v2', {
        p_job_id: job.id,
        p_worker_id: job.workerId,
        p_status: status,
        p_safe_error_code: safeErrorCode,
        p_now: new Date().toISOString(),
      })
      const completed = z.object({ job: jobRow }).passthrough().safeParse(response.data)
      if (response.error || !completed.success || completed.data.job.id !== job.id
        || completed.data.job.workspace_id !== job.workspaceId || completed.data.job.worker_id !== job.workerId
        || completed.data.job.status !== status) throw new Error('CONVERSATION_JOB_COMPLETE_FAILED')
      if (status === 'needs_attention' && (safeErrorCode === 'CONVERSATION_CONTEXT_UNAVAILABLE' || safeErrorCode === 'CREDIT_STATE_UNAVAILABLE')) {
        const reconciled = await gateway.rpc('resolve_unstarted_conversation_job_attention', {
          p_workspace_id: job.workspaceId, p_job_id: job.id, p_worker_id: job.workerId,
        })
        if (reconciled.error || typeof reconciled.data !== 'boolean') throw new Error('CONVERSATION_JOB_ATTENTION_RECONCILIATION_FAILED')
      }
    },
  })
}
