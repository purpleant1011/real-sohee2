import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultItem, VaultEvent, VaultVariantPayload } from '../types'
import type { VaultSaveRepository } from '../model/save-repository'
import { saveToVault, onChannelVerified } from './save'

const WS = '11111111-1111-4111-8111-111111111111'
const CONTENT = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

function fixture() {
  const items: VaultItem[] = []
  const payloads: VaultVariantPayload[] = []
  const events: VaultEvent[] = []
  let contentWorkspace = WS
  let versionId = VERSION
  let verified = false
  let providerReviewStatus: 'PENDING' | 'APPROVED' = 'PENDING'
  let draftsRead = 0
  let images = [{ position: 0, type: 'image' as const, mimeType: 'image/jpeg', sizeBytes: 1234, renditionContentDigest: 'a'.repeat(64) }]
  const repository = {
    async getDraft(workspaceId: string, contentId: string, requestedVersionId: string) {
      draftsRead++
      if (workspaceId !== contentWorkspace || contentId !== CONTENT || requestedVersionId !== versionId) return null
      return { workspaceId: WS, contentId: CONTENT, versionId: VERSION, title: '우리 가게', caption: '어서 오세요', hashtags: ['소희'], validUntil: null, media: images }
    },
    async findByIdempotencyKey(workspaceId: string, key: string) { return items.find(i => i.workspaceId === workspaceId && i.idempotencyKey === key) ?? null },
    async createItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) {
      const prior = items.find(i => i.workspaceId === item.workspaceId && i.idempotencyKey === item.idempotencyKey)
      if (prior) return { item: prior, created: false }
      const saved: VaultItem = { ...item, id: String(items.length + 1), createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
      items.push(saved)
      return { item: saved, created: true }
    },
    async putVariantPayload(payload: Omit<VaultVariantPayload, 'id' | 'createdAt' | 'updatedAt'>) {
      const existing = payloads.find(p => p.vaultItemId === payload.vaultItemId)
      if (existing) return existing
      const result = { ...payload, id: String(payloads.length + 1), createdAt: '', updatedAt: '' }; payloads.push(result); return result
    },
    async appendEvent(event: Omit<VaultEvent, 'id' | 'occurredAt'>) { const row = { ...event, id: String(events.length + 1), occurredAt: '' }; events.push(row); return row },
    async listEvents(workspaceId: string, itemId: string) { return events.filter(e => e.workspaceId === workspaceId && e.vaultItemId === itemId) },
    async listItems(workspaceId: string) { return items.filter(i => i.workspaceId === workspaceId) },
    async getVariantPayload(workspaceId: string, itemId: string) { return payloads.find(p => p.workspaceId === workspaceId && p.vaultItemId === itemId) ?? null },
    async updateItem(workspaceId: string, itemId: string, changes: Partial<VaultItem>) { const row = items.find(i => i.workspaceId === workspaceId && i.id === itemId)!; Object.assign(row, changes); return row },
    async getChannelTruth() { return { instagram: { verified, accountId: verified ? 'ig-123' : null }, threads: { verified: false, accountId: null }, naver_blog: { verified: false, accountId: null }, daangn_business: { verified: false, accountId: null } } },
    async getProviderReviewStatus() { return providerReviewStatus },
  } as unknown as VaultSaveRepository
  const telemetry = vi.fn().mockResolvedValue(undefined)
  return { repository, telemetry, items, payloads, events, get draftsRead() { return draftsRead }, setContentWorkspace: (value: string) => { contentWorkspace = value }, setVersionId: (value: string) => { versionId = value }, setVerified: (value: boolean) => { verified = value }, setReview: (value: 'PENDING' | 'APPROVED') => { providerReviewStatus = value }, setImages: (value: typeof images) => { images = value } }
}

const request = (channels: string[] = ['instagram'], key = 'save-123', actorRole = 'manager' as 'owner' | 'manager' | 'reviewer' | 'viewer') => ({ workspaceId: WS, actorId: USER, actorRole, contentId: CONTENT, versionId: VERSION, channels, targetDate: null, idempotencyKey: key })

describe('ANI-1528 vault save: external publication is never attempted', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') })) })
  it.each(['viewer', 'reviewer'] as const)('service layer rejects %s with a Korean 403 and writes nothing (defense in depth)', async role => {
    const db = fixture()
    await expect(saveToVault(request(['instagram'], 'save-role', role), { repository: db.repository, recordEvent: db.telemetry })).rejects.toMatchObject({ status: 403, message: '이 작업은 매장 관리자만 할 수 있어요.' })
    expect(db.items).toHaveLength(0)
    expect(db.events).toHaveLength(0)
  })
  it.each(['owner', 'manager'] as const)('service layer allows %s', async role => {
    const db = fixture()
    await expect(saveToVault(request(['instagram'], 'save-ok', role), { repository: db.repository, recordEvent: db.telemetry })).resolves.toMatchObject({ external_posts: 0 })
  })
  it('saves a channel variant, fingerprint and event with provider mocked unavailable and zero external posts', async () => {
    const db = fixture()
    const result = await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    expect(result).toMatchObject({ saved: [{ channel: 'instagram', release_gate_label: '앱 심사를 기다리는 중 · 외부 게시 전' }], rejected: [], external_posts: 0 })
    expect(db.items).toHaveLength(1)
    expect(db.items[0]).toMatchObject({ approvalState: 'APPROVED', fingerprintSchemaVersion: 3, releaseGate: 'HELD_PROVIDER_PENDING', policyVersion: expect.any(String) })
    expect(db.items[0].approvedFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(db.payloads).toHaveLength(1)
    expect(db.payloads[0].payload.settings).toMatchObject({ approved_target_account_id: `unconnected:${WS}:instagram`, approved_policy_versions: { 'vault-save': 'vault-save-v1', 'channel-spec': '2026.10.1' }, valid_until: null })
    expect(db.events.map(e => e.eventType)).toEqual(['vault.saved'])
    expect(db.telemetry.mock.calls.map(c => c[0].event)).toEqual(['vault.saved'])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns the same row for repeated keys, without duplicating payload or event', async () => {
    const db = fixture()
    const first = await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    const second = await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    expect(second).toEqual(first)
    expect(db.items).toHaveLength(1)
    expect(db.payloads).toHaveLength(1)
    expect(db.events).toHaveLength(1)
  })
  it('rejects only invalid channel and keeps the valid channel with independent idempotency keys', async () => {
    const db = fixture(); db.setImages([])
    const result = await saveToVault(request(['naver_blog', 'threads', 'daangn_business']), { repository: db.repository, recordEvent: db.telemetry })
    expect(result.saved.map(s => s.channel)).toEqual(['threads', 'daangn_business'])
    expect(result.rejected).toEqual([{ channel: 'naver_blog', reason_label: '네이버 블로그는 제목과 이미지가 필요해요' }])
    expect(result.external_posts).toBe(0)
    expect(db.items).toHaveLength(2)
    expect(new Set(db.items.map(i => i.idempotencyKey)).size).toBe(2)
    expect(db.telemetry.mock.calls.map(c => c[0].event)).toContain('vault.save_failed')
    const replay = await saveToVault(request(['naver_blog', 'threads', 'daangn_business']), { repository: db.repository, recordEvent: db.telemetry })
    expect(replay).toEqual(result)
    expect(db.items).toHaveLength(2)
  })
  it('does not read cross-workspace content and returns not found', async () => {
    const db = fixture(); db.setContentWorkspace('other')
    await expect(saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })).rejects.toMatchObject({ status: 404 })
    expect(db.items).toHaveLength(0)
  })
  it('fails closed if persistence fails; never reports a saved item', async () => {
    const db = fixture()
    db.repository.putVariantPayload = async () => { throw new Error('db fail') }
    await expect(saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })).rejects.toMatchObject({ status: 500 })
    expect(db.telemetry.mock.calls.at(-1)?.[0]).toMatchObject({ event: 'vault.save_failed', properties: { reason: 'PERSISTENCE_ERROR' } })
  })
  it('replays a saved approval even if provider and connection status have changed since approval', async () => {
    const db = fixture()
    const first = await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    db.setVerified(true); db.setReview('APPROVED')
    const replay = await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    expect(replay).toEqual(first)
    expect(db.items).toHaveLength(1)
  })
  it('rejects reuse of one key with a different content request instead of aliasing another approval', async () => {
    const db = fixture()
    await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    await expect(saveToVault({ ...request(), targetDate: '2026-12-01' }, { repository: db.repository, recordEvent: db.telemetry })).rejects.toMatchObject({ status: 409 })
    expect(db.items).toHaveLength(1)
  })
  it('re-evaluates connection after verification without triggering publication or auto-releasing approvals', async () => {
    const db = fixture(); db.setReview('APPROVED')
    await saveToVault(request(), { repository: db.repository, recordEvent: db.telemetry })
    expect(db.items[0].releaseGate).toBe('HELD_CONNECTION_PENDING')
    db.setVerified(true)
    await onChannelVerified({ repository: db.repository })(WS, 'instagram')
    expect(db.items[0].releaseGate).toBe('HELD_USER')
    expect(db.items[0].approvalState).toBe('NEEDS_REAPPROVAL')
    expect(fetch).not.toHaveBeenCalled()
  })
})
