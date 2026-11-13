export type RecentContentSignal = Readonly<{ hook: string; topic: string }>
export type ContinuitySignals = Readonly<{ repetitionRisk: 'low' | 'medium' | 'high'; reasons: readonly string[] }>

export function calculateContinuitySignals(
  recentPosts: readonly RecentContentSignal[],
  proposedDraft: RecentContentSignal,
): ContinuitySignals {
  const sameHook = recentPosts.slice(0, 3).filter((post) => post.hook.trim() === proposedDraft.hook.trim()).length
  const sameTopic = recentPosts.slice(0, 3).filter((post) => post.topic.trim() === proposedDraft.topic.trim()).length
  if (sameHook >= 3) return { repetitionRisk: 'high', reasons: ['recent_hook_repeated', ...(sameTopic > 0 ? ['recent_topic_repeated'] : [])] }
  if (sameHook >= 2 || sameTopic >= 2) return { repetitionRisk: 'medium', reasons: [sameHook >= 2 ? 'recent_hook_repeated' : 'recent_topic_repeated'] }
  return { repetitionRisk: 'low', reasons: [] }
}

export async function listContinuitySignals(
  recentPosts: readonly RecentContentSignal[], proposedDraft: RecentContentSignal,
): Promise<ContinuitySignals> {
  return calculateContinuitySignals(recentPosts, proposedDraft)
}
