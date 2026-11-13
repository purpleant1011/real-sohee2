import { evaluateReadiness } from '@/features/readiness'
import type { ReadinessBlocker, SoheeReadinessFactKey, SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

// Pure rules shared with client pages; must never import server-only modules (supabase/server, next/headers).
/**
 * First-post ("quick lane") readiness.
 *
 * A brand-new owner must be able to publish a first, owner-approved post within minutes, so this lane
 * requires only:
 *   - at least ONE verified channel (Instagram OR Threads), and
 *   - the four quick-start facts (knowledge / text / image / operating policy) created by the quick-start API.
 *
 * NTS business verification is intentionally NOT required here; it stays required for the autonomous
 * (owner-absent) lane that continues to use `requireSoheeReady`.
 */
const QUICK_FACTS: readonly SoheeReadinessFactKey[] = [
  'BUSINESS_KNOWLEDGE_CONFIRMED',
  'TEXT_HARNESS_CONFIRMED',
  'IMAGE_HARNESS_CONFIRMED',
  'OPERATING_POLICY_CONFIRMED',
]

const CHANNEL_BLOCKER: ReadinessBlocker = {
  code: 'INSTAGRAM_NOT_VERIFIED',
  factKey: 'INSTAGRAM_VERIFIED',
  message: '인스타그램 또는 스레드를 하나 이상 연결해 주세요.',
  remediationAction: '채널 연결하기',
  remediationHref: '/start?step=channels',
}

export function evaluateFirstPostReadiness(snapshot: SoheeReadinessSnapshot): SoheeReadinessSnapshot {
  const blockers = snapshot.blockers.filter((b) => QUICK_FACTS.includes(b.factKey))
  const channelOk = evaluateReadiness(snapshot).verifiedChannels.length > 0
  if (!channelOk) blockers.push(CHANNEL_BLOCKER)
  return { ...snapshot, ready: blockers.length === 0, blockers }
}
