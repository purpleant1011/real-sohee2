import { describe, expect, it } from 'vitest'
import { SupabaseChannelDraftRepository } from './supabase-repository'
import type { SaveChannelDraftInput } from './ports'

const workspaceId = '81111111-1111-4111-8111-111111111111'
const userId = '71111111-1111-4111-8111-111111111111'
const requestKey = '91111111-1111-4111-8111-111111111111'
const imageId = '44444444-4444-4444-8444-444444444444'
const draft: SaveChannelDraftInput = {
  workspaceId, userId, requestKey, topic: '가게 소개', knowledgeVersion: 3,
  basisNotes: ['지식 v3 기준'], imageNotice: null, imageIds: [],
  variants: [{ channel: 'threads', payload: { text: '저희 가게를 소개합니다.' }, status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null }],
}

function mockDb(assets: Record<string, unknown>[] = []) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args])
      if (name === 'reserve_channel_draft_ani1538') return { data: 'acquired', error: null }
      if (name === 'release_channel_draft_ani1538') return { data: null, error: null }
      const variants = args.p_variants as Record<string, unknown>[]
      return { data: { workspace_id: workspaceId, request_key: requestKey, topic: draft.topic,
        created_at: '2026-10-08T00:00:00Z', basis_notes: draft.basisNotes, image_notice: null, variants }, error: null }
    },
    from: (table: string) => {
      if (table !== 'media_assets') throw new Error(`Non-atomic table access: ${table}`)
      const builder = { select: () => builder, eq: () => builder, in: () => builder,
        then(resolve: (value: unknown) => void) { resolve({ data: assets, error: null }) } }
      return builder
    },
  }
  return { db, calls }
}

describe('SupabaseChannelDraftRepository', () => {
  it('delegates reservation and release to atomic database RPCs', async () => {
    const { db, calls } = mockDb()
    const repo = new SupabaseChannelDraftRepository(db as never)
    const { variants: _variants, imageIds: _imageIds, ...input } = draft
    expect(await repo.reserve(input)).toEqual({ kind: 'acquired' })
    await repo.release(workspaceId, requestKey, userId)
    expect(calls.map(([name]) => name)).toEqual(['reserve_channel_draft_ani1538', 'release_channel_draft_ani1538'])
  })

  it('finalizes through one database RPC rather than writing content rows in separate requests', async () => {
    const { db, calls } = mockDb()
    const result = await new SupabaseChannelDraftRepository(db as never).save(draft)
    expect(result.variants[0]).toMatchObject({ vaultSavable: true, contentId: expect.any(String), versionId: expect.any(String) })
    expect(calls.map(([name]) => name)).toEqual(['finalize_channel_draft_ani1538'])
    expect(calls[0][1]).toMatchObject({ p_workspace_id: workspaceId, p_request_key: requestKey, p_media_ids: [] })
  })

  it('rejects a foreign workspace row rather than leaking it', async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { workspace_id: crypto.randomUUID() }, error: null }) }) }) }) }) }
    await expect(new SupabaseChannelDraftRepository(db as never).findByRequestKey(workspaceId, requestKey)).rejects.toThrow()
  })

  it('does not materialise content or a version for a flagged variant', async () => {
    const { db, calls } = mockDb()
    const result = await new SupabaseChannelDraftRepository(db as never).save({ ...draft, variants: [{ ...draft.variants[0], status: 'NEEDS_CHECK', savableReason: '확인되지 않은 주장' }] })
    expect(result.variants[0]).toMatchObject({ contentId: null, versionId: null, vaultSavable: false })
    expect(calls).toHaveLength(1)
  })

  it('does not advertise an image-free Naver variant as vault-savable even when marked READY', async () => {
    const { db } = mockDb()
    const result = await new SupabaseChannelDraftRepository(db as never).save({ ...draft, variants: [{ channel: 'naver_blog', payload: { title: '가게 소식', text: '안녕하세요' }, status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null }] })
    expect(result.variants[0].vaultSavable).toBe(false)
    expect(result.variants[0].blockedReason).toMatch(/이미지/)
  })

  it('links an image to every materialised channel in the atomic RPC', async () => {
    const { db, calls } = mockDb([{ id: imageId, mime_type: 'image/png', size_bytes: 1024, sha256_digest: 'a'.repeat(64) }])
    const result = await new SupabaseChannelDraftRepository(db as never).save({ ...draft, imageIds: [imageId], variants: [{ channel: 'naver_blog', payload: { title: '가게 소식', text: '안녕하세요' }, status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null }] })
    expect(result.variants[0].vaultSavable).toBe(true)
    expect(result.variants[0].payload).toMatchObject({ media: [{ type: 'image', src: `/api/workspaces/${workspaceId}/media/${imageId}` }] })
    expect(calls[0][1].p_media_ids).toEqual([imageId])
  })

  it('rejects missing image rows instead of advertising a false vault-ready draft', async () => {
    const { db, calls } = mockDb()
    await expect(new SupabaseChannelDraftRepository(db as never).save({ ...draft, imageIds: [imageId] })).rejects.toThrow(/image unavailable/)
    expect(calls).toHaveLength(0)
  })
})
