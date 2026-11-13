export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { requireSoheeReady, SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import { createSharedMissionEntry } from '@/features/content/shared-mission-runtime'
import { buildCanonicalMissionDTO } from '@/lib/mission-os/mission-read-model'

/**
 * P0-10: Shared Mission Runtime & Persistent Mission API
 *
 * Enforces:
 * 1. Active workspace context via readPreferredWorkspaceIdFromCookies & resolveCurrentWorkspaceContext
 * 2. SOHEE_READY admission guard (403 Fail-Closed)
 * 3. Immutable 4-harness snapshot pinning (Knowledge, Text, Image, Policy)
 * 4. Immediate DB persistence to marketing_missions table (status: 'QUEUED' / 'PLANNING')
 * 5. Consistent entry point for both Content Studio CTA and Chat Natural Language commands
 */
export async function POST(req: Request) {
  try {
    const preferredId = await readPreferredWorkspaceIdFromCookies()
    const resolution = await resolveCurrentWorkspaceContext(preferredId)

    if (resolution.status === 'expired') {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }
    if (resolution.status === 'forbidden') {
      return NextResponse.json({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, { status: 403 })
    }
    if (resolution.status === 'missing') {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (resolution.status === 'error') {
      return NextResponse.json({ error: '워크스페이스 확인 중 일시적인 오류가 발생했습니다.' }, { status: 500 })
    }

    const workspaceId = resolution.context.workspaceId
    const supabase = await createServerSupabaseClient()

    // 1. Admission Guard (Fail-Closed)
    let snapshot
    try {
      snapshot = await requireSoheeReady(workspaceId, { action: 'MISSION_CREATE' })
    } catch (guardErr: any) {
      if (guardErr instanceof SoheeNotReadyError || guardErr?.code === 'SOHEE_NOT_READY') {
        return NextResponse.json({
          success: false,
          error: {
            code: 'SOHEE_NOT_READY',
            message: guardErr.message,
            blockers: guardErr.snapshot?.blockers || [],
            membershipTier: guardErr.membershipTier,
            membershipNotice: guardErr.membershipNotice,
            notice: guardErr.notice,
          },
        }, { status: 403 })
      }
      throw guardErr
    }

    const body = await req.json().catch(() => ({}))
    const {
      source = 'CONTENT_UI',
      intent = '이번 주 매장 소식 및 카드뉴스 제작',
      channelTargets = ['instagram', 'threads'],
    } = body

    // 2. Create and persist mission
    const mission = await createSharedMissionEntry(
      {
        workspaceId,
        source,
        intent,
        channelTargets,
      },
      {
        readinessSnapshot: snapshot,
        supabaseClient: supabase,
      }
    )

    return NextResponse.json({
      success: true,
      missionId: mission.id,
      status: 'QUEUED',
      mission,
      message: '새로운 마케팅 미션이 등록되었습니다.',
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[POST /api/missions error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '미션 생성에 실패했습니다.' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const preferredId = await readPreferredWorkspaceIdFromCookies()
    const resolution = await resolveCurrentWorkspaceContext(preferredId)

    if (resolution.status === 'expired') {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }
    if (resolution.status === 'forbidden') {
      return NextResponse.json({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, { status: 403 })
    }
    if (resolution.status === 'missing') {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (resolution.status === 'error') {
      return NextResponse.json({ error: '워크스페이스 확인 중 일시적인 오류가 발생했습니다.' }, { status: 500 })
    }

    const workspace = resolution.context

    const supabase = await createServerSupabaseClient()
    const { data: missions, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[GET /api/missions db error]:', error)
      return NextResponse.json(
        { error: '업무 목록을 조회하는 중 데이터베이스 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    const rawRows = missions || []
    let projectionFailedCount = 0
    const canonicalMissions: ReturnType<typeof buildCanonicalMissionDTO>[] = []

    for (const m of rawRows) {
      try {
        canonicalMissions.push(buildCanonicalMissionDTO(m))
      } catch (mapErr) {
        console.error(`[GET /api/missions] failed to project mission row ${m?.id}:`, mapErr)
        projectionFailedCount++
      }
    }

    // Fail-closed: If DB rows exist but 100% failed to project, do not return fake empty success!
    if (rawRows.length > 0 && canonicalMissions.length === 0) {
      return NextResponse.json({
        success: false,
        error: '업무 목록 데이터를 안전하게 변환하지 못했습니다.',
        totalRows: rawRows.length,
        projectionFailedCount,
      }, { status: 500 })
    }

    // Security: Only return allowlisted canonical DTOs; raw DB rows with tokens/internal metadata are not exposed
    return NextResponse.json({
      success: true,
      hasPartialErrors: projectionFailedCount > 0,
      projectionFailedCount,
      totalCount: rawRows.length,
      canonicalMissions,
      items: canonicalMissions,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error('[GET /api/missions error]:', err)
    return NextResponse.json(
      { error: '업무 목록을 조회하는 중 일시적인 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
