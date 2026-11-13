import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMobileHome, readMobileApproval, type MobileReadDeps } from './read-model'
import { ready, unknown } from '../contracts'

const ctx = { workspaceId: 'workspace-a', userId: 'user-a' }
const now = '2026-10-16T01:00:00Z'
function dependencies(): MobileReadDeps {
  return {
    now: () => now,
    readIdentity: async () => ({ businessName: '테스트 매장', timeZone: null }),
    readAgent: async () => unknown(),
    readDecisions: async () => ready({ items: [], total: 0, complete: true }, now),
    readActivity: async () => ready([], now),
    readResults: async () => unknown(),
    readApproval: async () => null,
  }
}
afterEach(() => vi.useRealTimers())
describe('mobile read model', () => {
  it.each(['readIdentity', 'readAgent', 'readDecisions', 'readActivity', 'readResults'] as const)('bounds a stalled %s without discarding other domains', async domain => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps[domain] = () => new Promise<never>(() => {})
    let view: Awaited<ReturnType<typeof readMobileHome>> | undefined
    void readMobileHome(ctx, deps).then(result => { view = result })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(view?.workspaceId).toBe('workspace-a')
    if (domain === 'readIdentity') expect(view?.businessName).toBeNull()
    if (domain === 'readAgent') expect(view?.agent.state).toBe('error')
    if (domain === 'readDecisions') expect(view?.decisions).toMatchObject({ state: 'error', data: null })
    if (domain === 'readActivity') expect(view?.activity.state).toBe('error')
    if (domain === 'readResults') expect(view?.results.state).toBe('error')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('returns successful domains when one query never settles', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.readResults = () => new Promise(() => {})
    let view: Awaited<ReturnType<typeof readMobileHome>> | undefined
    void readMobileHome(ctx, deps).then(result => { view = result })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(view).toBeDefined()
    expect(view?.results).toMatchObject({ state: 'error', data: null })
    expect(view?.decisions).toMatchObject({ state: 'ready', data: { total: 0, complete: true } })
    expect(view?.businessName).toBe('테스트 매장')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains successful domains without converting failed queries to empty', async () => {
    const deps = dependencies()
    deps.readDecisions = async () => { throw new Error('private database error') }
    const view = await readMobileHome(ctx, deps)
    expect(view.decisions).toMatchObject({ state: 'error', data: null })
    expect(view.activity).toMatchObject({ state: 'ready', data: [] })
    expect(JSON.stringify(view)).not.toContain('private database error')
  })
  it('returns unknown identity without claiming another workspace identity', async () => {
    const deps = dependencies()
    deps.readIdentity = async () => { throw new Error('offline') }
    const view = await readMobileHome(ctx, deps)
    expect(view.workspaceId).toBe('workspace-a')
    expect(view.businessName).toBeNull()
    expect(view.timeZone).toBeNull()
  })
  it('rejects invalid keys and refuses cross-workspace details', async () => {
    const deps = dependencies()
    deps.readApproval = async () => ({ workspaceId: 'workspace-b', id: 'dm:bad' } as never)
    expect(await readMobileApproval(ctx, 'dm:00000000-0000-4000-8000-000000000001', deps)).toBeNull()
    expect(await readMobileApproval(ctx, 'recall:person', deps)).toBeNull()
  })
})
