import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { safeAuthNextPath } from '../../../features/auth/safe-auth-next-path'
import { recordFunnelEvent } from '../../../features/quick-start/funnel-events'
import { readPublicEnv } from '../../../lib/env'
import type { Database } from '../../../lib/supabase/database.types'
import { getCookieDomain, getSharedCookieOptions } from '../../../lib/supabase/cookie-domain'

function callbackDestination(next: string | null): string {
  if (next === '/reset-password' || next === '/start') return next
  return safeAuthNextPath(next)
}

/**
 * ANI-1761 AC-3: 구글에서 돌아왔지만 세션이 없을 때 어디로 보낼지.
 *
 * - 가입 흐름(next=/start)에서 돌아온 사장님은 입력 보존을 위해 /signup 으로 되돌린다.
 *   로그인 화면으로 보내면 방금 채운 가게 정보가 사라진 것처럼 보인다.
 * - 그 밖에는 /login 으로 보내되, **취소(access_denied)와 실패를 구분**해서 넘긴다.
 *   둘을 같은 문구로 처리하면 사장님은 왜 다시 로그인 화면인지 알 수 없다.
 */
function noSessionDestination(next: string, providerError: string | null): string {
  const cancelled = providerError === 'access_denied'

  if (next === '/start') {
    const reason = cancelled ? 'access_denied' : 'server_error'
    return `/signup?error=${reason}&next=${encodeURIComponent(next)}`
  }

  const reason = cancelled ? 'oauth=cancelled' : 'oauth=failed'
  return `/login?${reason}&next=${encodeURIComponent(next)}`
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const providerError = request.nextUrl.searchParams.get('error')
  const next = callbackDestination(request.nextUrl.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL(noSessionDestination(next, providerError), request.url))
  }

  const destinationUrl = new URL(next, request.url)
  const response = NextResponse.redirect(destinationUrl)

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
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.session) {
      console.error('[auth/callback] Code exchange error:', {
        name: error?.name,
        message: error?.message,
        status: (error as any)?.status,
      })

      const failureResponse = NextResponse.redirect(new URL('/login?error=exchange_failed', request.url))
      const cookiesToClear = new Set<string>()

      for (const cookie of request.cookies.getAll()) {
        if (/^sb-.+-auth-token(\.\d+)?$/.test(cookie.name)) {
          cookiesToClear.add(cookie.name)
        }
      }

      try {
        const parsedUrl = new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL)
        const projectRef = parsedUrl.hostname.split('.')[0]
        if (projectRef) {
          const baseName = `sb-${projectRef}-auth-token`
          cookiesToClear.add(baseName)
          cookiesToClear.add(`${baseName}.0`)
          cookiesToClear.add(`${baseName}.1`)
        }
      } catch {
        // ignore malformed URL
      }

      for (const cookieName of cookiesToClear) {
        failureResponse.cookies.set(cookieName, '', {
          path: '/',
          maxAge: 0,
          sameSite: 'lax',
        })
      }

      return failureResponse
    }

    // 사용자 로그인 후 가입 상태 확인 및 분기 (ANI-554: Formal Signup State Machine)
    if (data.session.user && typeof supabase.from === 'function') {
      const userId = data.session.user.id

      // 1. 기존 워크스페이스 확인
      const { data: existingMemberships, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .limit(1)

      if (membershipError) throw membershipError
      const hasWorkspace = existingMemberships && existingMemberships.length > 0

      // 기존 사용자에게는 추가 혜택을 지급하지 않는다. 신규 가입만 원자적으로 생성한다.
      if (!hasWorkspace) {
        // 비밀번호 재설정 링크는 가입 플로우가 아니므로 새 워크스페이스를 만들지 않는다.
        if (next === '/reset-password') return response
        const { data: provisioned, error: provisionError } = await (supabase as any).rpc(
          'provision_signup_workspace',
          { p_user_id: userId, p_provider: data.session.user.app_metadata?.provider || 'google' },
        )
        if (provisionError?.message?.includes('SIGNUP_IN_PROGRESS')) {
          return NextResponse.redirect(new URL('/signup?step=business', request.url), { headers: response.headers })
        }
        if (provisionError || !provisioned?.workspace_id) {
          throw provisionError || new Error('워크스페이스를 생성하지 못했습니다.')
        }
        if (provisioned.is_new_workspace === true) {
          try {
            const { createAdminSupabaseClient } = await import('../../../lib/supabase/admin')
            await recordFunnelEvent({
              admin: createAdminSupabaseClient() as any,
              workspaceId: provisioned.workspace_id,
              userId,
              event: 'signup_completed',
              dedupeKey: `signup_completed:${userId}`,
            })
          } catch {
            // Funnel telemetry must never affect signup completion or its redirect.
          }
        }
        // ANI-1761 AC-3: 첫 구글 로그인 성공 복귀 — 무엇이 끝났는지 /start 에서 한 번 알린다.
        return NextResponse.redirect(new URL('/start?connected=1', request.url), { headers: response.headers })
      }

      // 기존 사용자: 원래 요청 경로를 존중한다.
      const wsId = existingMemberships[0].workspace_id

      // 기존 사용자라도 첫 포스팅 스타터 크레딧 보장 (ANI-1580: ensure_signup_starter_credits)
      try {
        const { createAdminSupabaseClient } = await import('../../../lib/supabase/admin')
        const adminClient = createAdminSupabaseClient()
        await (adminClient as any).rpc('ensure_signup_starter_credits', {
          p_user_id: userId,
          p_workspace_id: wsId,
        })
      } catch (starterErr) {
        console.warn('[auth/callback] ensure_signup_starter_credits failed:', starterErr)
      }

      const { data: profile } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('workspace_id', wsId)
        .maybeSingle()

      if ((!profile?.business_name || profile.business_name === '신규 매장') && next !== '/start' && next !== '/reset-password') {
        return NextResponse.redirect(new URL('/start?connected=1', request.url), {
          headers: response.headers,
        })
      }
    }
  } catch (err) {
    console.error('[auth/callback] Unexpected error:', err)
    return NextResponse.redirect(new URL('/login?error=callback_exception', request.url))
  }

  return response
}
