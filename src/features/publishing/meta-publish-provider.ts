import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { createInstagramProvider, createThreadsProvider, MetaProviderError } from '@/lib/providers/meta-api'
import type { PublishProviderErrorCode } from '@/lib/providers/publish-provider'
import type { ApprovedPublishMaterial } from './approved-publish-repository'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'

type Credential = Readonly<{
  accessToken: string
  provider: MetaOAuthChannel
  externalAccountId: string
  expiresAt: string | null
}>

type PublishDependencies = Readonly<{
  loadCredential(workspaceId: string, connectionId: string, channel: MetaOAuthChannel): Promise<Credential>
  instagramPublish(input: Parameters<ReturnType<typeof createInstagramProvider>['publish']>[0]): Promise<{ providerPostId: string; destinationUrl: string | null }>
  threadsPublish(input: Parameters<ReturnType<typeof createThreadsProvider>['publish']>[0]): Promise<{ providerPostId: string; destinationUrl: string | null }>
}>

export type MetaPublishProviderResult =
  | Readonly<{ ok: true; providerPostId: string; destinationUrl: string | null; errorCode: null }>
  | Readonly<{ ok: false; providerPostId: null; destinationUrl: null; errorCode: PublishProviderErrorCode }>

type PublishContext = Readonly<{
  reservation: Readonly<{
    workspaceId: string
    scheduleId: string
    channelConnectionId: string
    channel: MetaOAuthChannel
  }>
  material: ApprovedPublishMaterial
  onProviderRequestId?: (providerRequestId: string) => Promise<void>
}>

async function productionDependencies(): Promise<PublishDependencies> {
  const { loadChannelCredential } = await import('@/features/channels/credential-repository')
  const instagram = createInstagramProvider()
  const threads = createThreadsProvider()
  return {
    loadCredential: loadChannelCredential,
    instagramPublish: (input) => instagram.publish(input),
    threadsPublish: (input) => threads.publish(input),
  }
}

function failure(error: unknown): MetaPublishProviderResult {
  if (error instanceof MetaProviderError) {
    return { ok: false, providerPostId: null, destinationUrl: null, errorCode: error.diagnosticCode ?? error.code }
  }
  return { ok: false, providerPostId: null, destinationUrl: null, errorCode: 'PROVIDER_REJECTED' }
}

export async function publishApprovedMetaContent(
  context: PublishContext,
  providedDependencies?: PublishDependencies,
): Promise<MetaPublishProviderResult> {
  const { reservation, material } = context
  const payload = material.payload
  if (
    payload.workspaceId !== reservation.workspaceId
    || payload.scheduleId !== reservation.scheduleId
    || payload.channelConnectionId !== reservation.channelConnectionId
    || payload.channel !== reservation.channel
  ) return { ok: false, providerPostId: null, destinationUrl: null, errorCode: 'APPROVAL_STALE' }

  if (!isMetaLiveAllowed(reservation.workspaceId)) {
    return { ok: false, providerPostId: null, destinationUrl: null, errorCode: 'PROVIDER_REJECTED' }
  }

  try {
    const dependencies = providedDependencies ?? await productionDependencies()
    const credential = await dependencies.loadCredential(
      reservation.workspaceId,
      reservation.channelConnectionId,
      reservation.channel,
    )
    if (
      credential.provider !== reservation.channel
      || credential.externalAccountId !== payload.externalAccountId
      || (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= Date.now())
    ) throw new MetaProviderError('TOKEN_EXPIRED')

    const result = reservation.channel === 'instagram'
      ? await dependencies.instagramPublish({
          accountId: payload.externalAccountId,
          accessToken: credential.accessToken,
          caption: payload.text,
          imageUrls: material.mediaUrls,
          isAiGenerated: payload.isAiGenerated,
          onContainerCreated: context.onProviderRequestId,
        })
      : await dependencies.threadsPublish({
          accountId: payload.externalAccountId,
          accessToken: credential.accessToken,
          text: payload.text,
          imageUrls: material.mediaUrls,
          onContainerCreated: context.onProviderRequestId,
        })
    return {
      ok: true,
      providerPostId: result.providerPostId,
      destinationUrl: result.destinationUrl,
      errorCode: null,
    }
  } catch (error) {
    return failure(error)
  }
}
