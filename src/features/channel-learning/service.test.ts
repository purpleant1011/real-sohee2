import { describe, expect, it } from 'vitest'
import { createLearningService } from './service'
import { LearningError } from './contracts'
import type { LearningRepository } from './repository'
import { tenantASource, TENANT_A_USER_ID, tenantALease } from './test-fixtures'

const actor = { workspaceId: tenantASource.workspaceId, userId: TENANT_A_USER_ID, role: 'owner' }
const sourceId = tenantASource.sourceId
function repository(overrides: Partial<LearningRepository> = {}): LearningRepository {
  return {
    async listSources() { return [tenantASource] }, async loadSource() { return tenantASource },
    async loadCandidates() { return [] }, ...overrides,
  } as LearningRepository
}
const adapters = {
  normalizeUrl() { return { canonicalIdentity: 'shop', canonicalUrl: 'https://www.instagram.com/shop/' } },
  getCapabilities() { return [{ platform: 'instagram' as const, verificationMethods: ['oauth' as const], collectionMode: 'official_api' as const, blockerCode: null }] },
}

describe('learning application service', () => {
  it('lists only authorized workspace sources with current capability matrix', async () => {
    const service = createLearningService(repository(), adapters)
    const result = await service('list', actor, {})
    expect(result).toEqual({ sources: [tenantASource], capabilities: adapters.getCapabilities() })
  })
  it('returns the registered source inside the shared browser DTO envelope', async () => {
    const service = createLearningService(repository({ async registerSource() { return tenantASource } }), adapters)
    const result = await service('register', actor, { platform: 'instagram', url: 'https://instagram.com/shop/', consent: { text: true, images: false } })
    expect(result).toEqual({ source: tenantASource })
  })
  it('refuses stale source mutations before external verification', async () => {
    let verified = 0
    const service = createLearningService(repository(), { ...adapters, async verify() { verified++; return tenantALease } })
    await expect(service('verify', actor, { sourceId, revision: 100 })).rejects.toMatchObject({ code: 'STALE_REVISION' })
    expect(verified).toBe(0)
  })
  it('does not accept collection when no durable queue transport is available', async () => {
    const service = createLearningService(repository(), adapters)
    await expect(service('collect', actor, { sourceId, revision: tenantASource.revision })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
  it('rejects a foreign source even if a service-role gateway returns it', async () => {
    const service = createLearningService(repository({ async loadSource() { return { ...tenantASource, workspaceId: sourceId } } }), adapters)
    await expect(service('detail', actor, { sourceId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('maps safe domain failures without forwarding database or provider text', async () => {
    const service = createLearningService(repository({ async loadSource() { throw new LearningError('STALE_SOURCE_REVISION', 'private SQL token') } }), adapters)
    await expect(service('verify', actor, { sourceId, revision: 1 })).rejects.toMatchObject({ code: 'STALE_REVISION' })
    try { await service('verify', actor, { sourceId, revision: 1 }) } catch (error) {
      expect(String(error)).not.toContain('private SQL')
    }
  })
  it('maps OAUTH_NOT_CONNECTED to safe CONNECTION_REQUIRED (409) without raw provider details', async () => {
    const service = createLearningService(repository(), {
      ...adapters,
      async verify() {
        throw new LearningError('OAUTH_NOT_CONNECTED', 'Raw token missing for account 9999')
      },
    })
    await expect(service('verify', actor, { sourceId, revision: tenantASource.revision })).rejects.toMatchObject({
      code: 'CONNECTION_REQUIRED',
    })
  })
})
