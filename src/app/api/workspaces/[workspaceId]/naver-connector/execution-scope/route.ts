import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { executionScopeSelectionSchema } from '@/features/local-publishing/execution-scope'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const dynamic = 'force-dynamic'
const headers = { 'cache-control': 'no-store' }
type Context = { params: Promise<{ workspaceId: string }> }

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    if (!z.string().uuid().safeParse(workspaceId).success) return NextResponse.json({ error: '작업공간을 확인해 주세요.' }, { status: 400, headers })
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 candidate 조회 차단
    return naverAutomationBlocked('publish')
  } catch {
    return NextResponse.json({ error: '승인한 글의 실행 상태를 읽지 못했어요. 다시 확인해 주세요.' }, { status: 503, headers })
  }
}

export async function POST(request: Request, { params }: Context) {
  if (new URL(request.url).origin !== 'https://example.com' || request.headers.get('origin') !== 'https://example.com') return NextResponse.json({ error: '소희 화면에서 글을 선택해 주세요.' }, { status: 403, headers })
  try {
    const { workspaceId } = await params
    if (!z.string().uuid().safeParse(workspaceId).success) return NextResponse.json({ error: '작업공간을 확인해 주세요.' }, { status: 400, headers })
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth
    const parsed = executionScopeSelectionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: '실행할 글과 계정, 승인 버전을 확인해 주세요.' }, { status: 400, headers })
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 실행 범위 선택 즉시 차단
    return naverAutomationBlocked('publish')
  } catch {
    return NextResponse.json({ error: '이 글의 실행 범위를 기록하지 못했어요. 다시 확인해 주세요.' }, { status: 503, headers })
  }
}
