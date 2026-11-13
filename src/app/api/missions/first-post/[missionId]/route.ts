export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { extendFirstPostDraft, readDraftExtensionEvidence } from '@/features/missions/first-post-draft-extension'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 서버에 저장된 첫 포스팅 초안 조회(읽기 전용). 새로고침 복원용. 다른 매장의 미션은 보이지 않는다. */
export async function GET(req: Request, context: { params: Promise<{ missionId: string }> }) {
  const response = await readDraft(req, context)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function readDraft(req: Request, context: { params: Promise<{ missionId: string }> }) {
  try {
    const { missionId } = await context.params
    if (!UUID.test(missionId)) {
      return NextResponse.json({ error: 'missionId는 유효한 UUID 형식이어야 합니다.', code: 'INVALID_MISSION_UUID' }, { status: 422 })
    }
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })

    const { resolveDeterministicWorkspace } = await import('@/features/auth/workspace-context')
    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId: req.headers.get('x-workspace-id') || undefined,
    })
    if (!resolved.success) {
      return NextResponse.json({ error: resolved.statusCode === 404 ? '소속된 매장(Workspace)이 없습니다.' : resolved.message }, { status: resolved.statusCode })
    }

    const admin = createAdminSupabaseClient() as any
    const { data: mission, error } = await admin
      .from('marketing_missions')
      .select('id, workspace_id, status, metadata')
      .eq('id', missionId)
      .eq('workspace_id', resolved.workspaceId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: '미션 조회 중 오류가 발생했어요.', code: 'DB_READ_ERROR' }, { status: 500 })
    const draft = mission?.metadata?.draft
    if (!mission || !draft) return NextResponse.json({ error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' }, { status: 404 })

    const evidence = await readDraftExtensionEvidence(admin, resolved.workspaceId)
    return NextResponse.json({
      success: true,
      missionStatus: mission.status,
      draft: evidence ? extendFirstPostDraft(draft, evidence) : { ...draft, datasetMode: 'UNKNOWN' as const },
    })
  } catch (err) {
    console.error('[missions/first-post/get error]:', err)
    return NextResponse.json({ error: '초안을 불러오지 못했어요.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
