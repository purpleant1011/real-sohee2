import { describe, expect, it } from 'vitest'
import { channelHealth, summarizeWorkspaces } from './list-summary'

const row = (over: Record<string, unknown>) => ({
  lifecycleStatus: 'active' as const, instagramStatus: 'connected', threadsStatus: 'connected', availableCredits: 100, ...over,
})

describe('channelHealth', () => {
  it('separates healthy, absent and failing connections', () => {
    expect(channelHealth('connected')).toBe('healthy')
    expect(channelHealth('unknown')).toBe('none')
    expect(channelHealth('not_connected')).toBe('none')
    expect(channelHealth('expired')).toBe('problem')
    expect(channelHealth('revoked')).toBe('problem')
  })
})

describe('summarizeWorkspaces', () => {
  it('counts only what the loaded rows prove', () => {
    const s = summarizeWorkspaces([
      row({}),
      row({ lifecycleStatus: 'paused', instagramStatus: 'expired' }),
      row({ threadsStatus: 'error', availableCredits: 0 }),
      row({ lifecycleStatus: null, instagramStatus: 'unknown', threadsStatus: 'unknown', availableCredits: null }),
    ], true)
    expect(s).toEqual({ loaded: 4, hasMore: true, active: 2, channelProblems: 2, lowCredits: 1, creditUnknown: 1 })
  })

  it('does not treat missing credits as low credits', () => {
    expect(summarizeWorkspaces([row({ availableCredits: null })], false).lowCredits).toBe(0)
  })
})
