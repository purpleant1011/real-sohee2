import 'server-only'

export type ConsentTier = 'PLATFORM_AUTH' | 'VERIFICATION_CONSENT' | 'AUTONOMOUS_DELEGATION'
export type ConsentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED'

export interface RecordConsentInput {
  workspaceId: string
  actorUserId: string
  channel: string
  tier: ConsentTier
  capabilities: Record<string, boolean>
  policyVersion?: string
}

type DatabaseClient = {
  from(table: string): any
}

async function productionAdminClient(): Promise<DatabaseClient> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as DatabaseClient
}

function calculateConsentFingerprint(input: RecordConsentInput, grantedAt: string): string {
  const content = `${input.workspaceId}:${input.channel}:${input.tier}:${JSON.stringify(input.capabilities)}:${grantedAt}`
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(64, '0')
}

export async function recordChannelConsent(
  input: RecordConsentInput,
  providedClient?: DatabaseClient
): Promise<{ success: boolean; id?: string }> {
  const client = providedClient ?? (await productionAdminClient())
  const grantedAt = new Date().toISOString()
  const signature = calculateConsentFingerprint(input, grantedAt)

  try {
    const { data, error } = await client.from('channel_consents').insert({
      workspace_id: input.workspaceId,
      channel: input.channel.toLowerCase(),
      consent_tier: input.tier,
      status: 'ACTIVE',
      capabilities: input.capabilities,
      policy_version: input.policyVersion || 'v1.1',
      actor_user_id: input.actorUserId,
      granted_at: grantedAt,
      signature_sha256: signature,
      updated_at: grantedAt,
    })

    if (error) {
      console.warn('[recordChannelConsent] Table insert warning:', error.message)
      return { success: false }
    }
    return { success: true, id: data?.[0]?.id }
  } catch {
    return { success: false }
  }
}

export async function getChannelConsents(
  workspaceId: string,
  channel: string,
  providedClient?: DatabaseClient
): Promise<Record<ConsentTier, { status: ConsentStatus; capabilities: Record<string, boolean> } | null>> {
  const client = providedClient ?? (await productionAdminClient())
  const result: Record<ConsentTier, { status: ConsentStatus; capabilities: Record<string, boolean> } | null> = {
    PLATFORM_AUTH: null,
    VERIFICATION_CONSENT: null,
    AUTONOMOUS_DELEGATION: null,
  }

  try {
    const { data } = await client
      .from('channel_consents')
      .select('consent_tier, status, capabilities')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel.toLowerCase())

    if (data && Array.isArray(data)) {
      for (const row of data) {
        if (row.consent_tier in result) {
          result[row.consent_tier as ConsentTier] = {
            status: row.status as ConsentStatus,
            capabilities: (row.capabilities as Record<string, boolean>) || {},
          }
        }
      }
    }
  } catch (err) {
    console.warn('[getChannelConsents] error:', err)
  }

  return result
}

export async function revokeChannelConsent(
  workspaceId: string,
  actorUserId: string,
  channel: string,
  tier: ConsentTier,
  reason = 'User requested revocation',
  providedClient?: DatabaseClient
): Promise<{ success: boolean }> {
  const client = providedClient ?? (await productionAdminClient())
  const revokedAt = new Date().toISOString()

  try {
    const { error } = await client
      .from('channel_consents')
      .update({
        status: 'REVOKED',
        revoked_at: revokedAt,
        revoked_by: actorUserId,
        revocation_reason: reason,
        updated_at: revokedAt,
      })
      .eq('workspace_id', workspaceId)
      .eq('channel', channel.toLowerCase())
      .eq('consent_tier', tier)

    return { success: !error }
  } catch {
    return { success: false }
  }
}

export async function isActionConsented(
  workspaceId: string,
  channel: string,
  action: 'VERIFICATION_POST' | 'PUBLISH_FEED' | 'REPLY_COMMENT' | 'REPLY_DM' | 'BROWSER_AUTOMATION',
  providedClient?: DatabaseClient
): Promise<boolean> {
  const client = providedClient ?? (await productionAdminClient())

  if (action === 'VERIFICATION_POST') {
    const { data } = await client
      .from('channel_consents')
      .select('status, capabilities')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel.toLowerCase())
      .eq('consent_tier', 'VERIFICATION_CONSENT')
      .maybeSingle()

    return data?.status === 'ACTIVE' && data?.capabilities?.verification_post_allowed === true
  }

  const { data } = await client
    .from('channel_consents')
    .select('status, capabilities')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel.toLowerCase())
    .eq('consent_tier', 'AUTONOMOUS_DELEGATION')
    .maybeSingle()

  if (!data || data.status !== 'ACTIVE' || !data.capabilities) {
    return false
  }

  switch (action) {
    case 'PUBLISH_FEED':
      return !!data.capabilities.publish
    case 'REPLY_COMMENT':
      return !!data.capabilities.comments_reply
    case 'REPLY_DM':
      return !!data.capabilities.dm_reply
    case 'BROWSER_AUTOMATION':
      return !!data.capabilities.browser_automation
    default:
      return false
  }
}

export interface VerifyCapabilityConsentResult {
  consented: boolean
  status?: ConsentStatus | null
  failureCode?: string
  reason?: string
}

export async function verifyCapabilityConsent(
  workspaceId: string,
  channel: string,
  capabilityScope: string,
  providedClient?: DatabaseClient,
): Promise<VerifyCapabilityConsentResult> {
  const client = providedClient ?? (await productionAdminClient())

  try {
    const { data, error } = await client
      .from('channel_consents')
      .select('status, capabilities')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel.toLowerCase())
      .eq('consent_tier', 'AUTONOMOUS_DELEGATION')
      .maybeSingle()

    if (error) {
      return {
        consented: false,
        failureCode: 'DATABASE_ERROR',
        reason: `동의 원장 조회 실패: ${error.message}`,
      }
    }

    if (!data) {
      return {
        consented: false,
        status: null,
        failureCode: 'CONSENT_RECORD_NOT_FOUND',
        reason: '활성화된 채널 위임 동의(Consent)가 존재하지 않습니다.',
      }
    }

    if (data.status === 'REVOKED') {
      return {
        consented: false,
        status: 'REVOKED',
        failureCode: 'CONSENT_REVOKED',
        reason: '채널 위임 동의가 사용자에 의해 철회(REVOKED)되었습니다.',
      }
    }

    if (data.status !== 'ACTIVE') {
      return {
        consented: false,
        status: data.status as ConsentStatus,
        failureCode: 'CONSENT_INACTIVE',
        reason: `동의 상태가 활성(ACTIVE) 상태가 아닙니다 (현재: ${data.status}).`,
      }
    }

    const caps = (data.capabilities as Record<string, boolean>) || {}
    const isAllowed =
      caps[capabilityScope] === true ||
      (capabilityScope === 'reply_comments' && caps.comments_reply === true) ||
      (capabilityScope === 'reply_dm' && caps.dm_reply === true) ||
      (capabilityScope === 'read_comments' && caps.comments_read === true)

    if (!isAllowed) {
      return {
        consented: false,
        status: 'ACTIVE',
        failureCode: 'CAPABILITY_NOT_CONSENTED',
        reason: `해당 기능(${capabilityScope})에 대한 위임 동의가 부여되지 않았습니다.`,
      }
    }

    return {
      consented: true,
      status: 'ACTIVE',
    }
  } catch (err: any) {
    return {
      consented: false,
      failureCode: 'SYSTEM_ERROR',
      reason: err?.message || '동의 검증 중 시스템 오류가 발생했습니다.',
    }
  }
}

