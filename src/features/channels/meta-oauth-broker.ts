import "server-only"

import crypto from "crypto"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type MetaOAuthStatePayload = {
  workspaceId: string
  userId: string
  nonce: string
  issuedAt: number
}

const META_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
]

export function generateMetaAuthorizationUrl({
  workspaceId,
  userId,
  redirectUri,
}: {
  workspaceId: string
  userId: string
  redirectUri?: string
}): { authUrl: string; state: string } {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || "dummy-meta-app-id"
  const baseRedirect = redirectUri || process.env.META_REDIRECT_URI || "https://example.com/api/channels/meta/callback"

  const nonce = crypto.randomBytes(16).toString("hex")
  const statePayload: MetaOAuthStatePayload = {
    workspaceId,
    userId,
    nonce,
    issuedAt: Date.now(),
  }

  const secret = process.env.ADMIN_REVIEW_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "meta-state-secret-key-32chars-min"
  const stateJson = JSON.stringify(statePayload)
  const signature = crypto.createHmac("sha256", secret).update(stateJson).digest("hex")
  const state = `${Buffer.from(stateJson).toString("base64url")}.${signature}`

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: baseRedirect,
    scope: META_OAUTH_SCOPES.join(","),
    response_type: "code",
    state,
  })

  return {
    authUrl: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`,
    state,
  }
}

export function verifyMetaOAuthState(stateString: string): MetaOAuthStatePayload | null {
  try {
    const [payloadB64, signature] = stateString.split(".")
    if (!payloadB64 || !signature) return null

    const secret = process.env.ADMIN_REVIEW_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "meta-state-secret-key-32chars-min"
    const stateJson = Buffer.from(payloadB64, "base64url").toString("utf-8")
    const expectedSig = crypto.createHmac("sha256", secret).update(stateJson).digest("hex")

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null
    }

    const payload = JSON.parse(stateJson) as MetaOAuthStatePayload
    if (Date.now() - payload.issuedAt > 15 * 60 * 1000) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export async function completeMetaOAuthExchange({
  code,
  statePayload,
  consentReceiptId,
}: {
  code: string
  statePayload: MetaOAuthStatePayload
  consentReceiptId?: string
}): Promise<{ success: boolean; authorizationId?: string; error?: string }> {
  try {
    const supabase = await createServerSupabaseClient()
    const client = supabase as any

    const { data: authRecord, error: authError } = await client
      .from("channel_authorizations")
      .insert({
        workspace_id: statePayload.workspaceId,
        provider: "META_INSTAGRAM",
        status: "CONNECTED",
        granted_scopes: META_OAUTH_SCOPES,
        authorized_at: new Date().toISOString(),
        last_validated_at: new Date().toISOString(),
        consent_receipt_id: consentReceiptId || null,
      })
      .select("id")
      .single()

    if (authError || !authRecord) {
      console.error("[MetaOAuthBroker] Failed to save authorization:", authError)
      return { success: false, error: "채널 인가 정보를 데이터베이스에 저장하지 못했습니다." }
    }

    const defaultCapabilities = [
      "INSTAGRAM_PUBLISH_FEED",
      "INSTAGRAM_PUBLISH_REEL",
      "INSTAGRAM_PUBLISH_STORY",
    ]

    const capInserts = defaultCapabilities.map((cap) => ({
      authorization_id: authRecord.id,
      capability_key: cap,
      status: "ENABLED",
      derived_from_scope: "instagram_content_publish",
      observed_at: new Date().toISOString(),
    }))

    await client.from("capability_grants").insert(capInserts)

    return {
      success: true,
      authorizationId: authRecord.id,
    }
  } catch (error) {
    console.error("[MetaOAuthBroker] Exchange error:", error)
    return { success: false, error: "토큰 교환 중 예기치 않은 오류가 발생했습니다." }
  }
}
