import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createMobileReadDeps } from '@/features/mobile-decision/server/production'
import { readMobileApproval } from '@/features/mobile-decision/server/read-model'
import { readWorkspaceDataset } from '@/features/reporting/dataset'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; itemKey: string }> }) {
  const { workspaceId, itemKey } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'reviewer' })
  if (isResponse(auth)) { auth.headers.set('Cache-Control', 'no-store'); return auth }
  if (auth.workspaceId !== workspaceId) return NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404, headers })
  try {
    const dataset = await readWorkspaceDataset(auth.admin, auth.workspaceId)
    if (dataset.mode !== 'ACTUAL') return NextResponse.json({ error: '업무 데이터를 확인하지 못했어요.' }, { status: 503, headers })
    const view = await readMobileApproval(auth, itemKey, createMobileReadDeps(auth.supabase, undefined, auth.admin))
    // 서버 registry로 확인한 분류를 전달한다. 조회 DTO는 전송 허가가 아니며,
    // 답장/게시 명령은 각 정본 API에서 최종 문안·권한·실행 가능성을 다시 검증한다.
    return view ? NextResponse.json({ ...view, datasetMode: dataset.mode,
      reason: '내용을 수정하고 최종 확인한 뒤 실행을 요청할 수 있어요.' }, { headers }) : NextResponse.json({ error: '이 작업을 확인할 수 없어요.' }, { status: 404, headers })
  } catch {
    return NextResponse.json({ error: '작업을 불러오지 못했어요. 다시 확인해 주세요.' }, { status: 503, headers })
  }
}
