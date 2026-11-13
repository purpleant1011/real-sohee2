import { NextRequest, NextResponse } from 'next/server'
import { verifyPassToken, constantTimeEqual } from '@/features/kakao/booking-pass/pass-token'
import { resolveBookingPass } from '@/features/kakao/booking-pass/pass-view'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  isBlocked,
  recordFailure,
  resetAttempts,
  hashToken,
  extractClientIp,
} from '@/features/kakao/booking-pass/pass-rate-limit'

export const dynamic = 'force-dynamic'

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

const encoder = new TextEncoder()

/**
 * Rate Limiting Architectural Limitation Note:
 * In edge / serverless execution environments, workers are ephemeral and do not share
 * mutable in-memory state across isolates. Without a distributed persistent store
 * (such as Redis or Cloudflare KV/Durable Objects), enforcing an exact 5-attempt per-token
 * quota cannot be reliably coordinated across distributed instances.
 *
 * To mitigate brute-force phone number enumeration and timing attacks without external state:
 * 1. Constant-time byte array comparison (constantTimeEqual) is enforced on phone digits.
 * 2. Uniform, fixed error message and status code (401 auth_failed) are returned with no variable delays.
 * 3. Token tampering and expiration are verified cryptographically before DB queries.
 * 4. Recommended production infrastructure defense: Upstream Cloudflare WAF / API Shield rate limiting
 *    rules on `/api/public/booking-pass/verify`.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: '잘못된 요청 형식입니다.',
        reason: 'invalid_input',
      },
      { status: 400, headers: securityHeaders },
    )
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const last4 = typeof body?.last4 === 'string' ? body.last4.trim() : ''

  if (!token || !last4) {
    return NextResponse.json(
      {
        ok: false,
        error: '토큰과 전화번호 뒤 4자리를 모두 입력해 주세요.',
        reason: 'invalid_input',
      },
      { status: 400, headers: securityHeaders },
    )
  }

  if (!/^\d{4}$/u.test(last4)) {
    return NextResponse.json(
      {
        ok: false,
        error: '전화번호 뒤 4자리는 숫자 4자리여야 합니다.',
        reason: 'invalid_format',
      },
      { status: 400, headers: securityHeaders },
    )
  }

  // Rate Limiting Guard: Prevent brute-force 0000~9999 enumeration.
  const clientIp = extractClientIp(request.headers)
  const tokenHash = await hashToken(token)
  const tokenKey = `token:${tokenHash}`
  const ipKey = clientIp ? `ip:${clientIp}` : null

  if (isBlocked(tokenKey) || (ipKey && isBlocked(ipKey))) {
    return NextResponse.json(
      {
        ok: false,
        error: '인증 시도 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.',
        reason: 'rate_limited',
      },
      { status: 429, headers: securityHeaders },
    )
  }

  // Security: Only PASS_TOKEN_SECRET is permitted. Never fallback to KAKAO_STATE_SECRET.
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

  const tokenVerify = await verifyPassToken(token, { secret })
  if (!tokenVerify.ok) {
    const status = tokenVerify.reason === 'expired' ? 401 : 401
    return NextResponse.json(
      {
        ok: false,
        error: tokenVerify.reason === 'expired' ? '만료된 토큰입니다.' : '유효하지 않은 토큰입니다.',
        reason: tokenVerify.reason,
      },
      { status, headers: securityHeaders },
    )
  }

  const { workspaceId, bookingId } = tokenVerify.payload
  const dbClient = createAdminSupabaseClient()

  // Query reservation from DB to check customer phone
  let resData: Record<string, unknown> | null = null
  try {
    const query = (dbClient as any)
      .from('reservations')
      .select('customer_phone')
      .eq('workspace_id', workspaceId)
      .eq('id', bookingId)

    const res = await query.maybeSingle()

    if (res?.error || !res?.data) {
      return NextResponse.json(
        {
          ok: false,
          error: '예약 정보를 찾을 수 없습니다.',
          reason: 'not_found',
        },
        { status: 404, headers: securityHeaders },
      )
    }
    resData = res.data as Record<string, unknown>
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: '예약 정보를 불러오지 못했습니다.',
        reason: 'db_error',
      },
      { status: 500, headers: securityHeaders },
    )
  }

  const customerPhone = typeof resData.customer_phone === 'string' ? resData.customer_phone : ''
  const phoneDigits = customerPhone.replace(/\D/gu, '')
  const actualLast4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : ''

  // Constant-time comparison between actualLast4 and user-provided last4
  const actualBytes = encoder.encode(actualLast4)
  const inputBytes = encoder.encode(last4)

  const isMatched = actualBytes.byteLength === 4 && constantTimeEqual(actualBytes, inputBytes)

  if (!isMatched) {
    recordFailure(tokenKey)
    if (ipKey) {
      recordFailure(ipKey)
    }
    return NextResponse.json(
      {
        ok: false,
        error: '전화번호 뒤 4자리가 일치하지 않습니다.',
        reason: 'auth_failed',
      },
      { status: 401, headers: securityHeaders },
    )
  }

  // Verification passed: reset failed attempts counter for token and client IP
  resetAttempts(tokenKey)
  if (ipKey) {
    resetAttempts(ipKey)
  }

  // Verification passed: return full unmasked booking pass details
  const fullPassResult = await resolveBookingPass(token, secret, dbClient, { verified: true })

  if (!fullPassResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: fullPassResult.error,
        reason: fullPassResult.reason,
      },
      { status: 400, headers: securityHeaders },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      pass: fullPassResult.pass,
    },
    { status: 200, headers: securityHeaders },
  )
}
