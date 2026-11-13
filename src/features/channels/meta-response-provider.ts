import 'server-only'

import { loadChannelCredential } from './credential-repository'
import type { MetaCredentialCapability } from './oauth/meta-oauth'
import type { ClaimedResponse } from './response-delivery-repository'
import { createInstagramProvider, createThreadsProvider } from '@/lib/providers/meta-api'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'

type LoadedCredential = Awaited<ReturnType<typeof loadChannelCredential>>
type InstagramAdapter = Pick<ReturnType<typeof createInstagramProvider>, 'sendCommentReply' | 'sendDirectMessage'>
type ThreadsAdapter = Pick<ReturnType<typeof createThreadsProvider>, 'sendReply'>

type Dependencies = Readonly<{
  loadCredential: (workspaceId: string, connectionId: string, provider: 'instagram' | 'threads', capability: MetaCredentialCapability) => Promise<LoadedCredential>
  instagram: InstagramAdapter
  threads: ThreadsAdapter
}>

function productionDependencies(): Dependencies {
  return {
    loadCredential: (workspaceId, connectionId, provider, capability) =>
      loadChannelCredential(workspaceId, connectionId, provider, undefined, undefined, capability),
    instagram: createInstagramProvider(),
    threads: createThreadsProvider(),
  }
}

export async function sendApprovedMetaResponse(
  claim: ClaimedResponse,
  providedDependencies?: Dependencies,
  signal?: AbortSignal,
): Promise<Readonly<{ providerReference: string }>> {
  signal?.throwIfAborted()
  if (!isMetaLiveAllowed(claim.workspaceId)) {
    throw new Error('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
  }

  const dependencies = providedDependencies ?? productionDependencies()
  const capability = {
    instagram_comment_reply: 'comment_reply',
    instagram_dm: 'message',
    threads_reply: 'reply',
  } as const
  const credential = await dependencies.loadCredential(
    claim.workspaceId, claim.connectionId, claim.provider, capability[claim.responseKind],
  )
  signal?.throwIfAborted()
  if (credential.provider !== claim.provider || credential.externalAccountId !== claim.externalAccountId) {
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }

  if (claim.responseKind === 'instagram_comment_reply') {
    if (claim.provider !== 'instagram') throw new Error('채널 연결 정보를 확인해 주세요.')
    const result = await dependencies.instagram.sendCommentReply({
      accountId: credential.externalAccountId,
      targetId: claim.externalTargetId,
      accessToken: credential.accessToken,
      text: claim.draftText,
      ...(signal ? { signal } : {}),
    })
    return Object.freeze({ providerReference: result.providerReplyId })
  }
  if (claim.responseKind === 'instagram_dm') {
    if (claim.provider !== 'instagram') throw new Error('채널 연결 정보를 확인해 주세요.')
    const result = await dependencies.instagram.sendDirectMessage({
      accountId: credential.externalAccountId,
      recipientId: claim.externalTargetId,
      accessToken: credential.accessToken,
      text: claim.draftText,
      ...(signal ? { signal } : {}),
    })
    return Object.freeze({ providerReference: result.providerMessageId })
  }
  if (claim.responseKind === 'threads_reply') {
    if (claim.provider !== 'threads') throw new Error('채널 연결 정보를 확인해 주세요.')
    const result = await dependencies.threads.sendReply({
      accountId: credential.externalAccountId,
      targetId: claim.externalTargetId,
      accessToken: credential.accessToken,
      text: claim.draftText,
      ...(signal ? { signal } : {}),
    })
    return Object.freeze({ providerReference: result.providerReplyId })
  }
  claim.responseKind satisfies never
  throw new Error('지원하지 않는 응답 방식입니다.')
}
