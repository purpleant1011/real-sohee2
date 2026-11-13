import { NextRequest, NextResponse } from 'next/server'
import { resolveBookingPass } from '@/features/kakao/booking-pass/pass-view'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: '예약패스 토큰이 필요합니다.',
        reason: 'missing_token',
      },
      { status: 400, headers: securityHeaders },
    )
  }

  // Security: Exclusively use PASS_TOKEN_SECRET. Never fallback to KAKAO_STATE_SECRET.
  const secret = process.env.PASS_TOKEN_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: '토큰 검증 서비스를 이용할 수 없습니다.',
        reason: 'token_verification_unavailable',
      },
      { status: 503, headers: securityHeaders },
    )
  }

  const dbClient = createAdminSupabaseClient()
  const result = await resolveBookingPass(token, secret, dbClient)

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 400
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        reason: result.reason,
      },
      { status, headers: securityHeaders },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      pass: result.pass,
    },
    { status: 200, headers: securityHeaders },
  )
}
