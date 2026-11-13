import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createProductionLearningAdapters } from './production'
import type { LearningRepository } from './repository'
import { tenantASource, tenantALease } from './test-fixtures'

const source = { ...tenantASource, canonicalIdentity: 'shop', platform: 'instagram' as const, lease: null }
const actor = { workspaceId: source.workspaceId, userId: '33333333-3333-4333-8333-333333333333', role: 'owner' }
const now = '2026-11-10T00:00:00.000Z'
function options() {
  return {
    repository: {} as LearningRepository,
    enabled: false,
    now: () => new Date(now),
    async getCredential() { return { accessToken: 'private-token', scopes: ['instagram_business_basic'], providerAccountId: '123', expiresAt: '2026-11-11T00:00:00.000Z' } },
    async providerFetch() { return { id: '123', username: 'shop' } },
    async getQueue() { return null },
  }
}

describe('production learning adapters', () => {
  it('normalizes profile identity without exposing credentials in capability responses', () => {
    const adapters = createProductionLearningAdapters(options())
    expect(adapters.normalizeUrl('instagram', 'https://instagram.com/shop/').canonicalIdentity).toBe('shop')
    expect(JSON.stringify(adapters.getCapabilities())).not.toContain('private-token')
  })
  it('uses decrypted server credentials and official me identity for ownership', async () => {
    const adapters = createProductionLearningAdapters(options())
    const lease = await adapters.verify!(source, actor)
    expect(lease.providerAccountId).toBe('123')
    expect(lease.sourceId).toBe(source.sourceId)
    expect(lease.expiresAt).toBe('2026-11-11T00:00:00.000Z')
  })
  it('refuses collection while runtime has not been enabled and verified', async () => {
    const adapters = createProductionLearningAdapters(options())
    await expect(adapters.enqueue!(source, actor, 'collect')).rejects.toMatchObject({ code: 'CAPABILITY_BLOCKED' })
  })
  it('requires a real queue binding before creating a durable collection job', async () => {
    const adapters = createProductionLearningAdapters({ ...options(), enabled: true })
    await expect(adapters.enqueue!({ ...source, lease: tenantALease }, actor, 'collect')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
  it('creates durable pending job for deletion even if queue is unavailable', async () => {
    const createdJobs: any[] = []
    const repository = {
      async createJob(input: any) {
        const record = { id: 'job-del-1', ...input, status: 'pending' }
        createdJobs.push(record)
        return record
      },
    } as unknown as LearningRepository

    const adapters = createProductionLearningAdapters({ ...options(), enabled: true, repository })
    const res = await adapters.enqueue!(source, actor, 'delete')
    expect(res.jobId).toBe('job-del-1')
    expect(createdJobs).toHaveLength(1)
    expect(createdJobs[0].kind).toBe('delete')
  })
})
