export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readConversationDetail } from '@/features/mobile-inbox/server/read-detail'
import { safeDecodeThreadKey } from '@/features/mobile-inbox/detail-model'
import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** 대화 상세(읽기 전용). 사용자 세션 RLS 로만 조회하며 발송·승인 상태 변경을 하지 않는다. */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; threadKey: string }> }) {
  const { workspaceId, threadKey } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  const result = await readConversationDetail(
    auth.supabase as unknown as InboxClient,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    safeDecodeThreadKey(threadKey),
    { now: () => new Date().toISOString() },
  )
  if (result.status === 'ok') return NextResponse.json(result.detail, { headers: NO_STORE })
  const code = result.status === 'bad_key' ? 400 : result.status === 'not_found' ? 404 : 503
  return NextResponse.json({ error: result.status }, { status: code, headers: NO_STORE })
}
