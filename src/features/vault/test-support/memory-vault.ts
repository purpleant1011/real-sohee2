import type { VaultSaveRepository, VaultDraft } from '../model/save-repository'
import type { EditMutation, VaultEditRepository } from '../edit'
import { saveToVault } from '../service/save'
import type { VaultChannel, VaultEvent, VaultItem, VaultVariantPayload } from '../types'

/**
 * Test-only in-memory storage behind the real save and edit services.
 * Rules (fingerprints, invalidation, specs, labels) run for real; only the database is replaced,
 * so UI flow tests exercise the same behavior the routes do.
 */
export const MEMORY_WORKSPACE = '11111111-1111-4111-8111-111111111111'
export const MEMORY_ACTOR = '44444444-4444-4444-8444-444444444444'
const CONTENT = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const DEFAULT_DRAFT: Omit<VaultDraft, 'workspaceId' | 'contentId' | 'versionId'> = {
  title: '가을 신메뉴', caption: '밤 라떼가 나왔어요', hashtags: ['카페', '가을'], validUntil: null,
  media: [{ position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 1234, renditionContentDigest: 'a'.repeat(64) }],
}

export function createMemoryVault(draft: Partial<typeof DEFAULT_DRAFT> = {}) {
  const items: VaultItem[] = []
  const payloads: VaultVariantPayload[] = []
  const events: VaultEvent[] = []
  const saveRepository = {
    async getDraft() { return { workspaceId: MEMORY_WORKSPACE, contentId: CONTENT, versionId: VERSION, ...DEFAULT_DRAFT, ...draft } },
    async findByIdempotencyKey(_workspaceId: string, key: string) { return items.find((item) => item.idempotencyKey === key) ?? null },
    async createItem(input: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) {
      const item: VaultItem = { ...input, id: uuid(items.length + 1), createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
      items.push(item)
      return { item, created: true }
    },
    async putVariantPayload(input: Omit<VaultVariantPayload, 'id' | 'createdAt' | 'updatedAt'>) {
      const payload: VaultVariantPayload = { ...input, id: uuid(100 + payloads.length), createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
      payloads.push(payload)
      return payload
    },
    async appendEvent(event: Omit<VaultEvent, 'id' | 'occurredAt'>) { const row = { ...event, id: uuid(200 + events.length), occurredAt: '2026-10-07T00:00:00Z' }; events.push(row); return row },
    async listEvents(_workspaceId: string, itemId: string) { return events.filter((event) => event.vaultItemId === itemId) },
    async listItems() { return [...items] },
    async getVariantPayload(_workspaceId: string, itemId: string) { return payloads.find((payload) => payload.vaultItemId === itemId) ?? null },
    async updateItem(_workspaceId: string, itemId: string, changes: Partial<VaultItem>) { const row = items.find((item) => item.id === itemId)!; Object.assign(row, changes); return row },
    async getChannelTruth() { return { instagram: { verified: false, accountId: null }, threads: { verified: false, accountId: null }, naver_blog: { verified: false, accountId: null }, daangn_business: { verified: false, accountId: null } } },
    async getProviderReviewStatus() { return 'PENDING' as const },
  } as unknown as VaultSaveRepository

  const editRepository: VaultEditRepository = {
    async getItem(workspaceId, id) { return workspaceId === MEMORY_WORKSPACE ? items.find((item) => item.id === id) ?? null : null },
    async getPayload(workspaceId, id) { return workspaceId === MEMORY_WORKSPACE ? payloads.find((payload) => payload.vaultItemId === id) ?? null : null },
    async listImageCandidates() { return items.filter((item) => !item.deletedAt) },
    async changeMany(_workspaceId: string, mutations: readonly EditMutation[]) {
      if (mutations.some((mutation) => items.find((item) => item.id === mutation.item.id)?.updatedAt !== mutation.expectedVersion)) return null
      const versions: Record<string, string> = {}
      for (const mutation of mutations) {
        const index = items.findIndex((item) => item.id === mutation.item.id)
        items[index] = { ...items[index], ...mutation.changes, updatedAt: new Date(Date.parse(items[index].updatedAt) + 1000).toISOString() }
        versions[mutation.item.id] = items[index].updatedAt
        if (mutation.payload) {
          const at = payloads.findIndex((payload) => payload.vaultItemId === mutation.item.id)
          payloads[at] = { ...payloads[at], payload: mutation.payload }
        }
        events.push({ id: uuid(200 + events.length), workspaceId: MEMORY_WORKSPACE, vaultItemId: mutation.item.id, actorId: MEMORY_ACTOR, occurredAt: '2026-10-07T00:00:00Z', eventType: mutation.event.eventType, payload: mutation.event.payload })
      }
      return versions
    },
  }

  return {
    items, payloads, events, saveRepository, editRepository,
    /** Runs the real save service for these channels (the same payloads production writes). */
    async save(channels: readonly VaultChannel[], key = `memory-${items.length}`) {
      return saveToVault({ workspaceId: MEMORY_WORKSPACE, actorId: MEMORY_ACTOR, contentId: CONTENT, versionId: VERSION, channels, targetDate: null, idempotencyKey: key }, { repository: saveRepository })
    },
  }
}
