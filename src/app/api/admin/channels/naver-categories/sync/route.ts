import { NextResponse } from 'next/server'
import { requireOperator, requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request?: Request) {
  try {
    let isAuthorized = false
    try {
      await requireOperatorAnyScope('channel.read')
      isAuthorized = true
    } catch {
      try {
        await requireOperator('channel.assist')
        isAuthorized = true
      } catch (err: unknown) {
        if (err instanceof OperatorAccessError && err.code === 'AUTH_REQUIRED') {
          return NextResponse.json({ error: 'AUTH_REQUIRED', message: '인증 세션이 필요합니다.' }, { status: 401 })
        }
        return NextResponse.json(
          { error: 'PERMISSION_DENIED', message: '운영자 권한이 필요합니다.' },
          { status: 403 },
        )
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'PERMISSION_DENIED', message: '운영자 권한이 필요합니다.' }, { status: 403 })
    }

    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 네이버 카테고리 동기화(채우기) 즉시 차단
    return naverAutomationBlocked('fill')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '카테고리 동기화 처리 중 오류가 발생했습니다.'
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
  }
}
