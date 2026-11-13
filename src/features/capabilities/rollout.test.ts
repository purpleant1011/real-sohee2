import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEngagementFeatureOn, isEngagementWorkspaceAllowed } from '@/features/engagement/engagement-allowlist'

const workspace = '11111111-1111-4111-8111-111111111111'
afterEach(() => vi.unstubAllEnvs())

describe('capability rollout safety', () => {
  it('production wildcard is not permission to send to every workspace', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENGAGEMENT_WORKSPACE_ALLOWLIST', '*')
    expect(isEngagementWorkspaceAllowed(workspace)).toBe(false)
  })

  it('global kill switch stops an enabled send without hiding allowlist observations', () => {
    vi.stubEnv('ENGAGEMENT_WORKSPACE_ALLOWLIST', workspace)
    vi.stubEnv('ENGAGEMENT_SEND_ENABLED', '1')
    vi.stubEnv('KILL_SWITCH', '1')
    expect(isEngagementWorkspaceAllowed(workspace)).toBe(true)
    expect(isEngagementFeatureOn('ENGAGEMENT_SEND_ENABLED', workspace)).toBe(false)
  })
})
