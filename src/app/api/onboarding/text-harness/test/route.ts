export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  createTextHarnessDraft,
  runTextHarnessTest,
  type TextHarnessRules,
} from '@/features/text-harness/text-harness-manager'

/**
 * P0-7: Real Production Test Generation for Text Harness
 * Runs real test generation (Instagram 2 + Threads 2) and records audit trail.
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
    const { sampleTopic = '매장 시그니처 소식', rules } = body

    if (!rules || !rules.toneAndManner) {
      return NextResponse.json({ error: '텍스트 하네스 룰(톤앤매너 등)이 필요합니다.' }, { status: 400 })
    }

    const draft = createTextHarnessDraft({
      workspaceId,
      rules: rules as TextHarnessRules,
      versionNumber: typeof body.versionNumber === 'number' ? body.versionNumber : 1,
    })

    // Execute test generation
    const result = runTextHarnessTest({
      draft,
      sampleTopic,
    })

    // Record audit event in DB
    try {
      await (supabase as any).from('ai_usage_events').insert({
        workspace_id: workspaceId,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        credits_used: 0, // Education test runs are subsidized
        metadata: {
          purpose: 'EDUCATION_TEXT_HARNESS_TEST',
          sampleTopic,
          copiesCount: result.instagramCopies.length + result.threadsCopies.length,
          actorUserId: user.id,
          runAt: new Date().toISOString(),
        },
      })
    } catch (auditErr) {
      console.warn('[text-harness/test] Audit insert warning:', auditErr)
    }

    return NextResponse.json({
      success: true,
      workspaceId,
      draft: result.updatedDraft,
      instagramCopies: result.instagramCopies,
      threadsCopies: result.threadsCopies,
      testRunsCount: result.updatedDraft.testRunsCount,
    })
  } catch (err: unknown) {
    console.error('[text-harness/test error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '테스트 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
