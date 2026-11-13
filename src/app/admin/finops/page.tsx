import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AlertTriangle } from 'lucide-react'
import { PageHeader, MetricTile, LoadErrorNotice } from '@/components/admin-ui/data-state'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminFinOpsPage() {
  await requireOperator('billing.read')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  let hasError = false
  let costEntries: Array<{ category: string; cost_in_won: number; units_consumed: number; created_at: string }> = []
  let usageEntries: Array<{ action: string | null; amount: number; occurred_at: string }> = []

  try {
    const adminDb = createAdminSupabaseClient()

    const [costResult, usageResult] = await Promise.all([
      (adminDb as any)
        .from('finops_cost_ledger')
        .select('category, cost_in_won, units_consumed, created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(1000),
      adminDb
        .from('credit_ledger_entries')
        .select('action, amount, occurred_at')
        .eq('kind', 'consume')
        .gte('occurred_at', thirtyDaysAgo)
        .order('occurred_at', { ascending: false })
        .limit(1000),
    ])

    if (costResult.error || usageResult.error || !Array.isArray(costResult.data) || !Array.isArray(usageResult.data)) {
      hasError = true
    } else {
      costEntries = costResult.data
      usageEntries = usageResult.data
    }
  } catch {
    hasError = true
  }

  if (hasError) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-8 font-sans">
        <PageHeader
          title="AI 비용"
          description="최근 30일간 AI 모델 및 인프라 호출 비용과 크레딧 소비 현황을 확인합니다."
        />
        <LoadErrorNotice what="AI 인프라 원가 및 크레딧 소비 내역" retryHref="/admin/finops" />
      </div>
    )
  }

  let totalTokens = 0
  let totalImages = 0
  let totalCostWon = 0

  for (const entry of costEntries) {
    totalCostWon += Number(entry.cost_in_won) || 0
  }

  for (const entry of usageEntries) {
    if (entry.action === 'text_generation' || entry.action === 'chat_turn') {
      totalTokens += Math.abs(entry.amount)
    } else if (entry.action === 'image_generation') {
      totalImages += 1
    }
  }

  const hasUsage = usageEntries.length > 0
  const hasActualCostRecords = costEntries.length > 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 font-sans">
      <PageHeader
        title="AI 비용"
        description="최근 30일간 AI 모델 및 인프라 호출 비용과 크레딧 소비 현황을 확인합니다."
      />

      {/* 4대 주요 지표 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricTile
          label="최근 30일 AI 텍스트 소비"
          value={hasUsage ? `${totalTokens.toLocaleString()} SC` : 0}
          hint={hasUsage ? "텍스트 및 대화 생성 크레딧 소비량" : "소비 이력 없음"}
          tone="default"
        />

        <MetricTile
          label="최근 30일 이미지 생성 작업"
          value={`${totalImages.toLocaleString()}건`}
          hint={totalImages > 0 ? "이미지 에이전트 실행 완료" : "생성 이력 없음"}
          tone="default"
        />

        <MetricTile
          label="최근 30일 인프라 원가"
          value={hasActualCostRecords ? `${Math.round(totalCostWon).toLocaleString()}원` : null}
          hint={hasActualCostRecords ? "외부 공급자 인프라 지출 원가" : "원가 기록 대기 중"}
          tone="default"
        />

        <MetricTile
          label="단위 경제학 마진"
          value={null}
          hint="실제 공급자 비용 대사 후 산출됩니다"
          tone="default"
        />
      </div>

      {/* 비정상 비용 스로틀 & 경보 */}
      <div className="p-5 rounded-2xl bg-card border border-border space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <AlertTriangle className="w-4 h-4 text-state-warn" />
          <span>비정상 비용 발생 고객사 모니터링</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasActualCostRecords
            ? "최근 30일 비용 추이를 바탕으로 비정상적인 호출 및 비용 급증 징후를 모니터링 중입니다."
            : "인프라 원가 데이터 수집 시 비용 급증 및 이상 징후를 자동으로 감지합니다."}
        </p>
      </div>
    </div>
  )
}
