import "server-only"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ChannelProvider = "META_INSTAGRAM" | "META_THREADS" | "NAVER_BROWSER" | "DANGGEUN_BROWSER"

export type CapabilityKey =
  | "INSTAGRAM_PUBLISH_FEED"
  | "INSTAGRAM_PUBLISH_REEL"
  | "INSTAGRAM_PUBLISH_STORY"
  | "THREADS_PUBLISH_POST"
  | "NAVER_BLOG_POST"
  | "NAVER_PLACE_REPLY"
  | "DANGGEUN_STORY_POST"
  | "DANGGEUN_CHAT_REPLY"

export type PreflightDecision =
  | { allowed: true; authorizationId: string; consentReceiptId: string; expiresAt: string | null }
  | { allowed: false; reasonCode: "NO_CONSENT" | "CHANNEL_NOT_CONNECTED" | "AUTH_EXPIRED" | "CAPABILITY_DISABLED" | "UNKNOWN_ERROR"; message: string }

export async function preflightActionExecution({
  workspaceId,
  provider,
  capabilityKey,
}: {
  workspaceId: string
  provider: ChannelProvider
  capabilityKey: CapabilityKey
}): Promise<PreflightDecision> {
  try {
    const supabase = await createServerSupabaseClient()
    const client = supabase as any

    // 1. Layer 1: 활성 동의(ConsentReceipt) 확인
    const { data: consent, error: consentError } = await client
      .from("consent_receipts")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (consentError || !consent) {
      return {
        allowed: false,
        reasonCode: "NO_CONSENT",
        message: "고객사의 서비스 위임 및 이용 약관 동의(ConsentReceipt)가 존재하지 않거나 철회되었습니다.",
      }
    }

    // 2. Layer 2: 채널 인가(ChannelAuthorization) 확인
    const { data: auth, error: authError } = await client
      .from("channel_authorizations")
      .select("id, status, expires_at, consent_receipt_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      .eq("status", "CONNECTED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (authError || !auth) {
      return {
        allowed: false,
        reasonCode: "CHANNEL_NOT_CONNECTED",
        message: `해당 채널(${provider})이 연결되지 않았거나 인가가 해제되었습니다.`,
      }
    }

    if (auth.expires_at && new Date(auth.expires_at).getTime() <= Date.now()) {
      return {
        allowed: false,
        reasonCode: "AUTH_EXPIRED",
        message: `해당 채널(${provider})의 인가 유효기간이 만료되었습니다. 재인증이 필요합니다.`,
      }
    }

    // 3. Layer 4: 개별 CapabilityGrant 확인
    const { data: capability, error: capError } = await client
      .from("capability_grants")
      .select("id, status, expires_at")
      .eq("authorization_id", auth.id)
      .eq("capability_key", capabilityKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (capError || !capability || capability.status !== "ENABLED") {
      return {
        allowed: false,
        reasonCode: "CAPABILITY_DISABLED",
        message: `해당 액션(${capabilityKey})에 대한 실행 권한이 비활성화(DISABLED)되어 있습니다.`,
      }
    }

    if (capability.expires_at && new Date(capability.expires_at).getTime() <= Date.now()) {
      return {
        allowed: false,
        reasonCode: "CAPABILITY_DISABLED",
        message: `해당 액션(${capabilityKey}) 권한의 유효기간이 만료되었습니다.`,
      }
    }

    return {
      allowed: true,
      authorizationId: auth.id,
      consentReceiptId: consent.id,
      expiresAt: auth.expires_at,
    }
  } catch (error) {
    console.error("[PreflightGuard] Unexpected error:", error)
    return {
      allowed: false,
      reasonCode: "UNKNOWN_ERROR",
      message: "권한 사전 검증 중 예기치 않은 오류가 발생했습니다.",
    }
  }
}
