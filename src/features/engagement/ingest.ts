import {
  listInstagramComments,
  listRecentPublishedMetaPosts,
  listThreadsReplies,
  type MetaFetch,
} from '@/lib/providers/meta-api'
import type { EngagementRepository } from './repository'
import type { SocialChannel, SocialComment } from './types'

export interface IngestChannelCommentsParams {
  workspaceId: string
  channelConnectionId: string
  channel: SocialChannel
  accessToken: string
  accountId: string
  accountHandle?: string
  accountUsername?: string
  repo: EngagementRepository
  fetcher?: MetaFetch
  mediaLimit?: number
  maxCommentAgeDays?: number
}

export interface IngestChannelCommentsResult {
  ingestedCount: number
  skippedCount?: number
  comments: SocialComment[]
}

export interface IngestWebhookCommentParams {
  workspaceId: string
  channelConnectionId: string
  channel: SocialChannel
  providerCommentId: string
  providerMediaId: string
  authorHandle: string
  authorId?: string | null
  commentText: string
  commentCreatedAt: string
  repo: EngagementRepository
  selfAccountId?: string | null
  selfAccountHandle?: string | null
  selfAccountUsername?: string | null
}

function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().replace(/^@+/, '').toLowerCase()
}

export function isSelfComment(
  comment: Readonly<{ authorId?: string | null; authorHandle?: string | null }>,
  self: Readonly<{
    accountId?: string | null
    accountHandle?: string | null
    accountUsername?: string | null
  }>
): boolean {
  const selfCandidates = new Set<string>()
  for (const raw of [self.accountId, self.accountHandle, self.accountUsername]) {
    const norm = normalizeIdentity(raw)
    if (norm) {
      selfCandidates.add(norm)
      // Extract primary handle if label has trailing metadata like "sohee.ai (Official)" or "@sohee.ai / 소희"
      const primaryToken = norm.split(/[\s(/]+/)[0]?.trim()
      if (primaryToken) {
        selfCandidates.add(primaryToken)
      }
    }
  }

  if (selfCandidates.size === 0) return false

  const authorId = normalizeIdentity(comment.authorId)
  if (authorId && selfCandidates.has(authorId)) {
    return true
  }

  const authorHandle = normalizeIdentity(comment.authorHandle)
  if (authorHandle && selfCandidates.has(authorHandle)) {
    return true
  }

  return false
}

export async function ingestChannelComments(
  params: IngestChannelCommentsParams
): Promise<IngestChannelCommentsResult> {
  const {
    workspaceId,
    channelConnectionId,
    channel,
    accessToken,
    accountId,
    accountHandle,
    accountUsername,
    repo,
    fetcher,
    mediaLimit = 10,
    maxCommentAgeDays = 7,
  } = params

  const ingestedComments: SocialComment[] = []
  let skippedCount = 0
  const effectiveAccountId = accountId && accountId.trim() ? accountId.trim() : 'me'

  let recentPosts: readonly { id: string }[] = []
  try {
    const posts = await listRecentPublishedMetaPosts({
      channel,
      accountId: effectiveAccountId,
      accessToken,
      fetcher,
    })
    recentPosts = posts.slice(0, mediaLimit)
  } catch (err) {
    console.warn(`[ingestChannelComments] Failed to list recent posts for ${channel}:`, err)
    return { ingestedCount: 0, skippedCount: 0, comments: [] }
  }

  const nowMs = Date.now()
  const maxAgeMs = maxCommentAgeDays > 0 ? maxCommentAgeDays * 86_400_000 : Infinity

  for (const post of recentPosts) {
    try {
      const comments = channel === 'instagram'
        ? await listInstagramComments({ mediaId: post.id, accessToken, limit: 50, fetcher })
        : await listThreadsReplies({ mediaId: post.id, accessToken, limit: 50, fetcher })

      for (const item of comments) {
        if (!item.text.trim()) continue

        if (Number.isFinite(maxAgeMs)) {
          const commentTime = Date.parse(item.timestamp)
          if (Number.isFinite(commentTime) && nowMs - commentTime > maxAgeMs) {
            continue
          }
        }

        if (isSelfComment(item, { accountId, accountHandle, accountUsername })) {
          skippedCount += 1
          continue
        }

        // Invariant 6: Store only comment id, media id, author handle label, text, timestamps
        const saved = await repo.upsertComment({
          workspace_id: workspaceId,
          channel_connection_id: channelConnectionId,
          channel,
          provider_comment_id: item.id,
          provider_media_id: post.id,
          author_handle: item.authorHandle,
          author_id: item.authorId ?? null,
          comment_text: item.text,
          comment_created_at: item.timestamp,
          classification: null,
          confidence: null,
          status: 'RECEIVED',
          failure_reason: null,
        })
        ingestedComments.push(saved)
      }
    } catch (commentErr) {
      console.warn(`[ingestChannelComments] Error reading comments for media ${post.id}:`, commentErr)
    }
  }

  return {
    ingestedCount: ingestedComments.length,
    skippedCount,
    comments: ingestedComments,
  }
}

export async function ingestWebhookComment(
  params: IngestWebhookCommentParams
): Promise<SocialComment | null> {
  const {
    workspaceId,
    channelConnectionId,
    channel,
    providerCommentId,
    providerMediaId,
    authorHandle,
    authorId,
    commentText,
    commentCreatedAt,
    repo,
    selfAccountId,
    selfAccountHandle,
    selfAccountUsername,
  } = params

  if (isSelfComment(
    { authorId, authorHandle },
    { accountId: selfAccountId, accountHandle: selfAccountHandle, accountUsername: selfAccountUsername }
  )) {
    return null
  }

  return repo.upsertComment({
    workspace_id: workspaceId,
    channel_connection_id: channelConnectionId,
    channel,
    provider_comment_id: providerCommentId,
    provider_media_id: providerMediaId,
    author_handle: authorHandle,
    author_id: authorId ?? null,
    comment_text: commentText,
    comment_created_at: commentCreatedAt,
    classification: null,
    confidence: null,
    status: 'RECEIVED',
    failure_reason: null,
  })
}
