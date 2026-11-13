export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { getQuickPost } from '@/features/quick-start/quick-post-query'
import { QuickPostError } from '@/features/quick-start/quick-post-service'

type Ctx = { params: Promise<{ workspaceId: string; id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { workspaceId, id } = await params
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const item = await getQuickPost(auth.admin, auth.workspaceId, id)
    if (!item) {
      return NextResponse.json({ error: '게시물을 찾을 수 없어요.', code: 'NOT_FOUND' }, { status: 404 })
    }
    return NextResponse.json({ item }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof QuickPostError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    console.error('[quick-post:get-one] failed')
    return NextResponse.json({ error: '게시물을 불러오지 못했어요.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
