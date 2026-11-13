export type MembershipTier = 'TRIAL' | 'PENDING_REVIEW' | 'FORMAL' | 'REJECTED'

export const TRIAL_FIRST_POST_LIMIT = 2

export const FORMAL_MEMBERSHIP_NOTICE = '정식 회원 전용 기능이에요. 사업자 인증이 승인되면 바로 쓸 수 있어요.'

export class FormalMembershipRequiredError extends Error {
  public readonly code = 'FORMAL_MEMBERSHIP_REQUIRED'
  public readonly statusCode = 403
  public readonly status = 403

  constructor(message = FORMAL_MEMBERSHIP_NOTICE) {
    super(message)
    this.name = 'FormalMembershipRequiredError'
  }
}

export function isFormalMember(tier: MembershipTier | string | null | undefined): boolean {
  return tier === 'FORMAL'
}

const VALID_TIERS: ReadonlySet<MembershipTier> = new Set<MembershipTier>([
  'TRIAL',
  'PENDING_REVIEW',
  'FORMAL',
  'REJECTED',
])

export async function getMembershipTier(
  supabase: any,
  workspaceId: string,
): Promise<MembershipTier> {
  if (!supabase || !workspaceId) {
    return 'TRIAL'
  }

  let baseTier: MembershipTier = 'TRIAL'

  try {
    if (typeof supabase.rpc === 'function') {
      const { data, error } = await supabase.rpc('get_workspace_membership_tier', {
        p_workspace_id: workspaceId,
      })

      if (!error && typeof data === 'string') {
        const normalized = data.trim().toUpperCase() as MembershipTier
        if (VALID_TIERS.has(normalized)) {
          baseTier = normalized
        }
      }
    }
  } catch (err) {
    console.warn('[membership-tier] RPC check failed, falling back to base TRIAL:', err)
  }

  // 사업자 인증이 이미 승인(VERIFIED)된 상태면 정회원
  if (baseTier === 'FORMAL') {
    return 'FORMAL'
  }

  // 확장 정회원 판정:
  // 정회원(FORMAL) = 사업자 인증 승인(VERIFIED) OR Instagram/Threads 실제 연결 OR 결제한 곳.
  // SNS가 연결되었거나 유료 결제/플랜이 있는 워크스페이스는 체험 한도 대상이 아님.
  if (typeof supabase.from === 'function') {
    try {
      const [channelsRes, creditRes] = await Promise.all([
        supabase
          .from('channel_connections')
          .select('channel, status, account_label')
          .eq('workspace_id', workspaceId)
          .in('channel', ['instagram', 'threads']),
        supabase
          .from('workspace_credit_states')
          .select('purchased_credits, commercial_state')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      ])

      const hasConnectedChannel = (Array.isArray(channelsRes?.data) ? channelsRes.data : []).some((c: any) =>
        ['connected', 'verified'].includes(c?.status) && Boolean(c?.account_label)
      )

      const purchasedCredits = Number(creditRes?.data?.purchased_credits ?? 0)
      const hasPaidCredits = Number.isFinite(purchasedCredits) && purchasedCredits > 0
      const hasActiveCommercial = creditRes?.data?.commercial_state === 'ACTIVE'

      if (hasConnectedChannel || hasPaidCredits || hasActiveCommercial) {
        return 'FORMAL'
      }
    } catch (err) {
      console.warn('[membership-tier] Extended formal check failed:', err)
    }
  }

  return baseTier
}
