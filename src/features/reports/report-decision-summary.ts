import type { CustomerConversation, ReportSnapshot, SocialPerformanceReport } from './types'

export type ReportDecisionSummary = Readonly<{
  observedPosts: number | null
  reactions: number | null
  reservations: number | null
  attentionItems: number
  checkedAt: string | null
  nextCollectionAt: string | null
}>

function postNeedsAttention(post: SocialPerformanceReport['posts'][number]) {
  return post.deliveryStatus === 'failed'
    || post.collectionStatus === 'failed'
    || post.collectionStatus === 'permission_denied'
    || post.metrics.some((metric) => metric.state === 'failed' || metric.state === 'permission_denied')
}

export function buildReportDecisionSummary(
  snapshot: ReportSnapshot,
  report: SocialPerformanceReport | undefined,
  conversations: readonly CustomerConversation[],
): ReportDecisionSummary {
  const nextCollectionAt = report?.posts
    .flatMap((post) => post.nextCollectionAt ? [post.nextCollectionAt] : [])
    .sort((left, right) => left.localeCompare(right))[0] ?? null
  const reactions = report === undefined
    ? null
    : report.posts.reduce((count, post) => count + post.reactions.length, report.unlinkedReactions.length)
  const attentionItems = (report?.posts.filter(postNeedsAttention).length ?? 0)
    + conversations.filter((conversation) => conversation.requiresHumanReview).length

  return Object.freeze({
    observedPosts: snapshot.metrics.observedPosts,
    reactions,
    reservations: snapshot.metrics.reservations,
    attentionItems,
    checkedAt: snapshot.checkedAt,
    nextCollectionAt,
  })
}
