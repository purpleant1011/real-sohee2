import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { loadGrowthEvidence } from '@/features/sohee-growth/load-evidence'
import { buildGrowthSnapshot } from '@/features/sohee-growth/snapshot'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** 소희의 교육 완성도·레벨·업무 해금 상태 (저장된 데이터에서 계산). */
export async function GET(_req: NextRequest, props: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    const evidence = await loadGrowthEvidence(auth.workspaceId)
    return NextResponse.json({ success: true, data: buildGrowthSnapshot(evidence) }, { headers: NO_STORE })
  } catch (error) {
    console.error('[sohee-growth] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { success: false, error: 'GROWTH_UNAVAILABLE', message: '소희의 성장 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
