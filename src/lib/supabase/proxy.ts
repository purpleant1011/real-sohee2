import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { readPublicEnv } from '@/lib/env'
import type { Database } from './database.types'
import { LEGACY_OPERATOR_COOKIE_NAME } from '@/features/operator-auth/legacy-cookie-name'
import { getCookieDomain, getSharedCookieOptions } from './cookie-domain'

function unavailableResponse(request: NextRequest) {
  const unavailableUrl = request.nextUrl.clone()
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`

  unavailableUrl.pathname = '/service-unavailable'
  unavailableUrl.search = ''
  unavailableUrl.searchParams.set('from', requestedPath)

  return NextResponse.redirect(unavailableUrl, 307)
}

export async function updateSession(request: NextRequest) {
  const started = performance.now()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-sohee-pathname', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  const requestWithPathname = { headers: requestHeaders }
  let response = NextResponse.next({ request: requestWithPathname })
  const clearLegacyCookie = request.nextUrl.pathname === '/admin-login'
  const finish = (result: NextResponse) => {
    // HTML 생성 이전의 세션 대기를 API 집계 시간과 구분한다. 인증 정보는 넣지 않는다.
    result.headers.append('Server-Timing', `session;dur=${Math.max(0, performance.now() - started).toFixed(1)}`)
    if (clearLegacyCookie) result.cookies.delete(LEGACY_OPERATOR_COOKIE_NAME)
    return result
  }

  try {
    const publicEnv = readPublicEnv()
    const allCookies = request.cookies.getAll()
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
            return allCookies
          },
          setAll(cookiesToSet, headers) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request: requestWithPathname })

            cookiesToSet.forEach(({ name, value, options }) => {
              const sharedOptions = getSharedCookieOptions(options, requestHost)
              response.cookies.set(name, value, sharedOptions)
            })
            Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
          },
        },
      },
    )

    // 갱신(setAll)이 request 쿠키를 덮어쓰기 전에 원본 Cookie 헤더로 같은 이름 중복을 센다.
    const duplicateAuthCookies = new Map<string, number>()
    if (cookieDomain) {
      for (const part of (request.headers.get('cookie') ?? '').split(';')) {
        const name = part.split('=')[0]?.trim()
        if (name && /^sb-.+-auth-token(\.\d+)?$/.test(name)) duplicateAuthCookies.set(name, (duplicateAuthCookies.get(name) ?? 0) + 1)
      }
    }
    await supabase.auth.getClaims()
    // .example.com 도메인 쿠키 도입 전의 호스트 전용 인증 쿠키가 같은 이름으로 남아 있으면 서버(API)가 낡은 쪽을 먼저 읽어 401 이 난다.
    // 두 벌이 확인될 때만 호스트 전용 쪽을 만료시킨다(한 벌뿐이면 건드리지 않는다).
    for (const [name, count] of duplicateAuthCookies) {
      if (count > 1) {
        // response.cookies 는 이름 기준이라 방금 쓴 도메인 쿠키를 덮어쓸 수 있어, 원시 Set-Cookie 로 따로 보낸다.
        response.headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure`)
      }
    }
    return finish(response)
  } catch (err) {
    console.warn('Supabase proxy initialization notice:', err)
    return finish(unavailableResponse(request))
  }
}

