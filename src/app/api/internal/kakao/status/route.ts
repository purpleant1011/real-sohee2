import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isKakaoLoginEnabled } from '@/features/kakao/config/login-flag'
import { evaluateAlimtalkReadiness } from '@/features/kakao/notify/readiness'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const REQUIRED_ALIMTALK_KEYS = [
  'SOLAPI_API_KEY',
  'SOLAPI_API_SECRET',
  'SOLAPI_PF_ID',
] as const

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') || ''
  if (!cronSecret || cronSecret.length < 20 || !authHeader.startsWith('Bearer ')) {
    return false
  }

  const token = authHeader.slice(7)
  const left = Buffer.from(token)
  const right = Buffer.from(cronSecret)
  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401, headers: NO_STORE })
  }

  const kakaoLogin = isKakaoLoginEnabled(process.env)

  const missing: string[] = []
  for (const key of REQUIRED_ALIMTALK_KEYS) {
    const val = process.env[key]
    if (typeof val !== 'string' || val.trim().length === 0) {
      missing.push(key)
    }
  }

  // NOTE: 기존 alimtalk.enabled는 SafeAlimtalkAdapterWrapper / SolapiAlimtalkAdapter 생성 시
  // 어댑터 활성화 여부를 결정하는 factory 플래그일 뿐입니다(SOLAPI_ENABLED === 'true' && 기본 키 3종 존재).
  // 하위 호환성을 위해 이 값의 의미를 임의로 변경하지 않으며, 템플릿 매핑·웹훅 시크릿·사전 승인 등
  // 실제 운영 발송 준비 상태는 아래 readiness 하위 필드를 통해 판정합니다.
  const isEnabledFlag = process.env.SOLAPI_ENABLED === 'true'
  const enabled = isEnabledFlag && missing.length === 0
  const dryRun = !enabled

  const webhookSecret = process.env.SOLAPI_WEBHOOK_SECRET
  const webhookSecretConfigured =
    typeof webhookSecret === 'string' && webhookSecret.trim().length > 0

  const readiness = evaluateAlimtalkReadiness(process.env)

  return NextResponse.json(
    {
      kakaoLogin,
      alimtalk: {
        enabled,
        missing,
        dryRun,
      },
      webhookSecretConfigured,
      readiness,
    },
    {
      status: 200,
      headers: NO_STORE,
    },
  )
}
