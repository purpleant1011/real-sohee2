import { parseMetaLiveAllowlist } from '@/lib/safety/meta-live-allowlist'

export type CapabilityAction = 'publish' | 'reply' | 'message' | 'booking' | 'payment' | 'refund'
export type CapabilityEnvironment = Readonly<Record<string, string | undefined>>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const on = (value: string | undefined) => value === '1' || value === 'true'

/** Rollout permission is not provider permission. Production never accepts wildcard rollout. */
export function isWorkspaceInRollout(
  workspaceId: string | null | undefined,
  raw: string | null | undefined,
  environment: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!workspaceId || !UUID.test(workspaceId.trim())) return false
  const parsed = parseMetaLiveAllowlist(raw)
  if (parsed.isAll) return environment === 'test' || environment === 'development'
  return parsed.allowedUuids.has(workspaceId.trim().toLowerCase())
}

export function isCapabilityKilled(env: CapabilityEnvironment = process.env): boolean {
  return on(env.KILL_SWITCH) || on(env.CAPABILITY_KILL_SWITCH)
}

export function isRecoveryRolloutEnabled(workspaceId: string, write: boolean, env: CapabilityEnvironment = process.env): boolean {
  return on(env.BOOKING_RECOVERY_ENABLED)
    && isWorkspaceInRollout(workspaceId, env.BOOKING_RECOVERY_WORKSPACE_ALLOWLIST, env.NODE_ENV)
    && (!write || (!isCapabilityKilled(env) && !on(env.BOOKING_RECOVERY_KILL_SWITCH)))
}

export type CapabilityProvider = 'instagram' | 'threads' | 'internal' | 'portone' | 'kakao'
export interface PermissionEvidence {
  workspaceId: string
  provider: CapabilityProvider
  connected: boolean
  grantedScopes: readonly string[]
  verifiedAt: string | null
  expiresAt?: string | null
}
export interface CapabilityInput {
  workspaceId: string
  action: CapabilityAction
  provider: CapabilityProvider
  permission?: PermissionEvidence | null
  contract?: { workspaceId: string; provider: string; verifiedAt: string | null } | null
  schemaVerified?: boolean
  env?: CapabilityEnvironment
  now?: Date
}
export interface CapabilityDecision {
  ready: boolean
  reason: 'READY' | 'KILL_SWITCH_ACTIVE' | 'ROLLOUT_BLOCKED' | 'NOT_CONNECTED' | 'PERMISSION_NOT_VERIFIED' | 'SCOPE_MISSING' | 'CONTRACT_NOT_VERIFIED' | 'SCHEMA_NOT_VERIFIED' | 'UNSUPPORTED'
  manualAlternative: string
}
const alternatives: Record<CapabilityAction, string> = {
  publish: '보관하거나 문구를 복사해 직접 게시해 주세요.',
  reply: '답변을 복사해 채널에서 직접 답장해 주세요.',
  message: '답변을 복사해 채널에서 직접 보내 주세요.',
  booking: '장부를 확인하고 사장님이 직접 예약을 기록해 주세요.',
  payment: '예약금 없이 예약하고 결제 방법은 직접 안내해 주세요.',
  refund: '결제 내역을 확인하고 결제 서비스에서 직접 환불해 주세요.',
}
const scopes = {
  instagram: {
    publish: ['instagram_business_content_publish', 'instagram_content_publish'],
    reply: ['instagram_business_manage_comments', 'instagram_manage_comments'],
    message: ['instagram_business_manage_messages', 'instagram_manage_messages'],
  },
  threads: { publish: ['threads_content_publish'], reply: ['threads_manage_replies'], message: [] },
} as const

/** A display/readiness decision only: exact approval, consent and execution-time checks remain mandatory. */
export function evaluateCapability(input: CapabilityInput): CapabilityDecision {
  const env = input.env ?? process.env
  const fail = (reason: CapabilityDecision['reason']): CapabilityDecision => ({ ready: false, reason, manualAlternative: alternatives[input.action] })
  if (isCapabilityKilled(env)) return fail('KILL_SWITCH_ACTIVE')
  const now = (input.now ?? new Date()).getTime()
  if (!Number.isFinite(now)) return fail('PERMISSION_NOT_VERIFIED')
  if (input.action === 'payment' || input.action === 'refund') {
    const contract = input.contract
    const verified = Date.parse(contract?.verifiedAt ?? '')
    if (!contract || contract.workspaceId !== input.workspaceId || contract.provider !== input.provider || !Number.isFinite(verified) || verified > now) return fail('CONTRACT_NOT_VERIFIED')
    // PortOne integration is not contracted/implemented for live collection yet.
    return fail('UNSUPPORTED')
  }
  if (input.action === 'booking') {
    if (input.provider !== 'internal') return fail('UNSUPPORTED')
    if (!isRecoveryRolloutEnabled(input.workspaceId, true, env)) return fail('ROLLOUT_BLOCKED')
    if (!input.schemaVerified) return fail('SCHEMA_NOT_VERIFIED')
    return { ready: true, reason: 'READY', manualAlternative: alternatives.booking }
  }
  if (input.provider !== 'instagram' && input.provider !== 'threads') return fail('UNSUPPORTED')
  const allowed = input.action === 'publish'
    ? isWorkspaceInRollout(input.workspaceId, env.META_LIVE_WORKSPACE_ALLOWLIST, env.NODE_ENV)
    : isEngagementRolloutEnabled('ENGAGEMENT_SEND_ENABLED', input.workspaceId, env)
  if (!allowed) return fail('ROLLOUT_BLOCKED')
  const evidence = input.permission
  if (!evidence?.connected) return fail('NOT_CONNECTED')
  const verified = Date.parse(evidence.verifiedAt ?? '')
  const expiry = evidence.expiresAt == null ? null : Date.parse(evidence.expiresAt)
  if (evidence.workspaceId !== input.workspaceId || evidence.provider !== input.provider
    || !Number.isFinite(verified) || verified > now || now - verified > 24 * 60 * 60 * 1000
    || (expiry !== null && (!Number.isFinite(expiry) || expiry <= now))) return fail('PERMISSION_NOT_VERIFIED')
  const required = scopes[input.provider][input.action] as readonly string[]
  if (!required.some(scope => evidence.grantedScopes.includes(scope))) return fail('SCOPE_MISSING')
  return { ready: true, reason: 'READY', manualAlternative: alternatives[input.action] }
}

export function isEngagementRolloutEnabled(
  flag: 'ENGAGEMENT_CYCLE_ENABLED' | 'ENGAGEMENT_SEND_ENABLED' | 'ENGAGEMENT_DM_INGEST_ENABLED',
  workspaceId: string | null | undefined,
  env: CapabilityEnvironment = process.env,
): boolean {
  return env[flag] === '1'
    && isWorkspaceInRollout(workspaceId, env.ENGAGEMENT_WORKSPACE_ALLOWLIST, env.NODE_ENV)
    && (flag !== 'ENGAGEMENT_SEND_ENABLED' || (!isCapabilityKilled(env) && !on(env.ENGAGEMENT_KILL_SWITCH)))
}
