import { NextRequest, NextResponse } from 'next/server'
import { loadKakaoConfig } from '@/features/kakao/config/kakao-config'
import { isKakaoLoginEnabled } from '@/features/kakao/config/login-flag'
import {
  buildKakaoAuthorizeUrl,
  createOAuthState,
} from '@/features/kakao/oauth'
import { safeAuthNextPath } from '@/features/auth/safe-auth-next-path'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isKakaoLoginEnabled(process.env)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const configResult = loadKakaoConfig(process.env)
  if (!configResult.ok) {
    return NextResponse.json(
      { error: 'service_unavailable', reason: configResult.reason },
      { status: 503 },
    )
  }

  const { config } = configResult
  const searchParams = request.nextUrl.searchParams

  // 기본 콜백 URI는 설정된 첫 번째 redirectUri 사용
  const requestedRedirectUri = searchParams.get('redirect_uri')
  const redirectUri = requestedRedirectUri?.trim() || config.redirectUris[0]

  const nextParam = searchParams.get('next')
  const safeNext = safeAuthNextPath(nextParam)

  const stateSecret = config.stateSecret || process.env.KAKAO_STATE_SECRET?.trim()
  if (!stateSecret) {
    return NextResponse.json(
      { error: 'service_unavailable', reason: 'Missing KAKAO_STATE_SECRET' },
      { status: 503 },
    )
  }

  const stateResult = await createOAuthState({
    redirectUri,
    next: safeNext,
    secret: stateSecret,
    ttlSeconds: 300,
  })

  const urlResult = buildKakaoAuthorizeUrl({
    config,
    redirectUri,
    state: stateResult.state,
  })

  if (!urlResult.ok) {
    return NextResponse.json(
      { error: urlResult.reason },
      { status: 400 },
    )
  }

  const response = NextResponse.redirect(urlResult.url)

  response.cookies.set('kakao_oauth_state', stateResult.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: stateResult.maxAge,
  })

  return response
}
