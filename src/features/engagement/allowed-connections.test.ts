import { afterEach, describe, expect, it } from 'vitest'
import { filterAllowedConnections } from './allowed-connections'

const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000a2'
const conns = [
  { id: '1', workspace_id: A, channel: 'instagram' },
  { id: '2', workspace_id: B, channel: 'threads' },
]

describe('filterAllowedConnections', () => {
  const original = process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
  afterEach(() => {
    if (original === undefined) delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    else process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = original
  })

  it('returns nothing when the allowlist is empty (fail closed)', () => {
    delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    expect(filterAllowedConnections(conns)).toEqual([])
  })
  it('returns only allowlisted workspaces', () => {
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = A
    expect(filterAllowedConnections(conns).map((c) => c.id)).toEqual(['1'])
  })
  it('returns everything for the wildcard', () => {
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
    expect(filterAllowedConnections(conns)).toHaveLength(2)
  })
})
