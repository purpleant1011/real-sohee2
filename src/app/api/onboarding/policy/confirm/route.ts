export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * P0-9: Real Database Persistence for Operating Policy
 * Persists confirmed operating policy into harness_rules table with rule_type='approval_policy' and status='active'.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)

    const workspaceId = members?.[0]?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))

    // Invariant: Explicit '이 기준으로 사용' or '이 설정으로 시작하기' confirmation required
    const userConfirmationPhrase = typeof body.userConfirmationPhrase === 'string' ? body.userConfirmationPhrase : ''
    const hasExplicitPhrase =
      userConfirmationPhrase.includes('이 기준으로 사용') ||
      userConfirmationPhrase.includes('이 설정으로 시작하기') ||
      userConfirmationPhrase.includes('앞으로 이 기준으로 써줘')
    const isExplicitlyApproved = body.isExplicitlyApproved === true && hasExplicitPhrase

    if (!isExplicitlyApproved) {
      return NextResponse.json(
        {
          error: "운영 정책 확정을 위해서는 사용자의 명시적인 '이 기준으로 사용' 승인이 필요합니다.",
          code: 'EXPLICIT_CONFIRMATION_REQUIRED',
        },
        { status: 422 }
      )
    }

    const {
      publishApprovalLevel,
      requireApprovalBeforePublish = true,
      customerResponseAutomationLevel,
      bookingPolicy,
      maxDailyPublishCount = 2,
      allowedChannels = ['instagram', 'threads'],
      dailySpendLimitKrw,
      monthlySpendLimitKrw,
      maxCostPerActionKrw,
      emergencyStop = false,
      emergencyStopEnabled,
      stopOnConsecutiveFailures,
      handoffOnComplaint,
      handoffOnPriceInquiry,
      handoffOnUncertainty,
    } = body

    const { persistOperatingPolicy } = await import('@/features/operating-policy')
    const { invalidateReadinessCache } = await import('@/features/sohee-ready/cache-invalidation')

    const confirmedPolicy = await persistOperatingPolicy({
      workspaceId,
      userId: user.id,
      rules: {
        publishApprovalLevel: publishApprovalLevel || (requireApprovalBeforePublish ? 'always_require' : 'conditional_auto'),
        requireApprovalBeforePublish,
        customerResponseAutomationLevel: customerResponseAutomationLevel || 'draft_only',
        bookingPolicy: bookingPolicy || 'require_human_confirmation',
        maxDailyPublishCount,
        allowedChannels,
        dailySpendLimitKrw: dailySpendLimitKrw ?? 10000,
        monthlySpendLimitKrw: monthlySpendLimitKrw ?? 100000,
        maxCostPerActionKrw: maxCostPerActionKrw ?? 2000,
        emergencyStop: emergencyStop || (emergencyStopEnabled === false ? false : emergencyStop ?? false),
        stopOnConsecutiveFailures: stopOnConsecutiveFailures ?? 3,
        handoffOnComplaint: handoffOnComplaint ?? true,
        handoffOnPriceInquiry: handoffOnPriceInquiry ?? true,
        handoffOnUncertainty: handoffOnUncertainty ?? true,
        restrictions: body.restrictions || undefined,
      },
      supabaseClient: supabase,
      adminClient: (await import('@/lib/supabase/admin')).createAdminSupabaseClient(),
    })

    invalidateReadinessCache(workspaceId)

    return NextResponse.json({
      success: true,
      ruleId: confirmedPolicy.id,
      version: confirmedPolicy.versionNumber,
      status: confirmedPolicy.status,
      confirmedAt: confirmedPolicy.confirmedAt,
      message: '운영 정책이 DB에 정상 확정되었습니다. (OPERATING_POLICY_CONFIRMED)',
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[policy/confirm error]:', err)
    const { sanitizeAndTranslateError } = await import('@/features/operating-policy')
    const translated = sanitizeAndTranslateError(err)
    const statusCode = (err as any)?.statusCode || 500
    return NextResponse.json(
      {
        error: translated.whatHappened,
        translatedError: translated,
      },
      { status: statusCode }
    )
  }
}
