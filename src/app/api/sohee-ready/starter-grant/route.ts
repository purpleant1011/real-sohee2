import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { grantSoheeReadyStarterEntitlement } from '@/features/sohee-ready/entitlement'
import { SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // [P0-2 Step A] User authorization via user session client
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // Determine active workspace and verify membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!member?.workspace_id) {
      return NextResponse.json(
        { error: '소속된 워크스페이스를 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    // [P0-2 Step B] Trusted DB execution via server-only Admin Supabase client (service_role only)
    const adminSupabase = createAdminSupabaseClient()
    const result = await grantSoheeReadyStarterEntitlement(
      adminSupabase as any,
      member.workspace_id,
      user.id
    )

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    if (error instanceof SoheeNotReadyError) {
      return NextResponse.json(
        {
          error: error.message,
          blockers: error.snapshot?.blockers || [],
        },
        { status: 403 }
      )
    }

    console.error('[POST /api/sohee-ready/starter-grant] Error:', error)
    return NextResponse.json(
      { error: error.message || '스타터 혜택 활성화 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
