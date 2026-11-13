import { describe, expect, it } from 'vitest'
import { categorySyncRequestSchema, categorySyncResponseSchema } from './category-sync-contract'

const connectionId = '10000000-0000-4000-8000-000000000001'

describe('Naver category sync contract', () => {
  it('accepts a bounded hierarchical category list and count response', () => {
    expect(categorySyncRequestSchema.parse({ browserChannelConnectionId: connectionId, categories: [
      { id: '16', label: '고스트셀러', depth: 0 },
      { id: '17', label: '하위 카테고리 고스트셀러 소개', depth: 1 },
    ] }).categories).toHaveLength(2)
    expect(categorySyncResponseSchema.parse({ ok: true, count: 2 })).toEqual({ ok: true, count: 2 })
  })
  it('rejects malformed IDs, deeper levels and oversized lists', () => {
    const valid = { browserChannelConnectionId: connectionId, categories: [{ id: '16', label: '일상', depth: 0 }] }
    expect(categorySyncRequestSchema.safeParse({ ...valid, browserChannelConnectionId: 'wrong' }).success).toBe(false)
    expect(categorySyncRequestSchema.safeParse({ ...valid, categories: [{ id: '', label: '일상', depth: 0 }] }).success).toBe(false)
    expect(categorySyncRequestSchema.safeParse({ ...valid, categories: [{ id: 'a'.repeat(201), label: '일상', depth: 0 }] }).success).toBe(false)
    expect(categorySyncRequestSchema.safeParse({ ...valid, categories: [{ id: '16', label: '일상', depth: 2 }] }).success).toBe(false)
    expect(categorySyncRequestSchema.safeParse({ ...valid, categories: Array(201).fill(valid.categories[0]) }).success).toBe(false)
    expect(categorySyncResponseSchema.safeParse({ ok: true, count: -1 }).success).toBe(false)
  })

  it('accepts long IDs up to 200 chars including deterministic path keys', () => {
    const longId = 'path:' + '고스트셀러/공지사항/'.repeat(5)
    expect(longId.length).toBeLessThanOrEqual(200)
    const valid = {
      browserChannelConnectionId: connectionId,
      categories: [
        { id: 'path:고스트셀러/공지사항', label: '공지사항', depth: 1 },
        { id: 'a'.repeat(200), label: '최대길이', depth: 0 },
      ],
    }
    expect(categorySyncRequestSchema.safeParse(valid).success).toBe(true)
  })
})
