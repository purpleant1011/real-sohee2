import type { ServerSupabaseClient } from '@/features/operations/types'
import type { Json } from '@/lib/supabase/database.types'
import type { UsageEventInput } from '@/features/credits/usage-event'
import type { ConversationJob } from './jobs/types'
import { UnknownProviderOutcomeError } from './jobs/runner'

export function createPreparedAgentPersistence(input: {
  client: ServerSupabaseClient
  job: Pick<ConversationJob, 'id' | 'workspaceId' | 'workerId'>
  authorized(): Promise<boolean>
}) {
  let activeModelCall: string | null = null
  const assertAuthority = async () => {
    if (!input.job.workerId || !await input.authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
  }
  return {
    async prepareModelCall(attempt: number) {
      await assertAuthority()
      if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) throw new Error('MODEL_ATTEMPT_INVALID')
      const key = `${input.job.id}:model:${attempt}`
      const previous = await input.client.from('conversation_job_steps').select('id')
        .eq('workspace_id', input.job.workspaceId).eq('job_id', input.job.id).eq('provider_call_key', key).maybeSingle()
      if (previous.error) throw new Error('MODEL_INTENT_READ_UNAVAILABLE')
      if (previous.data) throw new UnknownProviderOutcomeError()
      const result = await input.client.from('conversation_job_steps').insert({
        workspace_id: input.job.workspaceId, job_id: input.job.id, provider_call_key: key,
        operation: 'text_response', state: 'in_flight', status: 'running',
        step_index: 1_000_000 + attempt, capability_id: 'model.plan', risk_tier: 'LOW',
        input_payload: {}, output_payload: {}, started_at: new Date().toISOString(),
      }).select('id').single()
      if (result.error?.code === '23505') throw new UnknownProviderOutcomeError()
      if (result.error || !result.data?.id) throw new Error('MODEL_INTENT_PERSISTENCE_UNAVAILABLE')
      activeModelCall = key
      await assertAuthority()
    },
    async completeModelCall(usage: UsageEventInput) {
      if (!activeModelCall) throw new Error('MODEL_INTENT_MISSING')
      const result = await input.client.from('conversation_job_steps').update({
        state: 'succeeded', status: 'completed', completed_at: new Date().toISOString(),
        provider_request_id: usage.providerRequestId,
        output_payload: { provider: usage.provider, model: usage.model, usageSource: usage.usageSource },
      }).eq('workspace_id', input.job.workspaceId).eq('job_id', input.job.id)
        .eq('provider_call_key', activeModelCall).eq('state', 'in_flight').select('id').maybeSingle()
      if (result.error || !result.data?.id) throw new Error('MODEL_OUTCOME_PERSISTENCE_UNAVAILABLE')
      activeModelCall = null
    },
    async stageResponse(userId: string, content: string, successful: boolean) {
      await assertAuthority()
      const result = await input.client.rpc('stage_conversation_agent_response', {
        p_workspace_id: input.job.workspaceId, p_job_id: input.job.id,
        p_worker_id: input.job.workerId!, p_user_id: userId, p_content: content,
        p_successful: successful, p_error_code: successful ? null : 'CONVERSATION_AGENT_UNAVAILABLE',
      })
      if (result.error?.code === '42501') throw new Error('CONVERSATION_AUTHORITY_LOST')
      if (result.error || result.data !== true) throw new Error('CONVERSATION_RESPONSE_PERSISTENCE_UNAVAILABLE')
    },
    async persistPlan(plan: Record<string, unknown>) {
      await assertAuthority()
      const now = new Date().toISOString()
      const result = await input.client.from('conversation_jobs').update({
        plan_data: plan as Json, heartbeat_at: now, updated_at: now,
      }).eq('workspace_id', input.job.workspaceId).eq('id', input.job.id)
        .eq('worker_id', input.job.workerId!).eq('status', 'running').select('id').maybeSingle()
      if (result.error) throw new Error('CONVERSATION_CHECKPOINT_UNAVAILABLE')
      if (!result.data?.id) throw new Error('CONVERSATION_AUTHORITY_LOST')
    },
  }
}
