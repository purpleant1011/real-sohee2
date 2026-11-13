import type { NormalizedMetaEvent } from '@/features/meta-webhooks/handler'
import type { IngestDmMessageInput } from './ingest'

export function dmInputFromWebhookEvent(
  event: NormalizedMetaEvent,
  ctx: { workspaceId: string; channelConnectionId: string },
): IngestDmMessageInput | null {
  if (event.provider !== 'instagram' || event.category !== 'dm') return null
  const customerId = event.externalSubjectId
  const mid = event.providerEventId
  if (!customerId || !mid) return null

  const payload = event.payload as Record<string, unknown>
  const isEcho = payload.isEcho === true
  const businessIgId = event.externalAccountId
  // Preserve provider participants: never rewrite a mismatched recipient into our business account.
  if (!businessIgId || event.instagramAccountId !== businessIgId ||
    payload.recipientId !== (isEcho ? customerId : businessIgId) || customerId === businessIgId) return null
  return {
    workspaceId: ctx.workspaceId,
    channelConnectionId: ctx.channelConnectionId,
    businessIgId,
    mid,
    fromId: isEcho ? businessIgId : customerId,
    toId: isEcho ? customerId : businessIgId,
    text: typeof payload.text === 'string' ? payload.text : null,
    createdAt: event.occurredAt,
    isEcho,
    isSelf: payload.isSelf === true,
    isDeleted: payload.isDeleted === true,
  }
}
