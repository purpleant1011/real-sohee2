export const dynamic = 'force-dynamic';
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createAuthorizationRequest, getMetaOAuthScopes, isExtendedMetaScopeAllowed, type MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { registerOAuthTransaction } from '@/features/channels/oauth/oauth-transaction-repository'
import { sealOAuthState } from '@/features/channels/oauth/oauth-state'
import { parseReturnPath } from '@/features/channels/oauth/return-paths'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCookieDomain } from '@/lib/supabase/cookie-domain'
import { expireLegacyOAuthCookies } from '@/features/channels/oauth/oauth-cookie-cleanup'

export const runtime = 'nodejs'

function parseChannel(value: string): MetaOAuthChannel | null {
  return value === 'instagram' || value === 'threads' ? value : null
}

function base64UrlRandom(bytes: number) {
  const value = crypto.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function appId(channel: MetaOAuthChannel) {
  return channel === 'instagram' ? process.env.INSTAGRAM_APP_ID : process.env.THREADS_APP_ID
}

export async function GET(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ channel: string }> }>,
) {
  const channel = parseChannel((await context.params).channel)
  if (!channel) return new Response('Not Found', { status: 404 })
  const returnPath = parseReturnPath(request.nextUrl.searchParams.get('returnPath'))
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return NextResponse.redirect(new URL(`${returnPath}?connect=forbidden`, request.url))
  }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  const userId = data.user?.id
  const clientId = appId(channel)
  const stateKey = process.env.META_OAUTH_STATE_ENCRYPTION_KEY
  const configuredAppUrl = process.env.APP_URL
  if (error || !userId || !clientId || !stateKey || !configuredAppUrl) {
    return NextResponse.redirect(new URL(`${returnPath}?connect=unavailable`, request.url))
  }
  const callback = new URL(`/api/channels/${channel}/callback`, configuredAppUrl).toString()
  const state = base64UrlRandom(32)
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  const correlationId = crypto.randomUUID()
  const extendedParam = request.nextUrl.searchParams.get('extended')
  const isExtended = isExtendedMetaScopeAllowed({
    workspaceId: workspace.workspaceId,
    role: workspace.role,
    env: process.env,
    extended: extendedParam === '1' || extendedParam === 'true',
  })
  const requestedScopes = getMetaOAuthScopes(channel, { extended: isExtended })

  const sealed = await sealOAuthState({
    channel,
    workspaceId: workspace.workspaceId,
    userId,
    state,
    expiresAt,
    returnPath,
    // Never consume a caller-supplied origin. The encrypted envelope binds our mobile host.
    returnOrigin: request.nextUrl.origin === 'https://m.example.com' ? 'https://m.example.com' : undefined,
  }, stateKey)

  await registerOAuthTransaction({
    state,
    workspaceId: workspace.workspaceId,
    actorUserId: userId,
    channel,
    requestedScopes,
    returnPath,
    correlationId,
    expiresAt,
  })

  const response = NextResponse.redirect(createAuthorizationRequest(channel, {
    appId: clientId,
    redirectUri: callback,
    state,
    scopes: requestedScopes,
  }))
  response.cookies.set(`sohee_meta_oauth_${channel}`, sealed, {
    domain: getCookieDomain(request.nextUrl.hostname),
    httpOnly: true,
    secure: new URL(configuredAppUrl).protocol === 'https:',
    sameSite: 'lax',
    path: `/api/channels/${channel}/callback`,
    maxAge: 10 * 60,
  })
  response.cookies.set(`sohee_meta_oauth_return_${channel}`, returnPath, {
    domain: getCookieDomain(request.nextUrl.hostname),
    httpOnly: true,
    secure: new URL(configuredAppUrl).protocol === 'https:',
    sameSite: 'lax',
    path: `/api/channels/${channel}/callback`,
    maxAge: 10 * 60,
  })
  expireLegacyOAuthCookies(response, channel, request.nextUrl)
  return response
}
