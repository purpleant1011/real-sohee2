import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runServerNotificationOutbox } from '@/features/kakao/notify/outbox-server-runtime'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AuthCheckResult =
  | { authorized: true }
  | { authorized: false; status: 401 | 503; error: string }

function checkCronSecretAuth(request: Request): AuthCheckResult {
  const cronSecret = process.env.CRON_SECRET

  // 1. CRON_SECRET 미설정 또는 최소 길이 미충족 시 503 (서비스 설정 미비)
  if (!cronSecret || cronSecret.length < 20) {
    return {
      authorized: false,
      status: 503,
      error: 'CRON_SECRET 미설정 또는 구성 불완전',
    }
  }

  // 2. Authorization Bearer 헤더 검증
  const authHeader = request.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return {
      authorized: false,
      status: 401,
      error: '인증 실패',
    }
  }

  const token = authHeader.slice(7)
  const left = Buffer.from(token)
  const right = Buffer.from(cronSecret)

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return {
      authorized: false,
      status: 401,
      error: '인증 실패',
    }
  }

  return { authorized: true }
}

/**
 * 카카오 알림톡 Outbox 배치 내부 실행 엔드포인트
 *
 * [보안 및 안정성 원칙]
 * 1. 인증: CRON_SECRET 기반 Bearer timingSafeEqual 검증 (누락 시 503, 인증 실패 시 401).
 * 2. POST 단독 허용: 배치 실행 변경 작업을 위해 POST 메서드만 수신.
 * 3. 외부 주입 차단: limit은 서버 고정(20)이며, request body의 flags, payload, phone 주입을 일체 배제.
 * 4. PII 및 시크릿 은닉: 반환 응답은 통계 counts만 포함하며 민감 정보를 유출하지 않음.
 * 5. 오류 격리: 처리 중 예외 발생 시 고정 500 에러 메시지 반환.
 * 6. 본 엔드포인트의 존재는 실제 라이브 발송 승인을 의미하지 않습니다.
 */
export async function POST(request: Request) {
  // 1. 인증 및 secret 설정 검증
  const auth = checkCronSecretAuth(request)
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    )
  }

  // 2. 서버 런타임 배치 실행 (외부 body 주입 일절 배제, 서버 고정 limit 20 적용)
  try {
    const result = await runServerNotificationOutbox()

    // 3. 통계 카운트만 안전하게 반환 (no env / phone / name / secrets)
    return NextResponse.json(
      {
        enabled: result.enabled,
        processed: result.processed,
        counts: result.counts,
        errors: result.errors,
        expired: result.expired,
      },
      {
        status: 200,
        headers: NO_STORE,
      },
    )
  } catch {
    // 4. 예외 발생 시 내부 스택이나 민감 텍스트 없이 고정 메시지로 500 반환
    return NextResponse.json(
      { error: '내부 서버 오류' },
      { status: 500, headers: NO_STORE },
    )
  }
}
