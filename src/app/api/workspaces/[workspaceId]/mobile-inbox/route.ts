export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readMobileInbox } from '@/features/mobile-inbox/server/read-inbox'
import { readInboxSource, type InboxClient } from '@/features/mobile-inbox/server/inbox-source'
import { readWorkspaceDataset } from '@/features/reporting/dataset'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 소통함 목록(읽기 전용). 사용자 세션 RLS 로만 조회하고 어떤 외부 전송도 하지 않는다.
 * 조회 전에 가게의 dataset 분류를 확인하고, ACTUAL 로 확인된 경우에만 원본 테이블을 읽는다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const now = () => new Date().toISOString()
  // 분류는 인증이 확정한 workspace 로만 확인한다. 확인 전에는 원본을 읽지 않는다.
  const dataset = await readWorkspaceDataset(auth.admin, auth.workspaceId)
  const ctx = { workspaceId: auth.workspaceId, userId: auth.userId }
  const result = await readMobileInbox(ctx, {
    now,
    readThreads: c => {
      // 시연·테스트·분류 불가(EXCLUDED/UNKNOWN/오류)는 원본을 읽지 않고,
      // ACTUAL 아님으로 표시해 read-model 의 fail-closed 경로(error)로 보낸다.
      if (dataset.mode !== 'ACTUAL') {
        return Promise.resolve({ rows: [], complete: false, observedAt: now(), datasetMode: 'UNKNOWN' as const })
      }
      return readInboxSource(auth.supabase as unknown as InboxClient, c, { now, datasetMode: 'ACTUAL' })
    },
  })
  // 조회 실패도 200 으로 빈 목록을 주지 않는다: 503 + error 상태.
  return NextResponse.json(result.snapshot, { status: result.ok ? 200 : 503, headers: NO_STORE })
}
