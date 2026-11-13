import { describe, expect, it, vi } from 'vitest'
import { SupabaseEngagementRepository } from './repository'
import { SupabaseInstagramDmRepository } from './dm/repository'
function database() {
  const eq = vi.fn()
  const upsert = vi.fn()
  const update = vi.fn()
  const chain: Record<string, unknown> = {}
  chain.eq = (...args: unknown[]) => { eq(...args); return chain }
  chain.select = () => chain
  chain.update = (...args: unknown[]) => { update(...args); return chain }
  chain.upsert = (...args: unknown[]) => { upsert(...args); return chain }
  chain.single = async () => ({ data: { id: 'draft', draft_text: '새 문안' }, error: null })
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: 'target' }], error: null }).then(resolve)
  const client = { from: vi.fn(() => chain) } as unknown as ConstructorParameters<typeof SupabaseEngagementRepository>[0]
  return { client, eq, upsert, update }
}

describe('agent drafting preserves concurrent human edits', () => {
  it('compares the existing comment draft timestamp before clearing approval and changing text', async () => {
    const db = database()
    await new SupabaseEngagementRepository(db.client).updateDraft('workspace', 'comment', '새 문안', '2026-10-29T10:00:00Z')
    expect(db.eq).toHaveBeenCalledWith('updated_at', '2026-10-29T10:00:00Z')
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ approved_fingerprint: null, approved_by: null, approved_at: null }))
  })
  it('compares the existing DM draft timestamp before changing text', async () => {
    const db = database()
    await new SupabaseInstagramDmRepository(db.client).updateDraft('workspace', 'thread', '새 문안', null, '2026-10-29T10:00:00Z')
    expect(db.eq).toHaveBeenCalledWith('updated_at', '2026-10-29T10:00:00Z')
  })
  it('does not overwrite another DM draft that won creation concurrently', async () => {
    const db = database()
    await new SupabaseInstagramDmRepository(db.client).saveDraft('workspace', 'thread', [], null, '새 문안', null, { ifAbsent: true })
    expect(db.upsert).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ ignoreDuplicates: true }))
  })
})
