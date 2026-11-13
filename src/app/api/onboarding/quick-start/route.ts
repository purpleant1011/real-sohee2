export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { applyQuickStart, loadQuickStartProfile, loadQuickStartPreferences, quickStartInputSchema, quickStartProgressSchema, saveQuickStartProgress } from '@/features/quick-start/quick-start-service'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { loadReadiness } from '@/features/readiness/load'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { quickPostCost } from '@/features/quick-start/quick-post-credits'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id') || body?.workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const parsed = quickStartInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.', code: 'INVALID_INPUT' },
      { status: 422 },
    )
  }

  try {
    await applyQuickStart({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, input: parsed.data })
    for (const event of ['quickstart_shop_saved', 'quickstart_tone_saved'] as const) {
      await recordFunnelEvent({
        admin: auth.admin,
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        event,
        dedupeKey: `${event === 'quickstart_shop_saved' ? 'quickstart-shop' : 'quickstart-tone'}:${auth.userId}`,
      })
    }
    const readiness = await loadReadiness(auth.workspaceId, { supabaseClient: auth.supabase as any })
    return NextResponse.json({
      success: true,
      workspaceId: auth.workspaceId,
      ready: readiness.stage === 'PUBLISH_READY',
      stage: readiness.stage,
      progressPercent: readiness.progressPercent,
      connectionHint: readiness.connectionHint,
      nextStep: readiness.prepared ? 'compose' : 'shop',
      blockers: readiness.blockers.map((b) => ({ code: b.code, message: b.message, href: b.remediationHref })),
    })
  } catch (err: any) {
    console.error('[onboarding/quick-start]', err)
    return NextResponse.json({ error: '정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'QUICK_START_FAILED' }, { status: 500 })
  }
}

/** Saves an incomplete owner form without marking rules or channels ready. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id') || body?.workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const parsed = quickStartProgressSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '가게 이름과 입력한 내용을 확인해 주세요.', code: 'INVALID_INPUT' }, { status: 422 })
  try {
    await saveQuickStartProgress({ admin: auth.admin, workspaceId: auth.workspaceId, input: parsed.data })
    return NextResponse.json({ saved: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: '입력한 내용을 저장하지 못했어요. 이 화면에서 다시 시도해 주세요.', code: 'QUICK_START_SAVE_FAILED' }, { status: 503 })
  }
}

/** Current quick-start/first-post readiness so the wizard can resume at the right step. */
export async function GET(req: Request) {
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id'))
  if (isResponse(auth)) return auth
  try {
    const readiness = await loadReadiness(auth.workspaceId, { supabaseClient: auth.supabase as any })
    const profile = await loadQuickStartProfile({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId })
    const preferences = await loadQuickStartPreferences({ admin: auth.admin, workspaceId: auth.workspaceId })
    // 사장님이 직접 입력한 사업자·운영 정보(선택). 없으면 null 이고, 위저드는 빈 폼을 보여준다.
    const { data: detailsRow } = await auth.admin
      .from('workspace_business_details')
      .select('business_number, representative_name, business_start_date, business_type, business_item, phone, business_hours, closed_days, parking_info, reservation_method, website_url, price_range, naver_place_url, intake_source, updated_at')
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle()
    return NextResponse.json({
      workspaceId: auth.workspaceId,
      ready: readiness.stage === 'PUBLISH_READY',
      stage: readiness.stage,
      progressPercent: readiness.progressPercent,
      connectionHint: readiness.connectionHint,
      profile,
      preferences,
      businessDetails: detailsRow
        ? {
            businessNumber: detailsRow.business_number ?? '',
            representativeName: detailsRow.representative_name ?? '',
            businessStartDate: detailsRow.business_start_date ?? '',
            businessType: detailsRow.business_type ?? '',
            businessItem: detailsRow.business_item ?? '',
            phone: detailsRow.phone ?? '',
            businessHours: detailsRow.business_hours ?? '',
            closedDays: detailsRow.closed_days ?? '',
            parkingInfo: detailsRow.parking_info ?? '',
            reservationMethod: detailsRow.reservation_method ?? '',
            websiteUrl: detailsRow.website_url ?? '',
            priceRange: detailsRow.price_range ?? '',
            naverPlaceUrl: detailsRow.naver_place_url ?? '',
            intakeSource: detailsRow.intake_source === 'naver_sync' ? 'naver_sync' : 'manual',
            updatedAt: detailsRow.updated_at ?? null,
          }
        : null,
      creditNotice: `글·이미지 초안 1회 생성에는 최대 ${quickPostCost('both')} SC를 사용해요. 입력 정보 저장과 사진 업로드에는 생성 크레딧을 차감하지 않아요. 잔여 크레딧이 부족하면 생성 전에 알려드려요.`,
      facts: Object.fromEntries(Object.entries(readiness.facts).map(([k, v]) => [k, v.verified])),
      blockers: readiness.blockers.map((b) => ({ code: b.code, factKey: b.factKey, message: b.message, href: b.remediationHref })),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({
      error: '가게 정보를 불러오지 못했어요. 입력한 정보는 지우지 않았어요. 잠시 후 다시 시도해 주세요.',
      code: 'QUICK_START_READ_FAILED',
    }, { status: 503 })
  }
}
