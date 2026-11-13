import type { OperatorWorkspaceSummary } from './schemas'

export const LIFECYCLE_FILTER_VALUES = [
  'applied', 'information_pending', 'contract_review', 'consent_pending', 'channel_pending',
  'payment_pending', 'ready_for_activation', 'active', 'paused', 'terminated',
] as const

const HEALTHY = new Set(['connected', 'active', 'verified'])
// "unknown" means the workspace has no connection row at all; it is not a failure.
const NEUTRAL = new Set(['unknown', 'not_connected', 'pending'])

export type ChannelHealth = 'healthy' | 'none' | 'problem'

export function channelHealth(status: string): ChannelHealth {
  const value = status.toLowerCase()
  if (HEALTHY.has(value)) return 'healthy'
  if (NEUTRAL.has(value)) return 'none'
  return 'problem'
}

export type WorkspaceListSummary = Readonly<{
  loaded: number
  hasMore: boolean
  active: number
  channelProblems: number
  lowCredits: number
  creditUnknown: number
}>

/** Counts describe only the rows loaded on this page; callers must say so when hasMore is true. */
export function summarizeWorkspaces(
  items: readonly Pick<OperatorWorkspaceSummary, 'lifecycleStatus' | 'instagramStatus' | 'threadsStatus' | 'availableCredits'>[],
  hasMore: boolean,
): WorkspaceListSummary {
  return {
    loaded: items.length,
    hasMore,
    active: items.filter((w) => w.lifecycleStatus === 'active').length,
    channelProblems: items.filter((w) => channelHealth(w.instagramStatus) === 'problem' || channelHealth(w.threadsStatus) === 'problem').length,
    lowCredits: items.filter((w) => w.availableCredits !== null && w.availableCredits <= 0).length,
    creditUnknown: items.filter((w) => w.availableCredits === null).length,
  }
}
