export const dynamic = 'force-dynamic';
import { randomBytes } from 'node:crypto'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { createMetaDataDeletionRequest } from '@/features/data-deletion/repository'
import { verifyMetaSignedRequest } from '@/features/channels/oauth/meta-signed-request'

export const runtime = 'nodejs'

type RouteContext = Readonly<{ params: Promise<{ channel: string }> }>
type Dependencies = Readonly<{
  enabled: boolean
  appUrl: string | undefined
  secretFor(channel: MetaOAuthChannel): string | undefined
  verifySignedRequest(value: string, secret: string): Promise<{ externalAccountId: string }>
  generateConfirmationCode(): string
  createRequest(input: {
    provider: MetaOAuthChannel
    externalAccountId: string
    confirmationCode: string
  }): Promise<{ requestId: string }>
}>

function parseChannel(value: string): MetaOAuthChannel | null {
  return value === 'instagram' || value === 'threads' ? value : null
}

export function createProviderDeletionPostHandler(dependencies: Dependencies) {
  return async function post(request: Request, context: RouteContext) {
    const channel = parseChannel((await context.params).channel)
    if (!channel) return new Response('Not Found', { status: 404 })
    if (!dependencies.enabled) return new Response('Unavailable', { status: 503 })
    const appSecret = dependencies.secretFor(channel)
    if (!appSecret || !dependencies.appUrl) return new Response('Unavailable', { status: 503 })

    let value: FormDataEntryValue | null
    try {
      value = (await request.formData()).get('signed_request')
    } catch {
      return new Response('Invalid', { status: 400 })
    }
    if (typeof value !== 'string') return new Response('Invalid', { status: 400 })

    let externalAccountId: string
    try {
      externalAccountId = (await dependencies.verifySignedRequest(value, appSecret)).externalAccountId
    } catch {
      return new Response('Invalid', { status: 400 })
    }

    const confirmationCode = dependencies.generateConfirmationCode()
    try {
      await dependencies.createRequest({
        provider: channel,
        externalAccountId,
        confirmationCode,
      })
    } catch {
      return new Response('Unavailable', { status: 503 })
    }
    const statusUrl = new URL('/data-deletion/status', dependencies.appUrl)
    statusUrl.searchParams.set('code', confirmationCode)
    return Response.json({ url: statusUrl.toString(), confirmation_code: confirmationCode }, {
      headers: { 'cache-control': 'no-store' },
    })
  }
}

const production = createProviderDeletionPostHandler({
  enabled: process.env.META_DATA_DELETION_CALLBACK_ENABLED === 'true',
  appUrl: process.env.APP_URL,
  secretFor(channel) {
    return channel === 'instagram'
      ? process.env.INSTAGRAM_DATA_DELETION_APP_SECRET || process.env.INSTAGRAM_APP_SECRET
      : process.env.THREADS_DATA_DELETION_APP_SECRET || process.env.THREADS_APP_SECRET
  },
  verifySignedRequest: verifyMetaSignedRequest,
  generateConfirmationCode() {
    return randomBytes(24).toString('base64url')
  },
  createRequest: createMetaDataDeletionRequest,
})

export const POST = production
