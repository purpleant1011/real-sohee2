import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // Determine active workspace with cross-tenant authorization check
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId') || request.nextUrl.searchParams.get('workspace_id')

    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId,
    })

    if (!resolved.success) {
      return NextResponse.json(
        { error: resolved.statusCode === 404 ? '소속된 워크스페이스를 찾을 수 없습니다.' : resolved.message },
        { status: resolved.statusCode }
      )
    }

    const targetWorkspaceId = resolved.workspaceId

    // [HF-45] Dual-Client Responsibility:
    // supabase client is used for user-authorized fact tables.
    // Meta secret credentials are automatically read via server-only admin boundary inside getSoheeReadiness.
    const readiness = await getSoheeReadiness(targetWorkspaceId, { supabaseClient: supabase })

    return NextResponse.json({
      success: true,
      readiness,
    })
  } catch (error: any) {
    console.error('[GET /api/sohee-ready] Error:', error)
    return NextResponse.json(
      { error: error.message || '준비도 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
