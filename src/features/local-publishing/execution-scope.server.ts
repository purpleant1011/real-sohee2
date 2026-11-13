import 'server-only'

import { z } from 'zod'
import type { ConnectorDevice } from './device-auth'
import type { LocalPublishingRpcGateway } from './repository'
import {
  checkpointRecoveryRequestSchema, checkpointRecoverySchema, deviceExecutionScopeSchema,
  executionCandidateQuerySchema, executionCandidateSchema, executionScopeAuthorizationSchema,
  executionScopeSelectionSchema,
} from './execution-scope'

type Actor = Readonly<{ workspaceId: string; userId: string }>
type Result<T> = Readonly<{ data: T }> | Readonly<{ error: { code: string } }>
const actorSchema = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).strict()

async function gateway(): Promise<LocalPublishingRpcGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as LocalPublishingRpcGateway
}

async function call<T>(schema: z.ZodType<T>, name: string, args: Record<string, unknown>, provided?: LocalPublishingRpcGateway): Promise<Result<T>> {
  try {
    const db = provided ?? await gateway()
    const result = await db.rpc(name, args)
    if (result.error) return { error: { code: 'SCOPE_QUERY_FAILED' } }
    const parsed = schema.safeParse(result.data)
    return parsed.success ? { data: parsed.data } : { error: { code: 'SCOPE_RESPONSE_INVALID' } }
  } catch {
    return { error: { code: 'SCOPE_QUERY_FAILED' } }
  }
}

export async function authorizeExecutionScope(actor: Actor, input: unknown, provided?: LocalPublishingRpcGateway): Promise<Result<z.infer<typeof executionScopeAuthorizationSchema>>> {
  const parsed = executionScopeSelectionSchema.safeParse(input)
  if (!actorSchema.safeParse(actor).success || !parsed.success) return { error: { code: 'SCOPE_SELECTION_INVALID' } } as const
  const value = parsed.data
  const result = await call(executionScopeAuthorizationSchema.nullable(), 'authorize_local_publish_execution_scope', {
    p_workspace_id: actor.workspaceId, p_actor_user_id: actor.userId, p_action_id: value.actionId,
    p_expected_fingerprint: value.fingerprint, p_request_id: value.requestId, p_expected_connection_id: value.connectionId,
  }, provided)
  if ('error' in result) return result
  if (!result.data || result.data.actionId !== value.actionId) return { error: { code: 'SCOPE_SELECTION_REJECTED' } } as const
  return { data: result.data } as const
}

export async function findExecutionCandidate(actor: Actor, input: unknown, provided?: LocalPublishingRpcGateway): Promise<Result<z.infer<typeof executionCandidateSchema> | null>> {
  const parsed = executionCandidateQuerySchema.safeParse(input)
  if (!actorSchema.safeParse(actor).success || !parsed.success) return { error: { code: 'SCOPE_QUERY_INVALID' } } as const
  const value = parsed.data
  return call(executionCandidateSchema.nullable(), 'find_local_publish_execution_candidate', {
    p_workspace_id: actor.workspaceId, p_actor_user_id: actor.userId, p_content_id: value.contentId,
    p_version_id: value.versionId, p_fingerprint: value.fingerprint, p_connection_id: value.connectionId,
  }, provided)
}

export async function readDeviceExecutionScope(device: ConnectorDevice, provided?: LocalPublishingRpcGateway): Promise<Result<z.infer<typeof deviceExecutionScopeSchema>>> {
  return call(deviceExecutionScopeSchema, 'get_local_publish_execution_scope', {
    p_workspace_id: device.workspaceId, p_device_id: device.deviceId, p_token_digest: device.tokenDigest,
  }, provided)
}

export async function recoverDeviceCheckpoint(device: ConnectorDevice, jobId: string, input: unknown, provided?: LocalPublishingRpcGateway): Promise<Result<z.infer<typeof checkpointRecoverySchema>>> {
  const parsed = checkpointRecoveryRequestSchema.safeParse(input)
  if (!z.string().uuid().safeParse(jobId).success || !parsed.success) return { error: { code: 'SCOPE_RECOVERY_INVALID' } } as const
  return call(checkpointRecoverySchema, 'recover_scoped_local_publish_checkpoint', {
    p_workspace_id: device.workspaceId, p_device_id: device.deviceId, p_token_digest: device.tokenDigest,
    p_action_id: jobId, p_lease_id: parsed.data.leaseId, p_may_have_submitted: parsed.data.mayHaveSubmitted,
  }, provided)
}
