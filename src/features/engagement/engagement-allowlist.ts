import { parseMetaLiveAllowlist } from '@/lib/safety/meta-live-allowlist'

import { isEngagementRolloutEnabled, isWorkspaceInRollout } from '@/features/capabilities/registry'

/** Engagement-only rollout gate. Deliberately separate from META_LIVE_WORKSPACE_ALLOWLIST, which is '*' in production for publishing. */
export function isEngagementWorkspaceAllowed(workspaceId: string | null | undefined): boolean {
  return isWorkspaceInRollout(workspaceId, process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST)
}

export function getEngagementAllowlistStatus(): { configured: boolean; all: boolean; count: number } {
  const parsed = parseMetaLiveAllowlist(process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST)
  return { configured: parsed.isAll || parsed.count > 0, all: parsed.isAll, count: parsed.count }
}

/** Flag + allowlist, evaluated per workspace. */
export function isEngagementFeatureOn(
  flag: 'ENGAGEMENT_CYCLE_ENABLED' | 'ENGAGEMENT_SEND_ENABLED' | 'ENGAGEMENT_DM_INGEST_ENABLED',
  workspaceId: string | null | undefined
): boolean {
  return isEngagementRolloutEnabled(flag, workspaceId)
}
