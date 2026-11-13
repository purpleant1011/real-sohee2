import "server-only"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export type BrowserConnectorTier = "TIER_A_USER_OWNED" | "TIER_B_CLOUD_ISOLATED"

export type BrowserSessionStatus = "HEALTHY" | "REAUTH_REQUIRED" | "EXPIRED" | "DEGRADED"

export interface BrowserSessionRecord {
  id: string
  workspaceId: string
  provider: "NAVER_BROWSER" | "DANGGEUN_BROWSER"
  tier: BrowserConnectorTier
  accountLabel: string
  status: BrowserSessionStatus
  lastHeartbeatAt: string
  expiresAt: string | null
}

export async function registerBrowserSession({
  workspaceId,
  provider,
  tier,
  accountLabel,
  consentReceiptId,
}: {
  workspaceId: string
  provider: "NAVER_BROWSER" | "DANGGEUN_BROWSER"
  tier: BrowserConnectorTier
  accountLabel: string
  consentReceiptId?: string
}): Promise<{ success: boolean; authorizationId?: string; error?: string }> {
  try {
    const supabase = await createServerSupabaseClient()
    const client = supabase as any

    const { data: authRecord, error: authError } = await client
      .from("channel_authorizations")
      .insert({
        workspace_id: workspaceId,
        provider,
        account_label: accountLabel,
        account_type: tier,
        status: "CONNECTED",
        granted_scopes: [provider.toLowerCase()],
        authorized_at: new Date().toISOString(),
        last_validated_at: new Date().toISOString(),
        consent_receipt_id: consentReceiptId || null,
      })
      .select("id")
      .single()

    if (authError || !authRecord) {
      console.error("[BrowserSessionManager] Failed to register session:", authError)
      return { success: false, error: "브라우저 세션 인가 정보를 저장하지 못했습니다." }
    }

    const defaultCapabilities =
      provider === "NAVER_BROWSER"
        ? ["NAVER_BLOG_POST", "NAVER_PLACE_REPLY"]
        : ["DANGGEUN_STORY_POST", "DANGGEUN_CHAT_REPLY"]

    const capInserts = defaultCapabilities.map((cap) => ({
      authorization_id: authRecord.id,
      capability_key: cap,
      status: "ENABLED",
      derived_from_scope: tier,
      observed_at: new Date().toISOString(),
    }))

    await client.from("capability_grants").insert(capInserts)

    return {
      success: true,
      authorizationId: authRecord.id,
    }
  } catch (error) {
    console.error("[BrowserSessionManager] Register error:", error)
    return { success: false, error: "세션 등록 중 오류가 발생했습니다." }
  }
}

export async function heartbeatBrowserSession({
  authorizationId,
  status = "CONNECTED",
}: {
  authorizationId: string
  status?: "CONNECTED" | "REAUTH_REQUIRED" | "DEGRADED"
}): Promise<{ success: boolean }> {
  try {
    const supabase = await createServerSupabaseClient()
    const client = supabase as any

    const { error } = await client
      .from("channel_authorizations")
      .update({
        status,
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", authorizationId)

    return { success: !error }
  } catch {
    return { success: false }
  }
}
