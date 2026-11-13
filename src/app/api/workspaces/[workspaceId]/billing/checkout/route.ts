import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { createCheckoutIntent } from '@/features/billing/repository'
import { findBillingPlan } from '@/features/billing/billing-plan-catalog'
import { billingPlanCodes } from '@/features/billing/types'

const commercialAliases = ['STARTER_150K', 'GROWTH_300K', 'SCALE_500K', '150K', '300K', '500K'] as const
const checkoutRequestSchema = z.object({
  planCode: z.enum([...billingPlanCodes, ...commercialAliases]),
  idempotencyKey: z.string().uuid(),
}).strict()

/** 기존 플랜 선택 의향만 저장한다. PG 청구·구독 활성화·크레딧 지급 경로가 아니다. */
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params
    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status })
    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json({ error: 'FORBIDDEN_ROLE', message: '요금제 선택을 저장할 권한이 없습니다.' }, { status: 403 })
    }
    const parsed = checkoutRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_REQUEST', message: '요금제와 요청 정보를 확인해 주세요.' }, { status: 400 })
    }
    const legacyCode = z.enum(billingPlanCodes).safeParse(parsed.data.planCode)
    if (!legacyCode.success) {
      // 신규 기능 구독을 레거시 크레딧 지급 플랜에 자동 매핑하지 않는다.
      return NextResponse.json({ error: 'BUSINESS_DECISION_REQUIRED', message: '새 구독 상품의 이용 조건을 준비 중입니다. 결제는 시작되지 않았습니다.' }, { status: 409 })
    }
    const plan = findBillingPlan(legacyCode.data)
    if (!plan) return NextResponse.json({ error: 'INVALID_PLAN_CODE', message: '요금제를 확인해 주세요.' }, { status: 400 })
    const result = await createCheckoutIntent({ workspaceId, billingPlanId: plan.id, idempotencyKey: parsed.data.idempotencyKey })
    if (result.error || !result.data) {
      return NextResponse.json({ error: 'CHECKOUT_INTENT_CREATION_FAILED', message: '결제 의향 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
    }
    if (result.data.state !== 'provider_pending') {
      return NextResponse.json({ error: 'INVALID_INTENT_STATE', message: '선택 저장 상태를 확인하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      savedIntentOnly: true,
      checkoutIntentId: result.data.checkoutIntentId,
      state: result.data.state,
      planCode: plan.code,
      planLabel: plan.label,
      monthlyPriceLabel: plan.monthlyPriceLabel,
      message: '기존 요금제 선택 의향만 저장했습니다. 결제나 구독 활성화는 시작되지 않았습니다.',
    })
  } catch {
    // 원본 Error에는 DB 주소·인증정보가 포함될 수 있어 응답과 로그에 기록하지 않는다.
    return NextResponse.json({ error: 'CHECKOUT_FAILED', message: '결제 요청 처리에 실패했습니다.' }, { status: 500 })
  }
}
