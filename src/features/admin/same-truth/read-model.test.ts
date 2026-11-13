import { describe, expect, it } from 'vitest'
import { buildMetric, readWorkspaceAndVaultCards } from './read-model'

const a = '81111111-1111-4111-8111-111111111111'
const b = '82222222-2222-4222-8222-222222222222'
const c = '83333333-3333-4333-8333-333333333333'
const now = new Date('2026-10-07T12:00:00Z')
const workspaces = [a, b, c].map((workspaceId) => ({ workspaceId, updatedAt: '2026-10-07T11:00:00Z' }))
const registry = [
  { workspace_id: a, dataset_mode: 'ACTUAL', actor_kind: 'CUSTOMER' },
  { workspace_id: b, dataset_mode: 'TEST', actor_kind: 'TESTER' },
  { workspace_id: c, dataset_mode: 'CANARY', actor_kind: 'OPERATOR' },
]

describe('admin same-truth cards', () => {
  it('never claims a fresh value without a source, valid freshness or known mode', () => {
    expect(buildMetric({ value: 1, source: null, freshness_at: now.toISOString(), dataset_mode: 'ACTUAL' }, now).status).toBe('UNKNOWN')
    expect(buildMetric({ value: 1, source: 'workspaces', freshness_at: null, dataset_mode: 'ACTUAL' }, now).status).toBe('UNKNOWN')
    expect(buildMetric({ value: 1, source: 'workspaces', freshness_at: 'invalid', dataset_mode: 'ACTUAL' }, now).status).toBe('UNKNOWN')
    expect(buildMetric({ value: 1, source: 'workspaces', freshness_at: '2026-10-06T11:00:00Z', dataset_mode: 'ACTUAL' }, now).status).toBe('STALE')
    expect(buildMetric({ value: 0, source: 'workspaces', freshness_at: now.toISOString(), dataset_mode: 'ACTUAL' }, now).status).toBe('FRESH')
    expect(buildMetric({ value: 1, source: 'workspaces', freshness_at: now.toISOString(), dataset_mode: null }, now).status).toBe('UNKNOWN')
    expect(buildMetric({ value: 1, source: 'workspaces', freshness_at: '2026-10-08T12:00:00Z', dataset_mode: 'ACTUAL' }, now).status).toBe('UNKNOWN')
  })

  it('uses immutable IDs, never display names, and excludes TEST/CANARY and non-customer owners before querying vault', async () => {
    const seen: (readonly string[])[] = []
    const cards = await readWorkspaceAndVaultCards({
      workspaces: workspaces.map((w) => ({ ...w, workspaceName: '같은 이름' })), nextCursor: null,
      gateway: {
        readRegistry: async () => registry,
        countVault: async (ids) => { seen.push(ids); return 3 },
      }, now,
    })
    expect(seen).toEqual([[a]])
    expect(cards.workspaces).toMatchObject({ value: 1, source: 'public.workspaces + public.workspace_registry', dataset_mode: 'ACTUAL', status: 'FRESH' })
    expect(cards.vault).toMatchObject({ value: 3, source: 'public.vault_items + public.workspace_registry', dataset_mode: 'ACTUAL', status: 'FRESH' })
  })

  it('fails closed when registry is missing, invalid or paginated; it never queries vault with unverified IDs', async () => {
    let calls = 0
    const gateway = { readRegistry: async () => registry.slice(0, 2), countVault: async () => { calls++; return 9 } }
    const missing = await readWorkspaceAndVaultCards({ workspaces, nextCursor: null, gateway, now })
    expect(missing.workspaces).toMatchObject({ value: null, status: 'UNKNOWN' })
    expect(missing.vault).toMatchObject({ value: null, status: 'UNKNOWN' })
    expect(calls).toBe(0)
    const partial = await readWorkspaceAndVaultCards({ workspaces, nextCursor: 'next', gateway, now })
    expect(partial.workspaces.status).toBe('UNKNOWN')
    expect(calls).toBe(0)
    const empty = await readWorkspaceAndVaultCards({ workspaces: [], nextCursor: null, gateway, now })
    expect(empty.workspaces).toMatchObject({ value: null, status: 'UNKNOWN' })
    const bad = await readWorkspaceAndVaultCards({ workspaces: [{ workspaceId: 'not-a-uuid', updatedAt: now.toISOString() }], nextCursor: null, gateway, now })
    expect(bad.workspaces.value).toBeNull()
    expect(calls).toBe(0)
  })

  it('does not present legacy UNCLASSIFIED ACTUAL rows as a fresh zero count', async () => {
    let calls = 0
    const cards = await readWorkspaceAndVaultCards({ workspaces: [workspaces[0]], nextCursor: null, gateway: {
      readRegistry: async () => [{ ...registry[0], actor_kind: 'UNCLASSIFIED' }],
      countVault: async () => { calls++; return 0 },
    }, now })
    expect(cards.workspaces).toMatchObject({ value: null, status: 'UNKNOWN' })
    expect(cards.vault).toMatchObject({ value: null, status: 'UNKNOWN' })
    expect(calls).toBe(0)
  })

  it('does not invent a zero ACTUAL total when only classified test/canary workspaces appear', async () => {
    const cards = await readWorkspaceAndVaultCards({ workspaces: [workspaces[1]], nextCursor: null, gateway: {
      readRegistry: async () => [registry[1]], countVault: async () => { throw new Error('must not read') },
    }, now })
    expect(cards.workspaces).toMatchObject({ value: null, status: 'UNKNOWN' })
    expect(cards.vault).toMatchObject({ value: null, status: 'UNKNOWN' })
  })

  it('reports read failure as UNKNOWN rather than a fabricated zero or empty vault', async () => {
    const cards = await readWorkspaceAndVaultCards({ workspaces: [workspaces[0]], nextCursor: null, gateway: {
      readRegistry: async () => registry.slice(0, 1), countVault: async () => { throw new Error('unavailable') },
    }, now })
    expect(cards.workspaces.value).toBe(1)
    expect(cards.vault).toMatchObject({ value: null, status: 'UNKNOWN', freshness_at: null })
    const noRegistry = await readWorkspaceAndVaultCards({ workspaces, nextCursor: null, gateway: {
      readRegistry: async () => { throw new Error('unavailable') }, countVault: async () => 42,
    }, now })
    expect(noRegistry.workspaces.value).toBeNull()
    expect(noRegistry.vault.value).toBeNull()
  })
})
