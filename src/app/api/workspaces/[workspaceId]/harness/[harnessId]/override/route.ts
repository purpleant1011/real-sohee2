export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { supabaseHarnessRepository } from '@/features/harness/supabase-harness-repository'
import { harnessStore } from '@/lib/harness/harness-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; harnessId: string }> }
) {
  const { workspaceId, harnessId } = await params

  // Cross-tenant guard: this writes through the service-role client, so a non-member must be
  // refused before the override is persisted.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { module, ruleKey, overrideValue, reason } = body

    if (!module || !ruleKey || !overrideValue) {
      return NextResponse.json(
        { ok: false, error: 'module, ruleKey, and overrideValue are required' },
        { status: 400 }
      )
    }

    const override = await supabaseHarnessRepository.addOverride({
      harnessAssetId: harnessId,
      workspaceId,
      module,
      ruleKey,
      overrideValue,
      reason: reason || '사용자 직접 등록 규칙'
    })

    return NextResponse.json({
      ok: true,
      override
    })
  } catch (error: any) {
    console.error('[HarnessOverrideAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
