import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { loadKakaoConfig, isAllowedRedirect } from '@/features/kakao/config/kakao-config'
import { isKakaoLoginEnabled } from '@/features/kakao/config/login-flag'
import {
  verifyOAuthState,
  exchangeKakaoCodeForToken,
  fetchKakaoUserProfile,
  resolveKakaoUser,
  issueKakaoSupabaseSession,
} from '@/features/kakao/oauth'
import { safeAuthNextPath } from '@/features/auth/safe-auth-next-path'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readPublicEnv } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'
import { getCookieDomain, getSharedCookieOptions } from '@/lib/supabase/cookie-domain'

export const dynamic = 'force-dynamic'

function makeRedirectResponse(
  destinationUrl: string,
  requestUrl: string,
  clearStateCookie = true,
): NextResponse {
  const url = new URL(destinationUrl, requestUrl)
  const res = NextResponse.redirect(url)
  if (clearStateCookie) {
    res.cookies.set('kakao_oauth_state', '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
    })
  }
  return res
}

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

  // state 서명 비밀은 별도 환경변수 KAKAO_STATE_SECRET 우선, 없으면 503 (clientSecret 재사용 금지)
  const stateSecret = config.stateSecret || process.env.KAKAO_STATE_SECRET?.trim()
  if (!stateSecret) {
    return NextResponse.json(
      { error: 'service_unavailable', reason: 'Missing KAKAO_STATE_SECRET' },
      { status: 503 },
    )
  }

  const searchParams = request.nextUrl.searchParams

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const providerError = searchParams.get('error')

  // 사용자가 동의를 취소했거나 카카오 오류가 발생한 경우
  if (providerError) {
    const errorReason = providerError === 'access_denied' ? 'kakao_cancelled' : 'kakao_error'
    return makeRedirectResponse(`/login?error=${errorReason}`, request.url)
  }

  if (!state || !code) {
    return makeRedirectResponse('/login?error=invalid_request', request.url)
  }

  // 1. state 쿠키 바인딩 및 HMAC 서명·만료 검증 (stateSecret 사용)
  const cookieState = request.cookies.get('kakao_oauth_state')?.value
  const verifyResult = await verifyOAuthState({
    state,
    cookieState,
    secret: stateSecret,
  })

  if (!verifyResult.ok) {
    return makeRedirectResponse('/login?error=invalid_state', request.url)
  }

  const { payload } = verifyResult

  // 2. redirect URI 재검증 (Open Redirect 방어)
  if (!isAllowedRedirect(payload.redirectUri, config)) {
    return makeRedirectResponse('/login?error=disallowed_redirect_uri', request.url)
  }

  // 3. 인가 코드 -> 토큰 교환
  const tokenResult = await exchangeKakaoCodeForToken({
    code,
    redirectUri: payload.redirectUri,
    config,
  })

  if (!tokenResult.ok) {
    return makeRedirectResponse('/login?error=token_exchange_failed', request.url)
  }

  // 4. 사용자 프로필 조회
  const profileResult = await fetchKakaoUserProfile({
    accessToken: tokenResult.tokens.access_token,
  })

  if (!profileResult.ok) {
    return makeRedirectResponse('/login?error=profile_fetch_failed', request.url)
  }

  const kakaoProfile = profileResult.profile

  // 5. 카카오 사용자 조회 (전체 페이지네이션 순회: kakao provider id 기준 조회 → 없으면 신규 생성, 이메일 동일 기존 계정이면 병합 금지로 거부)
  let adminClient: any
  try {
    adminClient = createAdminSupabaseClient()
  } catch (err) {
    console.error('[kakao/callback] createAdminSupabaseClient failed:', err)
    return makeRedirectResponse('/login?error=session_failed', request.url)
  }

  const resolveResult = await resolveKakaoUser(adminClient, {
    id: kakaoProfile.id,
    email:
      kakaoProfile.kakao_account?.is_email_verified === true &&
      kakaoProfile.kakao_account?.is_email_valid === true
        ? kakaoProfile.kakao_account?.email
        : undefined,
    nickname: kakaoProfile.kakao_account?.profile?.nickname,
    avatarUrl: kakaoProfile.kakao_account?.profile?.profile_image_url,
  })

  if (!resolveResult.ok) {
    if (resolveResult.reason === 'account_linking_prohibited') {
      return makeRedirectResponse('/login?error=account_linking_prohibited', request.url)
    }
    return makeRedirectResponse('/login?error=session_failed', request.url)
  }

  const { user } = resolveResult

  // 6. Supabase 세션 발급 및 쿠키 설정
  const defaultNext = safeAuthNextPath(payload.next) || '/app'
  const destinationUrl = new URL(defaultNext, request.url)
  const response = NextResponse.redirect(destinationUrl)

  // state 쿠키 정리
  response.cookies.set('kakao_oauth_state', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
  })

  try {
    const publicEnv = readPublicEnv()
    const requestHost = request.headers.get('host') ?? request.nextUrl.host
    const cookieDomain = getCookieDomain(requestHost)

    const supabase = createServerClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookieOptions: cookieDomain
          ? {
              domain: cookieDomain,
              path: '/',
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
            }
          : undefined,
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              const sharedOptions = getSharedCookieOptions(options, requestHost)
              response.cookies.set(name, value, sharedOptions)
            })
          },
        },
      },
    )

    const sessionResult = await issueKakaoSupabaseSession(adminClient, supabase, user)
    if (!sessionResult.ok) {
      console.error('[kakao/callback] Session issuance failed:', sessionResult.reason)
      return makeRedirectResponse('/login?error=session_failed', request.url)
    }

    // 7. 사용자 로그인 후 가입 상태 확인 및 워크스페이스 분기
    const userId = user.id
    if (typeof supabase.from === 'function') {
      const { data: existingMemberships, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .limit(1)

      if (membershipError) throw membershipError
      const hasWorkspace = existingMemberships && existingMemberships.length > 0

      // 신규 가입자: 워크스페이스 프로비저닝
      if (!hasWorkspace) {
        if (defaultNext === '/reset-password') return response

        const { data: provisioned, error: provisionError } = await (supabase as any).rpc(
          'provision_signup_workspace',
          { p_user_id: userId, p_provider: 'kakao' },
        )

        if (provisionError?.message?.includes('SIGNUP_IN_PROGRESS')) {
          return NextResponse.redirect(new URL('/signup?step=business', request.url), {
            headers: response.headers,
          })
        }

        if (provisionError || !provisioned?.workspace_id) {
          throw provisionError || new Error('워크스페이스를 생성하지 못했습니다.')
        }

        if (provisioned.is_new_workspace === true) {
          try {
            await recordFunnelEvent({
              admin: adminClient as any,
              workspaceId: provisioned.workspace_id,
              userId,
              event: 'signup_completed',
              dedupeKey: `signup_completed:${userId}`,
            })
          } catch {
            // Funnel telemetry failure must never block signup
          }
        }

        return NextResponse.redirect(new URL('/start?connected=kakao', request.url), {
          headers: response.headers,
        })
      }

      // 기존 사용자: 원래 요청 경로 존중 + 스타터 크레딧 보장
      const wsId = existingMemberships[0].workspace_id
      try {
        await (adminClient as any).rpc('ensure_signup_starter_credits', {
          p_user_id: userId,
          p_workspace_id: wsId,
        })
      } catch (starterErr) {
        console.warn('[kakao/callback] ensure_signup_starter_credits failed:', starterErr)
      }

      const { data: profile } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('workspace_id', wsId)
        .maybeSingle()

      if (
        (!profile?.business_name || profile.business_name === '신규 매장') &&
        defaultNext !== '/start' &&
        defaultNext !== '/reset-password'
      ) {
        return NextResponse.redirect(new URL('/start?connected=kakao', request.url), {
          headers: response.headers,
        })
      }
    }
  } catch (err) {
    console.error('[kakao/callback] Unexpected error during session/provisioning:', err)
    return makeRedirectResponse('/login?error=session_failed', request.url)
  }

  return response
}
