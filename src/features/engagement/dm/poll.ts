import {
  getInstagramMessage,
  listInstagramConversationMessageIds,
  listInstagramConversations,
  type MetaFetch,
} from '@/lib/providers/meta-api'
import type { IngestDmMessageInput, IngestDmResult } from './ingest'
import type { InstagramDmRepository } from './repository'

const HOUR_MS = 3_600_000
const MAX_LOOKBACK_MS = 48 * HOUR_MS
const WATERMARK_OVERLAP_MS = HOUR_MS

export interface PollInstagramDmsDeps {
  listConversations: typeof listInstagramConversations
  listMessageIds: typeof listInstagramConversationMessageIds
  getMessage: typeof getInstagramMessage
  ingest: (input: IngestDmMessageInput) => Promise<IngestDmResult>
}

export interface PollInstagramDmsInput {
  workspaceId: string
  channelConnectionId: string
  businessIgId: string
  accessToken: string
  repo: Pick<InstagramDmRepository, 'latestThreadActivityAt' | 'findExistingProviderMessageIds'>
  fetcher?: MetaFetch
  now?: Date
  maxConversations?: number
  deps?: PollInstagramDmsDeps
}

export interface PollInstagramDmsResult {
  conversations: number
  ingested: number
  duplicates: number
  skipped: number
  failures: number
}

export async function pollInstagramDms(input: PollInstagramDmsInput): Promise<PollInstagramDmsResult> {
  const now = input.now ?? new Date()
  const maxConversations = input.maxConversations ?? 25
  const deps: PollInstagramDmsDeps = input.deps ?? {
    listConversations: listInstagramConversations,
    listMessageIds: listInstagramConversationMessageIds,
    getMessage: getInstagramMessage,
    ingest: () => { throw new Error('ingest dependency is required') },
  }
  const result: PollInstagramDmsResult = { conversations: 0, ingested: 0, duplicates: 0, skipped: 0, failures: 0 }

  const watermark = await input.repo.latestThreadActivityAt(input.workspaceId, input.channelConnectionId)
  const floor = now.getTime() - MAX_LOOKBACK_MS
  const cutoff = Math.max(floor, watermark ? Date.parse(watermark) - WATERMARK_OVERLAP_MS : floor)

  // Rate-limit and token errors from the listing call are deliberately not caught: the caller backs off.
  const listed = await deps.listConversations({ accessToken: input.accessToken, limit: maxConversations, fetcher: input.fetcher })
  const recent = listed.filter((c) => Date.parse(c.updatedTime) >= cutoff).slice(0, maxConversations)

  for (const conversation of recent) {
    result.conversations += 1
    try {
      const refs = await deps.listMessageIds({ conversationId: conversation.id, accessToken: input.accessToken, fetcher: input.fetcher })
      const existing = await input.repo.findExistingProviderMessageIds(input.workspaceId, refs.map((r) => r.id))
      const unseen = refs.filter((r) => !existing.has(r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const ref of unseen) {
        try {
          const message = await deps.getMessage({ messageId: ref.id, accessToken: input.accessToken, fetcher: input.fetcher })
          if (!message) { result.skipped += 1; continue }
          const outcome = await deps.ingest({
            workspaceId: input.workspaceId,
            channelConnectionId: input.channelConnectionId,
            businessIgId: input.businessIgId,
            mid: message.id,
            fromId: message.fromId,
            toId: message.toId,
            fromUsername: message.fromUsername ?? null,
            text: message.text,
            createdAt: message.createdAt,
          })
          if (outcome.status === 'ingested') result.ingested += 1
          else if (outcome.status === 'duplicate') result.duplicates += 1
          else result.skipped += 1
        } catch (error) {
          result.failures += 1
          console.warn('[pollInstagramDms] message skipped:', (error as Error)?.message)
        }
      }
    } catch (error) {
      result.failures += 1
      console.warn('[pollInstagramDms] conversation skipped:', (error as Error)?.message)
    }
  }
  return result
}
