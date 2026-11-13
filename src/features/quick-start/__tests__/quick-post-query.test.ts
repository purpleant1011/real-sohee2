import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { decodeQuickPostCursor, encodeQuickPostCursor, getQuickPost, listQuickPostsPage, parseQuickPostList } from '../quick-post-query'

const ws = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000001'
const cursor = { createdAt: '2026-10-19T10:00:00.123456+00:00', id, direction: 'next' as const, scope: 'a'.repeat(64) }

describe('quick-post query validation and failure contracts', () => {
  it('roundtrips a cursor without losing PostgreSQL microseconds', () => {
    expect(decodeQuickPostCursor(encodeQuickPostCursor(cursor))).toEqual(cursor)
    const recovery = { ...cursor, direction: 'prev' as const, inclusive: true }
    expect(decodeQuickPostCursor(encodeQuickPostCursor(recovery))).toEqual(recovery)
  })
  it.each([
    { ...cursor, id: 'x),workspace_id.neq.x' },
    { ...cursor, createdAt: 'today' },
    { ...cursor, direction: 'arbitrary' },
    { ...cursor, scope: 'x' },
    { ...cursor, inclusive: 'true' },
  ])('rejects malformed cursor fields: %j', value => {
    const raw = Buffer.from(JSON.stringify(value)).toString('base64url')
    expect(decodeQuickPostCursor(raw)).toBeNull()
  })
  it('preserves bare all/40 defaults and explicit-filter 20-item pages without widening invalid input', () => {
    expect(parseQuickPostList(new URLSearchParams())).toMatchObject({ status: 'all', channel: 'all', q: '', limit: 40 })
    expect(parseQuickPostList(new URLSearchParams('status=waiting'))).toMatchObject({ status: 'waiting', limit: 20 })
    expect(parseQuickPostList(new URLSearchParams({ cursor: encodeQuickPostCursor(cursor) }))).toMatchObject({ status: 'all', limit: 40 })
    expect(parseQuickPostList(new URLSearchParams('q=가을'))).toMatchObject({ status: 'all', limit: 20 })
    for (const value of ['limit=Infinity', 'limit=1.5', 'limit=-1', 'limit=51', 'status=bad', 'channel=naver_blog', 'cursor=broken', `q=${'a'.repeat(201)}`]) {
      expect(() => parseQuickPostList(new URLSearchParams(value))).toThrow()
    }
  })
  it('rejects invalid cursor before querying', async () => {
    const admin = { from: vi.fn() }
    await expect(listQuickPostsPage(admin, ws, { cursor: 'bad' })).rejects.toThrow()
    expect(admin.from).not.toHaveBeenCalled()
  })
  it('does not turn a database failure into a not-found result', async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: { message: 'unavailable' } }) }
    await expect(getQuickPost({ from: () => query }, ws, id)).rejects.toThrow('불러오지 못')
  })
  it('fails closed when the global existence query fails instead of claiming no content', async () => {
    const client = createClient('http://127.0.0.1', 'local-test-only', { global: { fetch: async input => {
      const existence = new URL(String(input)).searchParams.get('select') === 'id'
      return new Response(JSON.stringify(existence ? { message: 'unavailable', code: 'XX000' } : []), { status: existence ? 500 : 200, headers: { 'content-type': 'application/json' } })
    } } })
    await expect(listQuickPostsPage(client, ws, { q: '없음' })).rejects.toThrow('불러오지 못')
  })
  it('returns null only for an absent post and keeps workspace and id predicates', async () => {
    const query: any = { select: () => query, eq: vi.fn(() => query), maybeSingle: async () => ({ data: null, error: null }) }
    expect(await getQuickPost({ from: () => query }, ws, id)).toBeNull()
    expect(query.eq.mock.calls).toEqual([['workspace_id', ws], ['id', id]])
  })
})
