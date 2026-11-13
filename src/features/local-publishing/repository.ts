import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

import type { ConnectorDevice } from './device-auth'
import { checkpointSchema, type LocalPublishCheckpoint } from './contracts'
import { executionScopeRefSchema } from './execution-scope'

type RpcResult = Promise<{ data: unknown; error: unknown }>
export type LocalPublishingRpcGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): RpcResult
}>

type Result<T> = Readonly<{ data: T }> | Readonly<{ error: { code: string } }>

const claimSchema = z.object({
  jobId: z.string().uuid(),
  leaseId: z.string().uuid(),
  attemptId: z.string().uuid(),
  contentVersionId: z.string().uuid(),
  approvalId: z.string().uuid(),
  approvalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  browserChannelConnectionId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  autoExecuteUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

const completionSchema = z.object({
  jobId: z.string().uuid(),
  leaseId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed_before_submit', 'unknown_after_submit']),
  providerReference: z.string().min(1).max(500).optional(),
  resultUrl: z.string().url().max(2_048).optional(),
  failureCode: z.string().min(1).max(120).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'succeeded' && value.resultUrl === undefined) {
    context.addIssue({ code: 'custom', path: ['resultUrl'], message: '성공 결과 주소가 필요합니다.' })
  }
  if (value.status === 'failed_before_submit' && value.failureCode === undefined) {
    context.addIssue({ code: 'custom', path: ['failureCode'], message: '제출 전 실패 코드가 필요합니다.' })
  }
})

const connectionInputSchema = z.object({
  channel: z.enum(['naver_blog', 'daangn_business']),
  externalAccountLabel: z.string().min(1).max(255), targetExternalId: z.string().min(1).max(255),
  targetUrl: z.string().url().max(2_048), environment: z.enum(['test', 'production']),
}).strict()

async function productionGateway(): Promise<LocalPublishingRpcGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as LocalPublishingRpcGateway
}

export async function claimLocalPublishJob(
  device: ConnectorDevice,
  tokenDigest: string,
  providedGateway?: LocalPublishingRpcGateway,
): Promise<Result<z.infer<typeof claimSchema> | null>> {
  if (!/^[a-f0-9]{64}$/.test(tokenDigest)) return { error: { code: 'DEVICE_AUTH_REQUIRED' } }
  const gateway = providedGateway ?? await productionGateway()
  const recovery = await gateway.rpc('recover_expired_local_publish_jobs', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
  })
  if (recovery.error) return { error: { code: 'CLAIM_RECOVERY_FAILED' } }
  const result = await gateway.rpc('claim_local_publish_job', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
    p_token_digest: tokenDigest,
  })
  if (result.error) return { error: { code: 'CLAIM_FAILED' } }
  if (result.data === null) return { data: null }
  const parsed = claimSchema.safeParse(result.data)
  return parsed.success ? { data: parsed.data } : { error: { code: 'CLAIM_INVALID' } }
}

export async function claimScopedLocalPublishJob(
  device: ConnectorDevice,
  input: unknown,
  providedGateway?: LocalPublishingRpcGateway,
): Promise<Result<z.infer<typeof claimSchema> | null>> {
  const scope = executionScopeRefSchema.safeParse(input)
  if (!scope.success) return { error: { code: 'SCOPE_REQUEST_INVALID' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('claim_scoped_local_publish_job', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
    p_token_digest: device.tokenDigest,
    p_action_id: scope.data.actionId,
    p_scope_id: scope.data.scopeId,
  })
  if (result.error) return { error: { code: 'SCOPE_CLAIM_FAILED' } }
  if (result.data === null) return { data: null }
  const parsed = claimSchema.safeParse(result.data)
  return parsed.success && parsed.data.jobId === scope.data.actionId
    ? { data: parsed.data }
    : { error: { code: 'SCOPE_CLAIM_INVALID' } }
}

export async function recordCheckpoint(
  device: ConnectorDevice,
  input: LocalPublishCheckpoint,
  providedGateway?: LocalPublishingRpcGateway,
): Promise<Result<true>> {
  const parsed = checkpointSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CHECKPOINT_INVALID' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('record_local_publish_checkpoint', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
    p_action_id: parsed.data.jobId,
    p_lease_id: parsed.data.leaseId,
    p_phase: parsed.data.phase,
    p_failure_code: parsed.data.failureCode ?? null,
    p_provider_reference: parsed.data.providerReference ?? null,
    p_result_url: parsed.data.resultUrl ?? null,
  })
  return !result.error && result.data === true ? { data: true } : { error: { code: 'CHECKPOINT_REJECTED' } }
}

export async function issueLocalSubmitPermit(
  device: ConnectorDevice,
  jobId: string,
  leaseId: string,
  dependencies?: LocalPublishingRpcGateway & Readonly<{ randomToken?: () => string }>,
): Promise<Result<Readonly<{ permit: string }>>> {
  if (!z.string().uuid().safeParse(jobId).success || !z.string().uuid().safeParse(leaseId).success) {
    return { error: { code: 'LEASE_INVALID' } }
  }
  const gateway = dependencies ?? await productionGateway()
  const permit = dependencies?.randomToken?.() ?? randomBytes(32).toString('base64url')
  const permitDigest = createHash('sha256').update(permit, 'utf8').digest('hex')
  const result = await gateway.rpc('issue_local_submit_permit', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
    p_action_id: jobId,
    p_lease_id: leaseId,
    p_permit_digest: permitDigest,
  })
  return !result.error && result.data === true
    ? { data: Object.freeze({ permit }) }
    : { error: { code: 'SUBMIT_PERMIT_REJECTED' } }
}

export async function completeLocalPublishJob(
  device: ConnectorDevice,
  input: unknown,
  providedGateway?: LocalPublishingRpcGateway,
): Promise<Result<true>> {
  const parsed = completionSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'COMPLETION_INVALID' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('complete_local_publish_job', {
    p_workspace_id: device.workspaceId,
    p_device_id: device.deviceId,
    p_action_id: parsed.data.jobId,
    p_lease_id: parsed.data.leaseId,
    p_status: parsed.data.status,
    p_provider_reference: parsed.data.providerReference ?? null,
    p_result_url: parsed.data.resultUrl ?? null,
    p_failure_code: parsed.data.failureCode ?? null,
  })
  return !result.error && result.data === true ? { data: true } : { error: { code: 'COMPLETION_REJECTED' } }
}

export async function registerBrowserChannelConnection(
  device: ConnectorDevice,
  input: unknown,
  providedGateway?: LocalPublishingRpcGateway,
): Promise<Result<Readonly<{ connectionId: string }>>> {
  const parsed = connectionInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CONNECTION_INVALID' } }
  const fingerprint = createHash('sha256').update(`${parsed.data.channel}\0${parsed.data.targetExternalId}\0${parsed.data.environment}`, 'utf8').digest('hex')
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('register_browser_channel_connection', {
    p_workspace_id: device.workspaceId, p_device_id: device.deviceId,
    p_channel: parsed.data.channel, p_external_account_label: parsed.data.externalAccountLabel,
    p_target_external_id: parsed.data.targetExternalId, p_target_url: parsed.data.targetUrl,
    p_environment: parsed.data.environment, p_target_fingerprint: fingerprint,
  })
  const id = z.string().uuid().safeParse(result.data)
  return !result.error && id.success ? { data: { connectionId: id.data } } : { error: { code: 'CONNECTION_REJECTED' } }
}
