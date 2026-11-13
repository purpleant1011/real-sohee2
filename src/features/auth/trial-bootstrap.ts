import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type TrialEntitlement = {
  workspaceId: string
  planKey: "TRIAL_V1"
  startsAt: string
  endsAt: string
  status: "ACTIVE" | "EXPIRED" | "CONVERTED" | "REVOKED"
  initialCreditGrant: 40000
}

export type BootstrapResult = {
  success: boolean
  workspaceId?: string
  isNewTrial: boolean
  error?: string
}

/**
 * 신규 회원가입 시 14일 무료체험과 40,000 P(크레딧)을 1회 정확하게 지급하는 멱등적(Idempotent) 원자적 부트스트랩
 * [ANI-596] Production RPC (bootstrap_workspace_trial) 전용 호출 & Fail-Closed 보장 (Sequential Fallback 전면 삭제)
 */
export async function bootstrapWorkspaceTrial(
  supabase: SupabaseClient,
  userId: string,
  provider: string = "google",
): Promise<BootstrapResult> {
  try {
    // 1. service_role 권한을 가진 admin client 우선 사용 (함수 권한이 service_role에만 한정되므로)
    let clientToUse = supabase
    try {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        clientToUse = createAdminSupabaseClient() as unknown as SupabaseClient
      }
    } catch {
      // Fall back to provided client
      clientToUse = supabase
    }

    // 2. 단일 원자적 RPC 호출
    const { data: rpcData, error: rpcError } = await clientToUse.rpc("bootstrap_workspace_trial", {
      p_user_id: userId,
      p_provider: provider,
      p_workspace_name: "나의 소희 마케팅",
    })

    if (rpcError) {
      console.error("[trial-bootstrap] Critical: RPC bootstrap_workspace_trial failed:", rpcError)
      return {
        success: false,
        isNewTrial: false,
        error: `트라이얼 원자적 부트스트랩 실패 (Fail-Closed): ${rpcError.message}`,
      }
    }

    if (rpcData && typeof rpcData === "object") {
      const res = rpcData as { success?: boolean; workspace_id?: string; is_new_trial?: boolean; message?: string }
      if (res.success === false) {
        return {
          success: false,
          isNewTrial: false,
          error: res.message || "트라이얼 활성화 조건 미충족 (Fail-Closed)",
        }
      }
      return {
        success: true,
        workspaceId: res.workspace_id,
        isNewTrial: res.is_new_trial ?? true,
      }
    }

    return {
      success: false,
      isNewTrial: false,
      error: "트라이얼 부트스트랩 응답이 유효하지 않습니다 (Fail-Closed).",
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 부트스트랩 예외"
    console.error("[trial-bootstrap] Fail-Closed caught exception:", message)
    return {
      success: false,
      isNewTrial: false,
      error: message,
    }
  }
}
