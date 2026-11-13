export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readMobileCustomers } from '@/features/mobile-customers/server/read-customers'
import { readCustomerSource } from '@/features/mobile-customers/server/customer-source'
import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'
import { readWorkspaceDataset } from '@/features/reporting/dataset'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 고객 목록(읽기 전용, ANI-1771). 사용자 세션 RLS 로만 조회하고 연락처 값·외부 전송은 다루지 않는다.
 * 응답은 no-store 이며 workspace 는 요청 경로가 아니라 인증이 확정한 값만 쓴다.
 * dataset 분류가 ACTUAL 로 확인된 경우에만 조회한다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const now = () => new Date().toISOString()
  // 분류는 인증이 확정한 workspace 로만 확인한다.
  const dataset = await readWorkspaceDataset(auth.admin, auth.workspaceId)
  const result = await readMobileCustomers({ workspaceId: auth.workspaceId, userId: auth.userId }, {
    now,
    // ACTUAL 로 확인된 가게만 조회한다. 그 밖(EXCLUDED/UNKNOWN/분류 오류)은 read-model 이 조회 전에 fail-closed 한다.
    datasetMode: dataset.mode === 'ACTUAL' ? 'ACTUAL' : 'UNKNOWN',
    readCustomers: ctx => readCustomerSource(auth.supabase as unknown as InboxClient, ctx.workspaceId, { now }),
  })
  // 조회 실패도 200 으로 빈 목록을 주지 않는다: 503 + error 상태.
  return NextResponse.json(result.snapshot, { status: result.ok ? 200 : 503, headers: NO_STORE })
}
