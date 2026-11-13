import { describe, expect, it } from 'vitest'
import { CustomerIdentityResolutionGraph } from '../../src/features/crm/customer-identity-graph'
import type { ChannelIdentity } from '../../src/features/crm/types'

const identity = (value: string): ChannelIdentity => ({
  type: 'INSTAGRAM_HANDLE', value, sourceChannel: 'instagram',
  firstSeenAt: '2026-10-21T00:00:00Z', lastSeenAt: '2026-10-21T00:00:00Z', confidenceScore: 1,
})

describe('ANI-1587 CRM workspace boundary (W9-owned implementation)', () => {
  it('never resolves a shared channel identity to another workspace customer', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('same-fixture') })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('same-fixture') })
    expect(b.workspaceId).toBe('B')
    expect(b.customerId).not.toBe(a.customerId)
  })
  it('does not merge across workspace boundaries via matching phone hints', () => {
    const graph = new CustomerIdentityResolutionGraph()
    graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a'), customerHints: { phone: 'fixture-phone' } })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('fixture-b'), customerHints: { phone: 'fixture-phone' } })
    expect(b.workspaceId).toBe('B')
  })
  it('rejects a forced cross-workspace merge', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a') })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('fixture-b') })
    expect(() => graph.mergeCustomers(a.customerId, b.customerId)).toThrow()
  })
})
