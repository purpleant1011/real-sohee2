export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/**
 * M08 첫 게시 결과 조회 (ANI-1681) — 읽기 전용.
 *
 * 결과 화면을 다시 열었을 때(새로고침·알림·뒤로가기) 서버에 저장된 마지막 실행 결과를 읽는다.
 * - 저장된 `executionResult` 를 그대로 내려준다. 여기서 상태를 만들거나 올리지 않는다.
 * - 승인 시점의 대상 계정(`payload.channels[].handle`)만 계정 대조 근거로 함께 내려준다.
 * - 게시를 실행하지 않는다. 외부 호출도 하지 않는다. 새 쓰기 경로가 아니다.
 * - 다른 매장의 미션은 workspace 조건으로 404 가 된다.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type ResultChannel = 'instagram' | 'threads'

function approvedHandles(metadata: unknown): Partial<Record<ResultChannel, string>> {
  const meta = typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {}
  const approved = typeof meta.approvedMission === 'object' && meta.approvedMission !== null
    ? (meta.approvedMission as Record<string, unknown>)
    : null
  const approvedPayload = typeof approved?.payload === 'object' && approved.payload !== null
    ? (approved.payload as Record<string, unknown>)
    : null

  // 승인 스냅샷(approvedMission)만 계정 대조 근거로 쓴다.
  // 초안(draft·payload)은 승인 전 내용이므로, 이걸 근거로 삼으면 미승인 초안만으로
  // '게시 확인'을 만들 수 있다. 승인 스냅샷이 없으면 근거 없음({})으로 fail-closed 한다.
  const rows = Array.isArray(approvedPayload?.channels) ? (approvedPayload.channels as unknown[]) : []

  const handles: Partial<Record<ResultChannel, string>> = {}
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const item = row as Record<string, unknown>
    const channel = item.provider
    if (channel !== 'instagram' && channel !== 'threads') continue
    const handle = typeof item.handle === 'string' ? item.handle.trim() : ''
    if (handle !== '') handles[channel] = handle
  }
  return handles
}

/** 저장된 결과·계정 근거는 공유 캐시에 남기지 않는다. 오류 응답도 같다. */
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
}

export async function GET(req: Request, context: { params: Promise<{ missionId: string }> }) {
  try {
    const { missionId } = await context.params
    if (!UUID.test(missionId)) {
      return reply({ error: '확인할 결과를 찾지 못했어요.', code: 'INVALID_MISSION_UUID' }, 422)
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return reply({ error: '인증 세션이 필요합니다.' }, 401)

    const { resolveDeterministicWorkspace } = await import('@/features/auth/workspace-context')
    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId: req.headers.get('x-workspace-id') || undefined,
    })
    if (!resolved.success) {
      return reply(
        { error: resolved.statusCode === 404 ? '소속된 매장(Workspace)이 없습니다.' : resolved.message },
        resolved.statusCode,
      )
    }

    const admin = createAdminSupabaseClient() as any
    const { data: mission, error } = await admin
      .from('marketing_missions')
      .select('id, workspace_id, status, metadata')
      .eq('id', missionId)
      .eq('workspace_id', resolved.workspaceId)
      .maybeSingle()
    if (error) {
      return reply({ error: '게시 결과를 확인하지 못했어요.', code: 'DB_READ_ERROR' }, 500)
    }
    if (!mission) {
      return reply({ error: '게시 결과를 찾지 못했어요.', code: 'MISSION_NOT_FOUND' }, 404)
    }

    return reply({
      success: true,
      missionStatus: mission.status,
      // 저장된 값을 그대로. 없으면 null — 화면은 '아직 결과 없음'으로 다룬다.
      executionResult: mission.metadata?.executionResult ?? null,
      approvedChannels: approvedHandles(mission.metadata),
    })
  } catch (err) {
    console.error('[missions/first-post/outcome get error]:', err)
    return reply({ error: '게시 결과를 확인하지 못했어요.', code: 'INTERNAL_ERROR' }, 500)
  }
}
