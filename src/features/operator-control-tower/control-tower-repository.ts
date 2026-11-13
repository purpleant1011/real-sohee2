import "server-only"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { CanonicalInvariantMonitor } from "@/features/canonical-monitor/canonical-invariant-monitor"

/** 정합성 점검 전용 읽기 모델(운영 홈 화면과는 별개). */
export interface ControlTowerData {
  active_workspaces: number
  running_missions: number
  pending_verifications: number
  total_settled_sc: number
  total_cogs_usd: number
  risk_rail: Array<{ id: string; severity: "P0" | "P1" | "P2"; title: string; count: number; age: string; action: string; domain: string; desc: string }>
  live_queue: Array<{ id: string; workspace_name: string; action_type: string; status: string; risk_tier: string; started_at: string; progress: number; model: string; operator_action: string }>
}

export async function getControlTowerReadModel(): Promise<ControlTowerData> {
  try {
    const supabase = await createServerSupabaseClient()

    // 1. 활성 고객사 수
    const { count: workspaceCount, error: wsError } = await supabase
      .from("workspaces")
      .select("*", { count: "exact", head: true })

    // 2. 크레딧 정산 총액 (credit_ledger_entries)
    const { data: ledgerEntries, error: ledgerError } = await supabase
      .from("credit_ledger_entries")
      .select("amount, kind")
      .limit(100)

    let totalSettledSc = 0
    if (ledgerEntries && !ledgerError) {
      totalSettledSc = ledgerEntries.reduce((acc, row) => acc + Math.abs(row.amount || 0), 0)
    }

    // 3. AI Usage 원가 합산 (ai_usage_events)
    let totalCogsUsd = 0
    try {
      const { data: usageEvents } = await supabase
        .from("ai_usage_events")
        .select("computed_credits")
        .limit(100)

      if (usageEvents) {
        const totalCredits = usageEvents.reduce((acc: number, row: any) => acc + Number(row.computed_credits || 0), 0)
        totalCogsUsd = totalCredits / 1000
      }
    } catch {
      // fallback
    }

    // 4. Canonical Invariant Monitor (ANI-1031: Zero False-Green Risk Rail)
    const invariantResult = await CanonicalInvariantMonitor.evaluateAll()
    const riskRail: ControlTowerData["risk_rail"] = invariantResult.violations.map(v => ({
      id: v.id,
      severity: v.severity,
      title: v.title,
      count: v.count,
      age: v.age,
      action: v.action,
      domain: v.domain,
      desc: v.desc,
    }))

    const liveQueue: ControlTowerData["live_queue"] = []

    return {
      active_workspaces: workspaceCount || 0,
      running_missions: 0,
      pending_verifications: 0,
      total_settled_sc: totalSettledSc,
      total_cogs_usd: Number(totalCogsUsd.toFixed(2)),
      risk_rail: riskRail,
      live_queue: liveQueue,
    }
  } catch (error) {
    console.error("[ControlTowerRepository] Failed to fetch read model:", error)
    return {
      active_workspaces: 0,
      running_missions: 0,
      pending_verifications: 0,
      total_settled_sc: 0,
      total_cogs_usd: 0,
      risk_rail: [
        {
          id: `err_ct_${Date.now()}`,
          severity: "P0",
          title: "관제탑 데이터 로드 장애 (Fail-Closed)",
          count: 1,
          age: "방금",
          action: "서버 로그 및 DB 연결 상태 확인",
          domain: "SYSTEM",
          desc: (error as Error)?.message || "관제탑 메트릭을 불러오지 못하여 안전을 위해 P0 위험을 선언합니다.",
        },
      ],
      live_queue: [],
    }
  }
}
