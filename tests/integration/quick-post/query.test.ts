import { beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { listQuickPostsPage, getQuickPost, parseQuickPostList } from '@/features/quick-start/quick-post-query'

const rest = process.env.QUICK_POST_TEST_REST_URL
if (rest && (new URL(rest).hostname !== '127.0.0.1' || process.env.PGDATABASE !== 'sohee_quick_post_test' || !/(?:^|\/)sohee-quick-post-db-[^/]+$/.test(process.env.PGHOST ?? ''))) {
  throw new Error('Run only through scripts/test-quick-post-db.mjs with its owned temporary cluster')
}
const ws = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (s: string) => execFileSync(`${process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'}/psql`, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' })
const copies = { instagram: { caption: '기본 본문', hashtags: [] }, threads: { content: '기본 본문' } }
function row(n: number, options: { topic?: string; status?: string; channel?: string; workspace?: string; supported?: boolean } = {}) {
  const metadata = options.supported === false ? {} : { quick: { topic: options.topic ?? '일반 소식' }, payload: { copies, channels: [{ provider: options.channel ?? 'instagram', handle: '@test' }], imageIds: [], boundVersions: {}, rights: {} } }
  return { id: id(n), workspace_id: options.workspace ?? ws, status: options.status ?? 'AWAITING_APPROVAL', metadata, created_at: '2026-10-19T12:00:00.123456Z' }
}
// Use the real supabase-js query builder and a real local PostgREST, not a fluent mock.
const admin = createClient('http://127.0.0.1', 'local-test-only', { global: { fetch: (input, init) => {
  const headers = new Headers(init?.headers)
  headers.delete('authorization')
  return fetch(String(input).replace('http://127.0.0.1/rest/v1', rest!), { ...init, headers })
} } })
async function insert(rows: ReturnType<typeof row>[]) {
  const result = await admin.from('marketing_missions').insert(rows)
  if (result.error) throw new Error(result.error.message)
}

describe.skipIf(!rest)('quick post real PostgreSQL/PostgREST query', () => {
  beforeEach(() => sql('truncate public.marketing_missions'))

  it('keeps bare list requests unfiltered for existing published-post consumers', async () => {
    await insert([
      row(1, { status: 'PUBLISHED_VERIFIED' }), row(2, { status: 'COMPLETED' }), row(3, { status: 'LISTENING' }),
      ...Array.from({ length: 27 }, (_, i) => row(i + 4)),
    ])
    const bare = await listQuickPostsPage(admin, ws, parseQuickPostList(new URLSearchParams()))
    expect(bare.items.map(item => item.missionId)).toEqual(Array.from({ length: 30 }, (_, i) => id(30 - i)))
    const waiting = await listQuickPostsPage(admin, ws, parseQuickPostList(new URLSearchParams('status=waiting')))
    expect(waiting.items).toHaveLength(20)
    expect(waiting.items.every(item => item.status === 'AWAITING_APPROVAL')).toBe(true)
  })

  it.each(['deleted', 'published'] as const)('restores all 20 prior items including the pivot after the next page becomes %s', async change => {
    await insert(Array.from({ length: 41 }, (_, i) => row(i + 1)))
    const first = await listQuickPostsPage(admin, ws, { limit: 20, status: 'waiting' })
    expect(first.items.at(-1)?.missionId).toBe(id(22))
    const mutation = change === 'deleted'
      ? admin.from('marketing_missions').delete().eq('workspace_id', ws).lt('id', id(22))
      : admin.from('marketing_missions').update({ status: 'PUBLISHED_VERIFIED' }).eq('workspace_id', ws).lt('id', id(22))
    const result = await mutation
    expect(result.error).toBeNull()
    const empty = await listQuickPostsPage(admin, ws, { limit: 20, status: 'waiting', cursor: first.nextCursor })
    expect(empty.items).toEqual([])
    expect(empty.prevCursor).not.toBeNull()
    const restored = await listQuickPostsPage(admin, ws, { limit: 20, status: 'waiting', cursor: empty.prevCursor })
    expect(restored.items.map(item => item.missionId)).toEqual(first.items.map(item => item.missionId))
    expect(restored.items).toHaveLength(20)
    expect(restored.nextCursor).toBeNull()
    expect(restored.prevCursor).toBeNull()
  })

  it('finds an older match behind 61 nonmatching and 61 unsupported missions', async () => {
    await insert([row(1, { topic: '가을' }), ...Array.from({ length: 61 }, (_, i) => row(i + 2)), ...Array.from({ length: 61 }, (_, i) => row(i + 63, { supported: false }))])
    const page = await listQuickPostsPage(admin, ws, { q: '가을', status: 'waiting', channel: 'instagram' })
    expect(page.items.map(item => item.missionId)).toEqual([id(1)])
    expect(page.hasNextPage).toBe(false)
    expect(page.hasAnySupportedContent).toBe(true)
  })

  it('walks 85 timestamp ties in both directions without omissions or duplicates', async () => {
    await insert(Array.from({ length: 85 }, (_, i) => row(i + 1)))
    const seen: string[] = []
    let cursor: string | null = null
    let previousPage: string[] = []
    do {
      const page = await listQuickPostsPage(admin, ws, { limit: 20, cursor })
      if (previousPage.length) {
        const back = await listQuickPostsPage(admin, ws, { limit: 20, cursor: page.prevCursor })
        expect(back.items.map(item => item.missionId)).toEqual(previousPage)
      }
      previousPage = page.items.map(item => item.missionId)
      seen.push(...previousPage)
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(Array.from({ length: 85 }, (_, i) => id(85 - i)))
    expect(new Set(seen).size).toBe(85)
  })

  it('combines search grammar, channel and cursor predicates across multiple pages', async () => {
    const q = '가을, (행사)'
    await insert(Array.from({ length: 85 }, (_, i) => row(i + 1, { topic: i % 2 === 0 ? q : '다른 글', channel: i % 2 === 0 ? 'threads' : 'instagram' })))
    const first = await listQuickPostsPage(admin, ws, { q, channel: 'threads', limit: 20 })
    const second = await listQuickPostsPage(admin, ws, { q, channel: 'threads', limit: 20, cursor: first.nextCursor })
    const third = await listQuickPostsPage(admin, ws, { q, channel: 'threads', limit: 20, cursor: second.nextCursor })
    expect([...first.items, ...second.items, ...third.items].map(item => item.missionId)).toEqual(Array.from({ length: 43 }, (_, i) => id(85 - i * 2)))
    expect(third.nextCursor).toBeNull()
    const back = await listQuickPostsPage(admin, ws, { q, channel: 'threads', limit: 20, cursor: second.prevCursor })
    expect(back.items.map(item => item.missionId)).toEqual(first.items.map(item => item.missionId))
  })

  it('reports global existence when a filtered page is empty', async () => {
    await insert([row(1)])
    const page = await listQuickPostsPage(admin, ws, { q: '없는 검색어' })
    expect(page.items).toEqual([])
    expect(page.hasAnySupportedContent).toBe(true)
  })

  it('filters status and saved channel before limiting', async () => {
    await insert([row(1, { channel: 'threads', status: 'FAILED' }), ...Array.from({ length: 70 }, (_, i) => row(i + 2, { status: 'PUBLISHED_VERIFIED' }))])
    const page = await listQuickPostsPage(admin, ws, { status: 'waiting', channel: 'threads', limit: 1 })
    expect(page.items.map(item => item.missionId)).toEqual([id(1)])
  })

  it('treats PostgREST grammar and SQL wildcards as literal search characters', async () => {
    const q = '가을, (행사). 100%_ * " \\ :'
    await insert([row(1, { topic: q }), row(2, { topic: '다른 글' })])
    const page = await listQuickPostsPage(admin, ws, { q })
    expect(page.items.map(item => item.missionId)).toEqual([id(1)])
  })

  it('keeps workspace isolation and rejects another workspace or filter cursor', async () => {
    await insert([row(1), row(2), row(3, { workspace: other })])
    expect(await getQuickPost(admin, ws, id(3))).toBeNull()
    const first = await listQuickPostsPage(admin, ws, { limit: 1 })
    await expect(listQuickPostsPage(admin, other, { limit: 1, cursor: first.nextCursor })).rejects.toThrow()
    await expect(listQuickPostsPage(admin, ws, { limit: 1, q: '다른 조건', cursor: first.nextCursor })).rejects.toThrow()
  })
})
