export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { persistTextHarness } from '@/features/text-harness/text-harness-server'
import { confirmTextHarnessVersion, type TextHarnessVersion } from '@/features/text-harness/text-harness-manager'

/**
 * P0-7: Real Database Persistence for Text Harness Version
 * Persists confirmed text harness rules into harness_rules table.
 * Strictly enforces that testRunsCount >= 1 before allowing confirmation.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '다시 로그인한 뒤 시도해 주세요.' }, { status: 401 })
    }

    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)

    const workspaceId = members?.[0]?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: '가게 정보를 찾지 못했어요. 가게를 선택한 뒤 다시 시도해 주세요.' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const draft: TextHarnessVersion = body.draft

    if (!draft || !draft.rules) {
      return NextResponse.json({ error: '저장할 가게 말투 설정이 필요해요.' }, { status: 400 })
    }

    // Strict Invariant: Minimum 1 test generation run required before confirmation
    if (draft.testRunsCount < 1) {
      return NextResponse.json(
        {
          error: '이 말투로 만든 예시 글을 한 번 이상 확인한 뒤 저장해 주세요.',
          code: 'TEST_RUN_REQUIRED',
        },
        { status: 422 }
      )
    }

    // Strict Invariant: Explicit confirmation required ('이 기준으로 사용' or '이 느낌으로 기억해줘')
    const userConfirmationPhrase = typeof body.userConfirmationPhrase === 'string' ? body.userConfirmationPhrase : ''
    const allowedPhrases = ['이 기준으로 사용', '이 느낌으로 기억해줘', '앞으로 이 기준으로 써줘']
    const hasExplicitPhrase = allowedPhrases.some((phrase) => userConfirmationPhrase.includes(phrase))
    const isExplicitlyApproved = body.isExplicitlyApproved === true && hasExplicitPhrase

    if (!isExplicitlyApproved) {
      return NextResponse.json(
        {
          error: "가게 말투를 저장하려면 '이 기준으로 사용' 또는 '이 느낌으로 기억해줘'라고 확인해 주세요.",
          code: 'EXPLICIT_CONFIRMATION_REQUIRED',
        },
        { status: 422 }
      )
    }

    const boundDraft: TextHarnessVersion = {
      ...draft,
      workspaceId,
      rules: {
        ...draft.rules,
        ...(body.calibrationHistory ? { calibrationHistory: body.calibrationHistory } : {}),
      },
    }

    const { confirmedVersion } = confirmTextHarnessVersion({
      draft: boundDraft,
      userId: user.id,
    })

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    const persisted = await persistTextHarness(confirmedVersion, createAdminSupabaseClient())

    // Invalidate readiness cache so UI updates immediately
    const { invalidateReadinessCache } = await import('@/features/sohee-ready/cache-invalidation')
    invalidateReadinessCache(workspaceId)

    const finalConfirmedVersion: TextHarnessVersion = {
      ...confirmedVersion,
      id: persisted.id,
      versionNumber: persisted.version,
    }

    return NextResponse.json({
      success: true,
      confirmedVersion: finalConfirmedVersion,
      message: '가게 말투 설정을 저장했어요.',
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[text-harness/confirm error]:', err)
    return NextResponse.json(
      { error: '가게 말투 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}
