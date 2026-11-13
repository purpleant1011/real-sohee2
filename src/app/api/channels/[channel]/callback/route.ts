export const dynamic = 'force-dynamic';
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { saveConnectedChannel } from '@/features/channels/credential-repository'
import {
  exchangeAuthorizationCode,
  toSafeMetaOAuthCallbackCode,
  type MetaOAuthChannel,
  type SafeMetaOAuthCallbackCode,
} from '@/features/channels/oauth/meta-oauth'
import { consumeOAuthTransaction } from '@/features/channels/oauth/oauth-transaction-repository'
import { openOAuthState, type OAuthStateContext } from '@/features/channels/oauth/oauth-state'
import { getCookieDomain } from '@/lib/supabase/cookie-domain'
import { expireLegacyOAuthCookies } from '@/features/channels/oauth/oauth-cookie-cleanup'
import { parseReturnPath } from '@/features/channels/oauth/return-paths'
import { verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { grantConnectedSignupCredits } from '@/features/membership/grant-connected-signup-credits'

export const runtime = 'nodejs'

function parseChannel(value: string): MetaOAuthChannel | null {
  return value === 'instagram' || value === 'threads' ? value : null
}

function oauthConfig(channel: MetaOAuthChannel) {
  return channel === 'instagram'
    ? { appId: process.env.INSTAGRAM_APP_ID, appSecret: process.env.INSTAGRAM_APP_SECRET }
    : { appId: process.env.THREADS_APP_ID, appSecret: process.env.THREADS_APP_SECRET }
}

function finish(
  request: NextRequest,
  result: 'connected' | 'authorized' | 'cancelled' | 'invalid' | 'unavailable',
  safeCode?: SafeMetaOAuthCallbackCode,
  returnPath = '/app/channels',
  accountLabel?: string,
  channel?: string,
  returnOrigin?: string,
) {
  const base = returnOrigin === 'https://m.example.com' && getCookieDomain(request.nextUrl.hostname)
    ? returnOrigin : request.url
  const destination = new URL(parseReturnPath(returnPath), base)
  destination.searchParams.set('connect', result)
  if (channel) destination.searchParams.set('channel', channel)
  if (accountLabel) destination.searchParams.set('account', accountLabel)
  if (safeCode) {
    destination.searchParams.set('connect_error', safeCode)
    destination.searchParams.set('error', safeCode)
  }
  const response = NextResponse.redirect(destination)
  response.headers.set('cache-control', 'no-store')
  return response
}

export async function GET(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ channel: string }> }>,
) {
  const channel = parseChannel((await context.params).channel)
  if (!channel) return new Response('Not Found', { status: 404 })
  const cookieName = `sohee_meta_oauth_${channel}`
  const returnCookieName = `sohee_meta_oauth_return_${channel}`
  const sealed = request.cookies.get(cookieName)?.value
  const returnPath = request.cookies.get(returnCookieName)?.value || '/app/channels'
  const stateKey = process.env.META_OAUTH_STATE_ENCRYPTION_KEY
  const state = request.nextUrl.searchParams.get('state')
  const code = request.nextUrl.searchParams.get('code')
  let failureCode: SafeMetaOAuthCallbackCode = 'META_OAUTH_INTERNAL'
  let envelope: OAuthStateContext | null = null
  if (sealed && stateKey && state) {
    try {
      const opened = await openOAuthState(sealed, stateKey)
      if (opened.channel === channel && opened.state === state) envelope = opened
    } catch {
      // Invalid state must not supply either a return origin or credential writes.
    }
  }
  const effectiveReturnPath = envelope?.returnPath || returnPath
  const returnOrigin = envelope?.returnOrigin

  const clearCookies = (res: NextResponse) => {
    for (const name of [cookieName, returnCookieName]) {
      res.cookies.set(name, '', {
        domain: getCookieDomain(request.nextUrl.hostname),
        path: `/api/channels/${channel}/callback`,
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'lax',
        maxAge: 0,
        expires: new Date(0),
      })
    }
    expireLegacyOAuthCookies(res, channel, request.nextUrl)
  }

  if (request.nextUrl.searchParams.has('error')) {
    const response = finish(request, 'cancelled', undefined, effectiveReturnPath, undefined, channel, returnOrigin)
    clearCookies(response)
    return response
  }
  if (!envelope || !state || !code || code.length > 4096) {
    const response = finish(request, 'invalid', undefined, effectiveReturnPath, undefined, channel, returnOrigin)
    clearCookies(response)
    return response
  }

  try {
    const responseOnFailure = finish(request, 'invalid', undefined, effectiveReturnPath, undefined, channel, returnOrigin)
    clearCookies(responseOnFailure)

    const workspace = await getCurrentWorkspaceContext()
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase.auth.getUser()
    if (
      !workspace || error || !data.user
      || workspace.workspaceId !== envelope.workspaceId
      || data.user.id !== envelope.userId
      || (workspace.role !== 'owner' && workspace.role !== 'manager')
    ) return responseOnFailure

    await consumeOAuthTransaction({
      state,
      workspaceId: envelope.workspaceId,
      actorUserId: envelope.userId,
      channel,
    })

    const config = oauthConfig(channel)
    const configuredAppUrl = process.env.APP_URL
    if (!config.appId || !config.appSecret || !configuredAppUrl) {
      const response = finish(request, 'unavailable', undefined, effectiveReturnPath, undefined, channel, returnOrigin)
      clearCookies(response)
      return response
    }

    const callback = new URL(`/api/channels/${channel}/callback`, configuredAppUrl).toString()
    failureCode = 'META_OAUTH_TOKEN_EXCHANGE'
    const connected = await exchangeAuthorizationCode(channel, {
      appId: config.appId,
      appSecret: config.appSecret,
      code,
      redirectUri: callback,
    })
    const now = Date.now()
    const expiresAt = connected.expiresInSeconds
      ? new Date(now + connected.expiresInSeconds * 1000).toISOString()
      : null
    const refreshAfter = connected.expiresInSeconds
      ? new Date(now + Math.min(30 * 24 * 60 * 60_000, connected.expiresInSeconds * 500)).toISOString()
      : null
    failureCode = 'META_OAUTH_PERSISTENCE'

    await saveConnectedChannel({
      workspaceId: workspace.workspaceId,
      actorUserId: data.user.id,
      actorRole: workspace.role,
      channel,
      externalAccountId: connected.externalAccountId,
      accountLabel: connected.accountLabel,
      accessToken: connected.accessToken,
      grantedScopes: connected.grantedScopes,
      expiresAt,
      refreshAfter,
    })

    try {
      await recordFunnelEvent({
        admin: createAdminSupabaseClient() as any,
        workspaceId: workspace.workspaceId,
        userId: data.user.id,
        event: 'channel_connected',
        properties: { channel },
        dedupeKey: `channel_connected:${workspace.workspaceId}:${channel}`,
      })
    } catch {
      // Funnel telemetry must never change the OAuth callback result.
    }

    // [ANI-1429] Genuine Post-OAuth Provider Capability Probe & Verification Run
    await verifyPostOAuthChannelCapability({
      workspaceId: workspace.workspaceId,
      channel,
      accessToken: connected.accessToken,
      providerAccountId: connected.externalAccountId,
      accountLabel: connected.accountLabel,
    }).catch((verificationErr) => {
      console.warn('[Meta OAuth Callback] Post-OAuth capability verification notice:', verificationErr)
    })

    // The credential repository leaves the connection 'authorized'. Only persist
    // 'connected' after OAuth credential storage, then let the RPC check connected SNS channels (at least 1).
    // The RPC is fail-closed; a failed status update must not result in a grant.
    try {
      const { error: connectionError } = await (createAdminSupabaseClient() as any)
        .from('channel_connections')
        .update({ status: 'connected' })
        .eq('workspace_id', workspace.workspaceId)
        .eq('channel', channel)
      if (connectionError) console.warn('[Meta OAuth Callback] Connection status update failed:', connectionError)
      else await grantConnectedSignupCredits(data.user.id, workspace.workspaceId)
    } catch (connectionError) {
      console.warn('[Meta OAuth Callback] Connection status update failed:', connectionError)
    }

    const response = finish(request, 'authorized', undefined, effectiveReturnPath, connected.accountLabel, channel, returnOrigin)
    clearCookies(response)
    return response
  } catch (error) {
    const safeCode = toSafeMetaOAuthCallbackCode(error, failureCode)
    console.error(`META_OAUTH_CALLBACK_FAILED:${safeCode}`)
    const response = finish(request, 'unavailable', safeCode, effectiveReturnPath, undefined, channel, returnOrigin)
    clearCookies(response)
    return response
  }
}
