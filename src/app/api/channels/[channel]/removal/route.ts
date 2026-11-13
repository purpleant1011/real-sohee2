export const dynamic = 'force-dynamic';
import type { NextRequest } from 'next/server'
import { disconnectProviderAccount } from '@/features/channels/provider-callback-repository'
import { verifyMetaSignedRequest } from '@/features/channels/oauth/meta-signed-request'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'

export const runtime = 'nodejs'

function parseChannel(value: string): MetaOAuthChannel | null {
  return value === 'instagram' || value === 'threads' ? value : null
}

function secret(channel: MetaOAuthChannel) {
  return channel === 'instagram' ? process.env.INSTAGRAM_APP_SECRET : process.env.THREADS_APP_SECRET
}

export async function POST(request: NextRequest, context: Readonly<{ params: Promise<{ channel: string }> }>) {
  const channel = parseChannel((await context.params).channel)
  if (!channel) return new Response('Not Found', { status: 404 })
  const appSecret = secret(channel)
  if (!appSecret) return new Response('Unavailable', { status: 503 })
  const body = await request.formData()
  const value = body.get('signed_request')
  if (typeof value !== 'string') return new Response('Invalid', { status: 400 })
  try {
    const verified = await verifyMetaSignedRequest(value, appSecret)
    await disconnectProviderAccount({ channel, externalAccountId: verified.externalAccountId, reason: 'provider_removal' })
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch {
    return new Response('Invalid', { status: 400 })
  }
}
