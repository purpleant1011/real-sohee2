/**
 * SOHEE V0.91 · M1 Dual Meta Verification (HF-08, HF-09, HF-10)
 * 
 * Rules:
 * 1. Connected ≠ VERIFIED (OAuth-only false positive forbidden).
 * 2. Scope completeness: required publishing & reading scopes must be verified.
 * 3. Freshness: Token must not be expired, otherwise READY_DEGRADED.
 * 4. Dual Channel Gate: Instagram + Threads BOTH required for overallChannelReady.
 * 5. Order Independence: Instagram or Threads can be connected in any sequence.
 */

export type ChannelVerificationStatus =
  | 'NOT_CONNECTED'
  | 'CONNECTED_UNVERIFIED'
  | 'SCOPE_INSUFFICIENT'
  | 'READY_DEGRADED'
  | 'VERIFIED'
  | 'BLOCKED'
  | 'UNKNOWN'

export interface CapabilityReceipt {
  profileReadSuccess: boolean
  publishQuotaVerified: boolean
  probedAt: string
}

export interface InstagramVerificationEvidence {
  accountId: string
  username: string
  accountType?: 'BUSINESS' | 'CREATOR' | 'PERSONAL'
  tokenExpiresAt: string
  scopes: string[]
  capabilityReceipt: CapabilityReceipt | null
}

export interface ThreadsVerificationEvidence {
  threadsUserId: string
  threadsUsername: string
  tokenExpiresAt: string
  scopes: string[]
  capabilityReceipt: CapabilityReceipt | null
}

export interface ChannelVerificationResult {
  status: ChannelVerificationStatus
  verified: boolean
  blockerMessage?: string
  evidence?: InstagramVerificationEvidence | ThreadsVerificationEvidence | null
  /**
   * [ANI-1776] 서버가 마지막으로 실제 점검한 시각(실측 검증 영수증 시각).
   * 점검 근거가 없는 상태에서는 null — 시각을 지어내지 않는다.
   */
  lastCheckedAt?: string | null
  degradedReason?: 'verification_stale'
}

export interface DualChannelReadinessResult {
  dualVerified: boolean
  instagramVerified: boolean
  threadsVerified: boolean
  blockers: string[]
}

export const META_CHANNEL_CAPABILITY_CONTRACT = {
  instagram: {
    channel: 'instagram' as const,
    requiredScopes: ['instagram_business_basic', 'instagram_business_content_publish'] as const,
    operationalScopes: [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
      'instagram_business_manage_insights',
    ] as const,
    minTokenValidityMs: 24 * 60 * 60 * 1000, // 24h minimum validity required
    maxVerificationAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days freshness window
  },
  threads: {
    channel: 'threads' as const,
    requiredScopes: ['threads_basic', 'threads_content_publish'] as const,
    operationalScopes: [
      'threads_basic',
      'threads_content_publish',
      'threads_read_replies',
      'threads_manage_replies',
      'threads_manage_insights',
    ] as const,
    minTokenValidityMs: 24 * 60 * 60 * 1000, // 24h minimum validity required
    maxVerificationAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days freshness window
  },
} as const

export const INSTAGRAM_REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish']
export const THREADS_REQUIRED_SCOPES = [...META_CHANNEL_CAPABILITY_CONTRACT.threads.requiredScopes]

/**
 * [HF-38] Canonical Instagram Scope Alias Normalization
 * Maps legacy scopes (e.g. instagram_basic) to business equivalents and vice-versa.
 */
export function normalizeInstagramScopes(scopes: readonly string[]): string[] {
  const set = new Set<string>()
  for (const s of scopes) {
    if (!s) continue
    const trimmed = s.trim()
    set.add(trimmed)
    if (trimmed === 'instagram_basic') {
      set.add('instagram_business_basic')
    } else if (trimmed === 'instagram_business_basic') {
      set.add('instagram_basic')
    } else if (trimmed === 'instagram_content_publish') {
      set.add('instagram_business_content_publish')
    } else if (trimmed === 'instagram_business_content_publish') {
      set.add('instagram_content_publish')
    } else if (trimmed === 'instagram_manage_comments') {
      set.add('instagram_business_manage_comments')
    } else if (trimmed === 'instagram_business_manage_comments') {
      set.add('instagram_manage_comments')
    } else if (trimmed === 'instagram_manage_messages') {
      set.add('instagram_business_manage_messages')
    } else if (trimmed === 'instagram_business_manage_messages') {
      set.add('instagram_manage_messages')
    } else if (trimmed === 'instagram_manage_insights') {
      set.add('instagram_business_manage_insights')
    } else if (trimmed === 'instagram_business_manage_insights') {
      set.add('instagram_manage_insights')
    }
  }
  return Array.from(set)
}

/**
 * [HF-38] Canonical Threads Scope Normalization
 */
export function normalizeThreadsScopes(scopes: readonly string[]): string[] {
  return Array.from(new Set(scopes.map((s) => s.trim()).filter(Boolean)))
}

/**
 * [HF-38] Canonical Channel Scope Normalization
 */
export function normalizeChannelScopes(
  channel: 'instagram' | 'threads',
  scopes: readonly string[]
): string[] {
  return channel === 'instagram'
    ? normalizeInstagramScopes(scopes)
    : normalizeThreadsScopes(scopes)
}

/**
 * HF-08: Instagram Provider Verification Evidence
 */
export function verifyInstagramEvidence(
  evidence: InstagramVerificationEvidence | null | undefined
): ChannelVerificationResult {
  if (!evidence || !evidence.accountId) {
    return {
      status: 'NOT_CONNECTED',
      verified: false,
      blockerMessage: '인스타그램 비즈니스 계정이 연동되지 않았습니다.',
      evidence: null,
    }
  }

  // 1. Token Freshness Check
  const expiresAtMs = new Date(evidence.tokenExpiresAt).getTime()
  if (isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return {
      status: 'READY_DEGRADED',
      verified: false,
      blockerMessage: '인스타그램 토큰 유효기간이 만료되었습니다. 재인증이 필요합니다.',
      evidence,
    }
  }

  // 2. Scope Verification Check (Canonical Alias Support via normalizeInstagramScopes)
  const normalizedScopes = normalizeInstagramScopes(evidence.scopes)
  const hasBasic = normalizedScopes.includes('instagram_business_basic')
  const hasPublish = normalizedScopes.includes('instagram_business_content_publish')
  const missingScopes: string[] = []
  if (!hasBasic) missingScopes.push('instagram_basic')
  if (!hasPublish) missingScopes.push('instagram_content_publish')

  if (missingScopes.length > 0) {
    return {
      status: 'SCOPE_INSUFFICIENT',
      verified: false,
      blockerMessage: `인스타그램 필수 발행 권한(${missingScopes.join(', ')})이 누락되었습니다. 권한을 추가해 주세요.`,
      evidence,
    }
  }

  // 3. Provider Capability Probing Receipt
  if (!evidence.capabilityReceipt || !evidence.capabilityReceipt.profileReadSuccess) {
    return {
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      blockerMessage: '인스타그램 계정이 연결되었으나, 게시 권한 및 프로필 실측 검증 영수증이 없습니다.',
      evidence,
    }
  }

  return {
    status: 'VERIFIED',
    verified: true,
    evidence,
    lastCheckedAt: evidence.capabilityReceipt.probedAt ?? null,
  }
}

/**
 * HF-09: Threads Provider Verification Evidence
 */
export function verifyThreadsEvidence(
  evidence: ThreadsVerificationEvidence | null | undefined
): ChannelVerificationResult {
  if (!evidence || !evidence.threadsUserId) {
    return {
      status: 'NOT_CONNECTED',
      verified: false,
      blockerMessage: '스레드 계정이 연동되지 않았습니다.',
      evidence: null,
    }
  }

  // 1. Token Freshness Check
  const expiresAtMs = new Date(evidence.tokenExpiresAt).getTime()
  if (isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return {
      status: 'READY_DEGRADED',
      verified: false,
      blockerMessage: '스레드 토큰 유효기간이 만료되었습니다. 재인증이 필요합니다.',
      evidence,
    }
  }

  // 2. Scope Verification Check
  const missingScopes = THREADS_REQUIRED_SCOPES.filter(
    (reqScope) => !evidence.scopes.includes(reqScope)
  )
  if (missingScopes.length > 0) {
    return {
      status: 'SCOPE_INSUFFICIENT',
      verified: false,
      blockerMessage: `스레드 필수 권한(${missingScopes.join(', ')})이 누락되었습니다. 권한을 추가해 주세요.`,
      evidence,
    }
  }

  // 3. Capability Probing Receipt
  if (!evidence.capabilityReceipt || !evidence.capabilityReceipt.profileReadSuccess) {
    return {
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      blockerMessage: '스레드 계정이 연결되었으나 실측 검증 영수증이 없습니다.',
      evidence,
    }
  }

  return {
    status: 'VERIFIED',
    verified: true,
    evidence,
    lastCheckedAt: evidence.capabilityReceipt.probedAt ?? null,
  }
}

/**
 * HF-10: Dual-Channel Onboarding Gate
 * Evaluates both Instagram & Threads readiness.
 */
export function evaluateDualChannelReadiness(inputs: {
  instagram: ChannelVerificationResult
  threads: ChannelVerificationResult
}): DualChannelReadinessResult {
  const igVerified = Boolean(inputs.instagram?.verified)
  const thVerified = Boolean(inputs.threads?.verified)
  const blockers: string[] = []

  if (!igVerified) {
    blockers.push(
      inputs.instagram?.blockerMessage || '인스타그램 비즈니스 계정 검증이 완료되지 않았습니다.'
    )
  }

  if (!thVerified) {
    blockers.push(
      inputs.threads?.blockerMessage || '스레드(Threads) 계정 검증이 완료되지 않았습니다.'
    )
  }

  return {
    dualVerified: igVerified && thVerified,
    instagramVerified: igVerified,
    threadsVerified: thVerified,
    blockers,
  }
}

export interface PersistedChannelVerificationOptions {
  /**
   * Optional custom admin client (e.g. for testing with mocks).
   * Note: In production, this always resolves to createAdminSupabaseClient() (service-role boundary).
   */
  adminClient?: any
}

const CREDENTIAL_READINESS_COLUMNS = 'id, provider, granted_scopes, token_expires_at, status, updated_at, channel_connections(id, external_account_id, account_label)'

function credentialSnapshot(credential: any): string {
  return JSON.stringify([
    credential.id, credential.updated_at, credential.status, credential.token_expires_at,
    [...(credential.granted_scopes || [])].sort(),
    credential.channel_connections?.id, credential.channel_connections?.external_account_id,
  ])
}

interface VerificationReceiptRow {
  id?: string
  verification_code?: string
  status?: string
  read_after_write_at?: string | null
  created_at?: string | null
}

/**
 * [ANI-1776] 최신 실측 검증 영수증 한 건을 읽는다.
 * 조회 예외는 던지지 않고 error 로 돌려준다 — 호출부가 준비도 판정 순서를 유지한 채 처리한다.
 */
async function readLatestVerificationReceipt(
  client: any,
  workspaceId: string,
  channel: 'instagram' | 'threads'
): Promise<{ run: VerificationReceiptRow | null; error: { message?: string } | null }> {
  try {
    const { data, error } = await client
      .from('channel_verification_runs')
      .select('id, status, verification_code, read_after_write_at, created_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .in('status', ['VERIFIED', 'success'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      run: (data as VerificationReceiptRow | null) ?? null,
      error: (error as { message?: string } | null) ?? null,
    }
  } catch (error) {
    return { run: null, error: error as { message?: string } }
  }
}

/**
 * [HF-10, P0-10, HF-38] Fetch and evaluate real persisted channel evidence from Supabase.
 * Enforces server-only credential read boundary (service_role) and fail-closed error handling.
 * Query/RLS errors return UNKNOWN / BLOCKED, never masked as NOT_CONNECTED.
 */
export async function getPersistedChannelVerification(
  workspaceId: string,
  channel: 'instagram' | 'threads',
  options?: PersistedChannelVerificationOptions
): Promise<ChannelVerificationResult> {
  // [HF-45] Strictly accept only options?.adminClient (for test mock injection).
  // NEVER accept raw client objects or fallback to caller user-session client.
  let client: any = options?.adminClient ?? null

  if (!client) {
    // meta_channel_credentials is service_role only in production DB.
    // ALWAYS use createAdminSupabaseClient at server boundary.
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    client = createAdminSupabaseClient()
  }

  const contract = META_CHANNEL_CAPABILITY_CONTRACT[channel]
  const now = Date.now()

  // 1. Query real persisted credential (meta_channel_credentials joined with channel_connections)
  // Raw access token, encrypted token, and IV are NEVER selected or leaked.
  const { data: cred, error: credErr } = await client
    .from('meta_channel_credentials')
    .select(CREDENTIAL_READINESS_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('provider', channel)
    .maybeSingle()

  // [HF-38] Fail-Closed: Query/DB/RLS errors MUST NOT be masked as NOT_CONNECTED!
  if (credErr) {
    console.error(`[getPersistedChannelVerification] Database query error for ${channel}:`, credErr)
    return {
      status: 'UNKNOWN',
      verified: false,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 연동 상태를 확인하는 중 데이터베이스 오류가 발생했습니다 (${credErr.message || 'QUERY_ERROR'}).`,
      evidence: null,
    }
  }

  if (!cred) {
    return {
      status: 'NOT_CONNECTED',
      verified: false,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 계정 연동 정보가 없습니다 (NOT_CONNECTED).`,
      evidence: null,
    }
  }

  // [ANI-1776] 마지막 점검 시각은 자격증명 준비도와 무관하게 실측 검증 영수증에서 읽는다.
  // 토큰 만료·권한 누락으로 READY_DEGRADED 가 되어도 "점검 기록 없음"으로 보이면 안 된다.
  // 영수증 조회 자체가 실패하면 시각은 null 로 두고, 오류 처리는 준비도 판정 뒤에서 한다.
  const { run, error: runErr } = await readLatestVerificationReceipt(client, workspaceId, channel)
  const receiptTime = run ? (run.read_after_write_at || run.created_at || null) : null

  // 2. Active status check
  if (cred.status !== 'active' && cred.status !== 'connected') {
    return {
      status: 'READY_DEGRADED',
      verified: false,
      lastCheckedAt: receiptTime,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 연동 상태가 비활성(${cred.status}) 상태입니다 (READY_DEGRADED).`,
      evidence: null,
    }
  }

  // 3. Token freshness check (token_expires_at > now() + 24h)
  const expiresAtMs = cred.token_expires_at ? new Date(cred.token_expires_at).getTime() : 0
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now + contract.minTokenValidityMs) {
    return {
      status: 'READY_DEGRADED',
      verified: false,
      lastCheckedAt: receiptTime,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 토큰 유효기간이 24시간 미만이거나 만료되었습니다 (READY_DEGRADED).`,
    }
  }

  // 4. Scope check with canonical normalization
  const rawGranted = Array.isArray(cred.granted_scopes) ? cred.granted_scopes : []
  const granted = normalizeChannelScopes(channel, rawGranted)
  const missing = (contract.requiredScopes as readonly string[]).filter((reqScope) => !granted.includes(reqScope))

  if (missing.length > 0) {
    return {
      status: 'SCOPE_INSUFFICIENT',
      verified: false,
      lastCheckedAt: receiptTime,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 필수 권한(${missing.join(', ')})이 누락되었습니다 (SCOPE_INSUFFICIENT).`,
    }
  }

  if (runErr) {
    console.error(`[getPersistedChannelVerification] Verification runs query error for ${channel}:`, runErr)
    return {
      status: 'UNKNOWN',
      verified: false,
      blockerMessage: `${channel === 'instagram' ? '인스타그램' : '스레드'} 실측 검증 내역 조회 중 데이터베이스 오류가 발생했습니다 (${runErr.message || 'QUERY_ERROR'}).`,
      evidence: null,
    }
  }

  const verifiedTime = receiptTime
  const verifiedAtMs = verifiedTime ? Date.parse(verifiedTime) : NaN
  const receiptExpired = !Number.isFinite(verifiedAtMs) || verifiedAtMs < now - contract.maxVerificationAgeMs
  const receiptAccountChanged = run?.verification_code?.startsWith('CAPABILITY_PROBE_')
    && run.verification_code !== `CAPABILITY_PROBE_${cred.channel_connections?.external_account_id}`

  if (!run || receiptExpired || receiptAccountChanged) {
    // Reconcile missing AND stale receipts only after credential, expiry and scope checks.
    // The provider probe reads the profile; it never refreshes tokens or publishes content.
    try {
      const { loadChannelCredentialByChannel } = await import('./credential-repository')
      const credential = await loadChannelCredentialByChannel(workspaceId, channel)
      if (credential?.accessToken
        && credential.externalAccountId === (cred as any).channel_connections?.external_account_id) {
        const probeRes = await verifyPostOAuthChannelCapability({
          workspaceId,
          channel,
          accessToken: credential.accessToken,
          providerAccountId: credential.externalAccountId,
          accountLabel: (cred as any).channel_connections?.account_label,
          expectedCredentialSnapshot: credentialSnapshot(cred),
          adminClient: client,
        })
        if (probeRes.verified) {
          const verifiedTime = probeRes.verifiedAt || new Date().toISOString()
          return {
            status: 'VERIFIED',
            verified: true,
            lastCheckedAt: verifiedTime,
            evidence: {
              accountId: probeRes.providerAccountId || credential.externalAccountId,
              username: probeRes.accountLabel || (cred as any).channel_connections?.account_label || '',
              tokenExpiresAt: cred.token_expires_at,
              scopes: rawGranted,
              capabilityReceipt: {
                profileReadSuccess: true,
                publishQuotaVerified: true,
                probedAt: verifiedTime,
              },
            } as any,
          }
        }
      }
    } catch (reconcileErr) {
      console.warn(`[getPersistedChannelVerification] On-demand probe reconciliation failed for ${channel}:`, reconcileErr)
    }

    return {
      status: run ? 'READY_DEGRADED' : 'CONNECTED_UNVERIFIED',
      ...(run ? { degradedReason: 'verification_stale' as const } : {}),
      verified: false,
      lastCheckedAt: verifiedTime,
      blockerMessage: run
        ? `${channel === 'instagram' ? '인스타그램' : '스레드'} 검증 유효기간(최근 7일)이 지나 최신 연결 상태를 다시 확인하지 못했습니다. 채널 연결 화면에서 다시 확인해 주세요.`
        : `${channel === 'instagram' ? '인스타그램' : '스레드'} 계정의 최신 연결 상태를 확인하지 못했습니다. 채널 연결 화면에서 다시 확인해 주세요.`,
      evidence: null,
    }
  }

  const connData = (cred as any).channel_connections
  return {
    status: 'VERIFIED',
    verified: true,
    lastCheckedAt: verifiedTime,
    evidence: {
      accountId: connData?.external_account_id || '',
      username: connData?.account_label || '',
      tokenExpiresAt: cred.token_expires_at,
      scopes: rawGranted,
      capabilityReceipt: {
        profileReadSuccess: true,
        publishQuotaVerified: true,
        probedAt: verifiedTime,
      },
    } as any,
  }
}

/**
 * [ANI-1429] Zero-leakage secret sanitization for verification runs & receipts
 */
function sanitizeSecretLeakage(input: unknown, tokenToRedact?: string): string {
  if (!input) return ''
  let text = typeof input === 'string' ? input : String(input)
  if (tokenToRedact && text.includes(tokenToRedact)) {
    text = text.replaceAll(tokenToRedact, '[REDACTED_TOKEN]')
  }
  text = text.replace(/EAAB[a-zA-Z0-9_-]+/g, '[REDACTED_TOKEN]')
  text = text.replace(/EAA[a-zA-Z0-9_-]+/g, '[REDACTED_TOKEN]')
  text = text.replace(/(access_token|client_secret|code|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
  text = text.replace(/"(access_token|client_secret|code|secret|password)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
  return text
}

async function defaultProviderProbe(params: {
  channel: 'instagram' | 'threads'
  accessToken: string
  providerAccountId: string
}): Promise<{ success: boolean; providerAccountId?: string; username?: string; error?: string }> {
  const { channel, accessToken, providerAccountId } = params
  const signal = AbortSignal.timeout(5_000)
  try {
    if (channel === 'instagram') {
      const fbTarget = providerAccountId && providerAccountId !== 'me' ? encodeURIComponent(providerAccountId) : 'me'
      const fbProbeUrl = `https://graph.facebook.com/v21.0/${fbTarget}?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
      
      const fbResponse = await fetch(fbProbeUrl, {
        method: 'GET',
        signal,
        headers: { Accept: 'application/json' },
      })

      if (fbResponse.ok) {
        const fbData = (await fbResponse.json()) as any
        if (!fbData?.error) {
          return {
            success: true,
            providerAccountId: fbData?.id,
            username: fbData?.username,
          }
        }
      }

      // Fallback: graph.instagram.com/v21.0/me for Instagram User Access Tokens
      const igProbeUrl = `https://graph.instagram.com/v21.0/me?fields=id,user_id,username&access_token=${encodeURIComponent(accessToken)}`
      const igResponse = await fetch(igProbeUrl, {
        method: 'GET',
        signal,
        headers: { Accept: 'application/json' },
      })

      if (igResponse.ok) {
        const igData = (await igResponse.json()) as any
        if (!igData?.error) {
          return {
            success: true,
            providerAccountId: String(igData?.user_id ?? igData?.id ?? ''),
            username: igData?.username,
          }
        }
      }

      const errBody = await fbResponse.text().catch(() => '')
      return {
        success: false,
        error: `Provider probe failed with HTTP ${fbResponse.status}: ${sanitizeSecretLeakage(errBody, accessToken)}`,
      }
    } else {
      const probeUrl = `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
      const response = await fetch(probeUrl, {
        method: 'GET',
        signal,
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        return {
          success: false,
          error: `Provider probe failed with HTTP ${response.status}: ${sanitizeSecretLeakage(errBody, accessToken)}`,
        }
      }

      const data = (await response.json()) as any
      if (data?.error) {
        return {
          success: false,
          error: sanitizeSecretLeakage(data.error.message || 'Meta API error', accessToken),
        }
      }

      return {
        success: true,
        providerAccountId: data?.id,
        username: data?.username,
      }
    }
  } catch (err: any) {
    return {
      success: false,
      error: sanitizeSecretLeakage(err?.message || 'Network/Fetch error during probe', accessToken),
    }
  }
}

export interface VerifyPostOAuthChannelCapabilityInput {
  workspaceId: string
  channel: 'instagram' | 'threads'
  accessToken: string
  providerAccountId: string
  accountLabel?: string
  /** Reconciliation must still target the credential observed before the provider GET. */
  expectedCredentialSnapshot?: string
  adminClient?: any
  probeFn?: (params: {
    channel: 'instagram' | 'threads'
    accessToken: string
    providerAccountId: string
  }) => Promise<{
    success: boolean
    providerAccountId?: string
    username?: string
    error?: string
  }>
}

export interface VerifyPostOAuthChannelCapabilityResult {
  verified: boolean
  status: ChannelVerificationStatus
  blockerMessage?: string
  providerAccountId?: string
  accountLabel?: string
  verifiedAt?: string
}

/**
 * [ANI-1429] Genuine Post-OAuth Provider Capability Probing & Verification Receipts
 * Fails closed as CONNECTED_UNVERIFIED if probing fails.
 * Guarantees zero secret leakage into runs or returned metadata.
 */
export async function verifyPostOAuthChannelCapability(
  input: VerifyPostOAuthChannelCapabilityInput
): Promise<VerifyPostOAuthChannelCapabilityResult> {
  const now = new Date().toISOString()
  let client = input.adminClient

  if (!client) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    client = createAdminSupabaseClient()
  }

  const probe = input.probeFn || defaultProviderProbe

  let probeResult: { success: boolean; providerAccountId?: string; username?: string; error?: string }
  try {
    probeResult = await probe({
      channel: input.channel,
      accessToken: input.accessToken,
      providerAccountId: input.providerAccountId,
    })
  } catch (err: any) {
    probeResult = {
      success: false,
      error: err?.message || 'PROBE_EXCEPTION',
    }
  }

  // A successful HTTP response is not evidence for another (or an unidentified) account.
  const accountMatches = typeof probeResult.providerAccountId === 'string'
    && probeResult.providerAccountId.length > 0
    && (input.providerAccountId === 'me' || probeResult.providerAccountId === input.providerAccountId)
  if (probeResult.success && !accountMatches) {
    probeResult = { success: false, error: 'PROVIDER_ACCOUNT_MISMATCH' }
  }
  const isVerified = Boolean(probeResult.success)
  const errorMessage = probeResult.error
    ? sanitizeSecretLeakage(probeResult.error, input.accessToken)
    : undefined

  const sanitizedProviderAccountId = sanitizeSecretLeakage(
    probeResult.providerAccountId || input.providerAccountId,
    input.accessToken
  )
  const sanitizedAccountLabel = sanitizeSecretLeakage(
    probeResult.username || input.accountLabel || input.providerAccountId,
    input.accessToken
  )

  if (input.expectedCredentialSnapshot) {
    try {
      const { data: current, error } = await client.from('meta_channel_credentials')
        .select(CREDENTIAL_READINESS_COLUMNS)
        .eq('workspace_id', input.workspaceId).eq('provider', input.channel).maybeSingle()
      if (error || !current || credentialSnapshot(current) !== input.expectedCredentialSnapshot) {
        return { verified: false, status: 'CONNECTED_UNVERIFIED', blockerMessage: '채널 연결 정보가 변경되어 다시 확인이 필요합니다.' }
      }
    } catch {
      return { verified: false, status: 'CONNECTED_UNVERIFIED', blockerMessage: '채널 연결 상태를 다시 확인하지 못했습니다.' }
    }
  }

  // 1. Record canonical verification run in channel_verification_runs
  // Canonical schema: workspace_id, channel, verification_code (NOT NULL), status, read_after_write_at, error_message, created_at
  const runPayload: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    channel: input.channel,
    verification_code: `CAPABILITY_PROBE_${sanitizedProviderAccountId}`,
    status: isVerified ? 'VERIFIED' : 'FAILED',
    read_after_write_at: isVerified ? now : null,
    error_message: isVerified ? null : (errorMessage || 'CAPABILITY_PROBE_FAILED'),
    created_at: now,
  }

  let runPersisted = false
  let runErrorMsg = ''
  try {
    let insertQuery: any = client.from('channel_verification_runs').insert(runPayload)
    if (typeof insertQuery?.select === 'function') {
      insertQuery = insertQuery.select()
      if (typeof insertQuery?.single === 'function') {
        insertQuery = insertQuery.single()
      }
    }
    const runRes = await insertQuery
    if (runRes && typeof runRes === 'object' && 'error' in runRes && runRes.error) {
      runErrorMsg = (runRes.error as any).message || 'DB_INSERT_ERROR'
      console.error('[verifyPostOAuthChannelCapability] Run insert DB error:', runRes.error)
    } else {
      runPersisted = true
    }
  } catch (runErr: any) {
    runErrorMsg = runErr?.message || 'DB_INSERT_EXCEPTION'
    console.error('[verifyPostOAuthChannelCapability] Run insert exception:', runErr)
  }

  // Critical truth rule: Fail closed to CONNECTED_UNVERIFIED on verification run persistence failure
  if (!runPersisted) {
    return {
      verified: false,
      status: 'CONNECTED_UNVERIFIED',
      blockerMessage: `실측 검증 영수증(channel_verification_runs) 저장에 실패하여 검증을 완료할 수 없습니다 (${sanitizeSecretLeakage(runErrorMsg, input.accessToken)}).`,
    }
  }

  // 2. Update canonical state in channel_connections
  let connUpdated = false
  let connErrorMsg = ''
  try {
    const updatePayload: Record<string, unknown> = { updated_at: now, ...(isVerified ? { status: 'connected' } : {}) }
    // Verification receipts own proof; connection IDs/labels remain those saved by OAuth.

    const connBuilder = client
      .from('channel_connections')
      .update(updatePayload)

    const eqResult: any = connBuilder.eq('workspace_id', input.workspaceId)
    const scopedQuery = typeof eqResult?.eq === 'function'
      ? eqResult.eq('channel', input.channel)
      : eqResult
    // A connection replaced after the snapshot read must not be marked verified for the old account.
    const connRes = input.expectedCredentialSnapshot
      ? await scopedQuery.eq('external_account_id', input.providerAccountId).select('id').maybeSingle()
      : await scopedQuery

    if (input.expectedCredentialSnapshot && !connRes?.data && !connRes?.error) {
      connErrorMsg = 'CHANNEL_CONNECTION_CHANGED'
    } else if (connRes && typeof connRes === 'object' && 'error' in connRes && connRes.error) {
      connErrorMsg = (connRes.error as any).message || 'DB_UPDATE_ERROR'
      console.error('[verifyPostOAuthChannelCapability] Connection update DB error:', connRes.error)
    } else {
      connUpdated = true
    }
  } catch (connErr: any) {
    connErrorMsg = connErr?.message || 'DB_UPDATE_EXCEPTION'
    console.error('[verifyPostOAuthChannelCapability] Connection update exception:', connErr)
  }

  // Critical truth rule: Fail closed to CONNECTED_UNVERIFIED on connection state update failure
  if (!connUpdated) {
    return {
      verified: false,
      status: 'CONNECTED_UNVERIFIED',
      blockerMessage: `채널 상태(channel_connections) 갱신에 실패하여 검증을 완료할 수 없습니다 (${sanitizeSecretLeakage(connErrorMsg, input.accessToken)}).`,
    }
  }

  if (isVerified) {
    // The receipt and connection state are durable before re-evaluation; never block OAuth on vault errors.
    try {
      const [{ reevaluateReleaseGates }, { SupabaseVaultSaveRepository }] = await Promise.all([
        import('@/features/vault/service/save'),
        import('@/features/vault/model/supabase-save-repository'),
      ])
      await reevaluateReleaseGates(input.workspaceId, { repository: new SupabaseVaultSaveRepository(client) })
    } catch (error) {
      console.error('[verifyPostOAuthChannelCapability] Vault gate re-evaluation failed:', error)
    }
    return {
      verified: true,
      status: 'VERIFIED',
      providerAccountId: sanitizedProviderAccountId,
      accountLabel: sanitizedAccountLabel,
      verifiedAt: now,
    }
  }

  return {
    verified: false,
    status: 'CONNECTED_UNVERIFIED',
    blockerMessage:
      errorMessage ||
      `${input.channel === 'instagram' ? '인스타그램' : '스레드'} 계정 연결 후 실측 검증에 실패했습니다 (CONNECTED_UNVERIFIED).`,
  }
}

/**
 * [HF-38] Canonical Channel Truth Reader Facade
 */
export const ChannelTruthReader = {
  getVerification: getPersistedChannelVerification,
  evaluateReadiness: evaluateDualChannelReadiness,
  normalizeScopes: normalizeChannelScopes,
  normalizeInstagramScopes,
  normalizeThreadsScopes,
  verifyPostOAuthCapability: verifyPostOAuthChannelCapability,
  contract: META_CHANNEL_CAPABILITY_CONTRACT,
}

