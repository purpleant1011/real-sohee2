import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { createKnowledgeJournalGetHandler } from '@/features/sohee-studio/knowledge-journal-request.server'
import { journalSourceTypes, journalSourceKinds, KNOWLEDGE_JOURNAL_NOTICE } from '@/features/sohee-studio/knowledge-journal'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const client = {} as ServerSupabaseClient
const context = { params: Promise.resolve({ workspaceId }) }
const value = { workspaceId, observedAt: '2026-10-30T00:00:00Z', entries: [], sources: journalSourceTypes.map(sourceType => ({ sourceType, kind: journalSourceKinds[sourceType], state: 'confirmed_empty', returnedCount: 0 })), partial: false, notice: KNOWLEDGE_JOURNAL_NOTICE }
describe('private workspace knowledge journal API', () => {
  it('returns the authorized scope without writing or caching private history', async () => {
    const load = vi.fn().mockResolvedValue(value)
    const handler = createKnowledgeJournalGetHandler({ authorize: async () => ({ workspaceId, client }), load })
    const response = await handler(new Request('https://example.com/api/journal?limit=20'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(load).toHaveBeenCalledExactlyOnceWith({ client, workspaceId, limit: 20 })
    expect(await response.json()).toMatchObject({ data: value })
  })
  it('preserves authentication denial without loading source data', async () => {
    const load = vi.fn()
    const handler = createKnowledgeJournalGetHandler({ authorize: async () => new Response('forbidden', { status: 403 }), load })
    const response = await handler(new Request('https://example.com/api/journal'), context)
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(load).not.toHaveBeenCalled()
  })
  it('rejects a foreign result and hides raw source failures', async () => {
    for (const result of [{ ...value, workspaceId: '21000000-0000-4000-8000-000000000001' }, new Error('private sql detail')]) {
      const handler = createKnowledgeJournalGetHandler({ authorize: async () => ({ workspaceId, client }), load: async () => { if (result instanceof Error) throw result; return result } })
      const response = await handler(new Request('https://example.com/api/journal'), context)
      expect(response.status).toBe(503)
      expect(await response.text()).not.toMatch(/private sql detail|21000000/)
    }
  })
  it('withholds private records when authority is revoked during the read', async () => {
    const authorize = vi.fn().mockResolvedValueOnce({ workspaceId, client }).mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    const handler = createKnowledgeJournalGetHandler({ authorize, load: async () => value })
    const response = await handler(new Request('https://example.com/api/journal'), context)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('observedAt')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects malformed limits before private data access', async () => {
    const authorize = vi.fn()
    const handler = createKnowledgeJournalGetHandler({ authorize, load: vi.fn() })
    expect((await handler(new Request('https://example.com/api/journal?limit=9999'), context)).status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
  })
})
