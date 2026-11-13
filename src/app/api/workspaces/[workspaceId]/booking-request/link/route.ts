export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { issueRequestToken } from '@/features/booking-request/request-token'

const NO_STORE = { 'Cache-Control': 'no-store' }

function resolveOrigin(request: Request): string {
  const originHeader = request.headers.get('origin')
  if (originHeader) {
    return originHeader.replace(/\/+$/, '')
  }

  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (forwardedHost && !forwardedHost.startsWith('localhost')) {
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${forwardedHost}`.replace(/\/+$/, '')
  }

  if (process.env.APP_URL?.trim()) {
    return process.env.APP_URL.trim().replace(/\/+$/, '')
  }

  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'http'
    return `${proto}://${forwardedHost}`.replace(/\/+$/, '')
  }

  try {
    return new URL(request.url).origin
  } catch {
    return 'https://example.com'
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const secret = process.env.PASS_TOKEN_SECRET?.trim()
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: '예약 신청 링크를 만들 수 없어요(설정 필요)' },
        { status: 503, headers: NO_STORE }
      )
    }

    const token = await issueRequestToken({
      workspaceId: auth.workspaceId,
      secret,
    })
    if (!token) {
      return NextResponse.json(
        { ok: false, error: '예약 신청 링크를 만들 수 없어요(설정 필요)' },
        { status: 503, headers: NO_STORE }
      )
    }

    const origin = resolveOrigin(request)
    const url = `${origin}/booking-request?token=${encodeURIComponent(token)}`

    return NextResponse.json({ ok: true, url }, { status: 200, headers: NO_STORE })
  } catch {
    return NextResponse.json(
      { ok: false, error: '예약 신청 링크 생성 중 오류가 발생했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
