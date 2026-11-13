import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerIdentityResolutionGraph } from './customer-identity-graph'
import type { ChannelIdentity } from './types'

const identity = (value: string): ChannelIdentity => ({
  type: 'INSTAGRAM_HANDLE', value, sourceChannel: 'instagram',
  firstSeenAt: '2026-10-21T00:00:00Z', lastSeenAt: '2026-10-21T00:00:00Z', confidenceScore: 1,
})
afterEach(() => vi.unstubAllEnvs())

describe('ANI-1587 / ANI-1624 CRM workspace boundaries (W3 repro)', () => {
  it('never resolves shared handles to another workspace customer', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('same-fixture') })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('same-fixture') })
    expect(b.workspaceId).toBe('B')
    expect(b.customerId).not.toBe(a.customerId)
  })
  it('does not merge across workspaces through matching phone hints', () => {
    const graph = new CustomerIdentityResolutionGraph()
    graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a'), customerHints: { phone: 'fixture-phone' } })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('fixture-b'), customerHints: { phone: 'fixture-phone' } })
    expect(b.workspaceId).toBe('B')
  })
  it('rejects forced cross-workspace merge even with known customer IDs', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a') })
    const b = graph.resolveAndLink({ workspaceId: 'B', identity: identity('fixture-b') })
    expect(() => graph.mergeCustomers(a.customerId, b.customerId)).toThrow()
    expect(() => graph.mergeCustomers(a.customerId, b.customerId, 'A')).toThrow()
  })
  it('requires workspace scope on lookup/get and merge', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a') })
    const b = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-b') })
    expect(graph.lookupByIdentity('INSTAGRAM_HANDLE', 'fixture-a')).toBeUndefined()
    expect(graph.lookupByIdentity('INSTAGRAM_HANDLE', 'fixture-a', 'B')).toBeUndefined()
    expect(graph.getCustomer(a.customerId)).toBeUndefined()
    expect(graph.getCustomer(a.customerId, 'B')).toBeUndefined()
    expect(() => graph.mergeCustomers(a.customerId, b.customerId)).toThrow()
  })
  it('preserves within-workspace resolution and explicit scoped reads', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity(' First '), customerHints: { phone: 'fixture-phone' } })
    const same = graph.resolveAndLink({ workspaceId: 'A', identity: identity('second'), customerHints: { phone: 'fixture-phone' } })
    expect(same.customerId).toBe(a.customerId)
    expect(graph.lookupByIdentity('INSTAGRAM_HANDLE', ' first ', 'A')?.customerId).toBe(a.customerId)
    expect(graph.getCustomer(a.customerId, 'A')?.workspaceId).toBe('A')
  })
  it('does not expose internal mutable records that can change workspace identity', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a') })
    a.workspaceId = 'B'
    a.identities[0].value = 'tampered'
    const found = graph.getCustomer(a.customerId, 'A')
    expect(found?.workspaceId).toBe('A')
    expect(found?.identities[0].value).toBe('fixture-a')
  })
  it('preserves phone aliases during a same-workspace explicit merge', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a'), customerHints: { phone: 'phone-a' } })
    const b = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-b') })
    graph.mergeCustomers(a.customerId, b.customerId, 'A')
    expect(graph.lookupByIdentity('PHONE_NUMBER', 'phone-a', 'A')?.customerId).toBe(b.customerId)
    expect(graph.getCustomer(a.customerId, 'A')).toBeUndefined()
  })
  it('does not delete a customer when an explicit merge targets itself', () => {
    const graph = new CustomerIdentityResolutionGraph()
    const a = graph.resolveAndLink({ workspaceId: 'A', identity: identity('fixture-a') })
    graph.mergeCustomers(a.customerId, a.customerId, 'A')
    expect(graph.getCustomer(a.customerId, 'A')?.customerId).toBe(a.customerId)
  })
  it('blocks the in-memory domain helper in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => new CustomerIdentityResolutionGraph()).toThrow('CRM_DOMAIN_ONLY')
  })
})
