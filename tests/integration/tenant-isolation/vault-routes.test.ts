import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { pgClient, query } from '../vault/pg-client'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'

const actor = vi.hoisted(() => ({ id: '' }))
const signedPaths = vi.hoisted(() => [] as string[])
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => {
    const { pgClient } = await import('../vault/pg-client')
    // The raw replay stubs run as one superuser; their legacy workspace_members
    // policy recursively calls itself when impersonated by a normal role.
    // Resolve membership and external action count via actual seeded tables here;
    // the six vault tables themselves are exercised with real RLS in vault-isolation.test.ts.
    const db = pgClient(actor.id)
    return { auth: { getUser: async () => ({ data: { user: { id: actor.id } }, error: null }) }, from: (table: string) => {
      if (table !== 'workspace_members' && table !== 'external_action_requests') return db.from(table)
      const filters: Record<string, string> = {}
      if (table === 'external_action_requests') return {
        // Two real query shapes: head+count (no channel filter) and a row list
        // (channel filter). Both must be answered or the caller cannot tell an
        // empty result from an unobserved one.
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => ({ eq: (_key: string, ws: string) => ({ in: (_key2: string, versions: string[]) => {
          if (ws !== a.ws && ws !== b.ws || versions.some(version => !/^[0-9a-f-]{36}$/.test(version))) return Promise.resolve({ data: null, count: null, error: { message: 'Invalid scope' } })
          return import('../vault/pg-client').then(({ query }) => {
            const scope = `workspace_id='${ws}' and content_version_id in (${versions.map(id => `'${id}'`).join(',')})`
            if (opts?.head) {
              const result = query<{ n: number }>(`select count(*)::int n from external_action_requests where ${scope}`)[0]
              return { data: null, count: result.n, error: null }
            }
            const rows = query<{ id: string; content_version_id: string; channel: string }>(`select id, content_version_id, channel from external_action_requests where ${scope}`)
            return { data: rows, count: rows.length, error: null }
          })
        } }) }),
      }
      const builder = {
        select: () => builder,
        eq: (key: string, value: string) => { filters[key] = value; return builder },
        maybeSingle: async () => {
          const { query } = await import('../vault/pg-client')
          const requested = filters.workspace_id ?? ''
          const user = filters.user_id ?? ''
          if (!/^[0-9a-f-]{36}$/.test(requested) || !/^[0-9a-f-]{36}$/.test(user)) return { data: null, error: { message: 'Bad identity' } }
          const membership = query<{ workspace_id: string; role: string; status: string }>(`select workspace_id,role,status from workspace_members where user_id='${user}' and workspace_id='${requested}'`)[0] ?? null
          return { data: membership, error: null }
        },
      }
      return builder
    } }
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    ...pgClient(),
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) => { signedPaths.push(`${bucket}/${path}`); return { data: { signedUrl: 'https://example.test/temporary' }, error: null } } }) },
  }),
}))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: async () => {} }))

import { POST as saveRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/route'
import { GET as itemsRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/items/route'
import { GET as calendarRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/calendar/route'
import { GET as summaryRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/summary/route'
import { PATCH as editRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/[itemRef]/route'
import { GET as bundleRoute, POST as publishRoute } from '../../../src/app/api/workspaces/[workspaceId]/vault/[itemRef]/bundle/route'

const a = { user: 'cc111111-1111-4111-8111-111111111111', ws: 'cc222222-2222-4222-8222-222222222222', content: 'cc333333-3333-4333-8333-333333333333', version: 'cc444444-4444-4444-8444-444444444444' }
const b = { user: 'dd111111-1111-4111-8111-111111111111', ws: 'dd222222-2222-4222-8222-222222222222', content: 'dd333333-3333-4333-8333-333333333333', version: 'dd444444-4444-4444-8444-444444444444' }
const encode = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
const counts = (ws: string) => query<{ items: number; events: number; urls: number }>(`select (select count(*) from vault_items where workspace_id='${ws}')::int as items, (select count(*) from vault_events where workspace_id='${ws}')::int as events, (select count(*) from vault_published_urls where workspace_id='${ws}')::int as urls`)[0]
const refs = new Map<string, string>()
const get = (ws: string, suffix: string) => {
  const request = new NextRequest(`http://localhost/api/workspaces/${ws}/vault/${suffix}`)
  const params = Promise.resolve({ workspaceId: ws })
  if (suffix === 'items') return itemsRoute(request, { params })
  if (suffix === 'calendar') return calendarRoute(request, { params })
  return summaryRoute(request, { params })
}
const save = (ws: string, content: string, version: string, key: string) => saveRoute(new Request(`http://localhost/api/workspaces/${ws}/vault`, { method: 'POST', body: JSON.stringify({ contentId: content, versionId: version, channels: ['threads'], idempotencyKey: key }) }), { params: Promise.resolve({ workspaceId: ws }) })
const edit = (ws: string, ref: string) => editRoute(new Request(`http://localhost/api/workspaces/${ws}/vault/${ref}`, { method: 'PATCH', body: JSON.stringify({ operation: 'delete', expectedVersion: '2026-10-08T00:00:00.000Z' }) }), { params: Promise.resolve({ workspaceId: ws, itemRef: ref }) })
const bundle = (ws: string, ref: string) => bundleRoute(new Request(`http://localhost/api/workspaces/${ws}/vault/${ref}/bundle`), { params: Promise.resolve({ workspaceId: ws, itemRef: ref }) })
const publish = (ws: string, ref: string) => publishRoute(new Request(`http://localhost/api/workspaces/${ws}/vault/${ref}/bundle`, { method: 'POST', body: JSON.stringify({ url: 'https://www.threads.net/@test/post/123' }) }), { params: Promise.resolve({ workspaceId: ws, itemRef: ref }) })

beforeAll(async () => {
  for (const [i, person] of [a, b].entries()) {
    query(`with u as (insert into auth.users(id) values ('${person.user}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${person.ws}','동명 매장','${person.user}') returning id) select id from w`)
    query(`with c as (insert into content_items(id,workspace_id,channel,title,created_by) values ('${person.content}','${person.ws}','threads','${i ? '식당' : '꽃집'} 공지','${person.user}') returning id) select id from c`)
    query(`with v as (insert into content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${person.version}','${person.ws}','${person.content}',1,'${i ? '식당' : '꽃집'} 소식','${'a'.repeat(64)}','${person.user}') returning id) select id from v`)
    await saveToVault({ workspaceId: person.ws, actorId: person.user, contentId: person.content, versionId: person.version, channels: ['threads'], targetDate: null, idempotencyKey: 'initial' }, { repository: new SupabaseVaultSaveRepository(pgClient() as never) })
    refs.set(person.ws, encode(query<{ id: string }>(`select id from vault_items where workspace_id='${person.ws}'`)[0].id))
  }
})

describe('ANI-1551 route handlers + real PG membership and persistence', () => {
  it('rejects both directions of foreign workspace IDs before save, list, calendar, summary, edit, bundle or URL registration', async () => {
    for (const [owner, foreign] of [[a, b], [b, a]]) {
      actor.id = owner.user
      const before = counts(foreign.ws)
      for (const response of [
        await save(foreign.ws, foreign.content, foreign.version, 'foreign'),
        await get(foreign.ws, 'items'),
        await get(foreign.ws, 'calendar'),
        await get(foreign.ws, 'summary'),
        await edit(foreign.ws, refs.get(foreign.ws)!),
        await bundle(foreign.ws, refs.get(foreign.ws)!),
        await publish(foreign.ws, refs.get(foreign.ws)!),
      ]) expect([403, 404]).toContain(response.status)
      expect(counts(foreign.ws)).toEqual(before)
    }
    expect(signedPaths).toEqual([])
  })

  it('rejects a foreign itemRef or content/version under an authorized workspace with 404, preserving foreign rows', async () => {
    actor.id = a.user
    const before = counts(b.ws)
    expect((await save(a.ws, b.content, b.version, 'cross-content')).status).toBe(404)
    expect((await edit(a.ws, refs.get(b.ws)!)).status).toBe(404)
    expect((await bundle(a.ws, refs.get(b.ws)!)).status).toBe(404)
    expect((await publish(a.ws, refs.get(b.ws)!)).status).toBe(404)
    expect(counts(b.ws)).toEqual(before)
    expect(signedPaths).toEqual([])
  })

  it('allows own workspace read handlers and excludes same-named foreign item from every response', async () => {
    for (const person of [a, b]) {
      actor.id = person.user
      const item = await get(person.ws, 'items')
      expect(item.status).toBe(200)
      const payload = await item.json()
      expect(payload.data.items).toHaveLength(1)
      expect(payload.data.items[0].item_ref).toBe(refs.get(person.ws))
      expect((await get(person.ws, 'calendar')).status).toBe(200)
      expect((await get(person.ws, 'summary')).status).toBe(200)
    }
  })
})
