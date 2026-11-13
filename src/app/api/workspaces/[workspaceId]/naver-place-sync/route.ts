import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) {
      return auth
    }

    // 네이버 스마트플레이스 스크래핑/동기화는 비공식 외부 수집 정책에 의해 차단된다.
    return naverAutomationBlocked('search_scrape')
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '네이버 플레이스 연동 중 오류가 발생했습니다.' }, { status: 500, headers: noStore })
  }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) {
      return auth
    }

    return naverAutomationBlocked('search_scrape')
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '네이버 플레이스 정보 조회 중 오류가 발생했습니다.' }, { status: 500, headers: noStore })
  }
}
