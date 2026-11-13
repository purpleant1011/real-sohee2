import { describe, expect, it, vi } from 'vitest'
import { SupabaseInstagramDmRepository } from './repository'

type Call = { method: string; args: unknown[] }

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = []
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args })
          if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve(result)
          return chain
        }
      },
    },
  )
  return { client: { from: vi.fn((table: string) => { calls.push({ method: 'from', args: [table] }); return chain }) } as any, calls }
}

describe('SupabaseInstagramDmRepository ingest helpers', () => {
  it('insertMessageIfAbsent upserts with ignoreDuplicates and reports inserted=true when a row returns', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'm1' }], error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    const out = await repo.insertMessageIfAbsent({
      workspace_id: 'ws', thread_id: 't1', provider_message_id: 'mid-1',
      sender_type: 'customer', sender_id: 'c1', text: '안녕', sent_at: '2026-10-10T00:00:00.000Z',
    })
    expect(out).toEqual({ inserted: true })
    const upsert = calls.find((c) => c.method === 'upsert')!
    expect(upsert.args[1]).toEqual({ onConflict: 'workspace_id,provider_message_id', ignoreDuplicates: true })
  })

  it('insertMessageIfAbsent reports inserted=false when the duplicate was ignored (empty array)', async () => {
    const { client } = fakeClient({ data: [], error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    const out = await repo.insertMessageIfAbsent({
      workspace_id: 'ws', thread_id: 't1', provider_message_id: 'mid-1',
      sender_type: 'customer', sender_id: 'c1', text: '안녕', sent_at: '2026-10-10T00:00:00.000Z',
    })
    expect(out).toEqual({ inserted: false })
  })

  it('insertMessageIfAbsent throws on a database error', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    const repo = new SupabaseInstagramDmRepository(client)
    await expect(repo.insertMessageIfAbsent({
      workspace_id: 'ws', thread_id: 't1', provider_message_id: 'mid-1',
      sender_type: 'customer', sender_id: 'c1', text: 'x', sent_at: '2026-10-10T00:00:00.000Z',
    })).rejects.toThrow('boom')
  })

  it('findExistingProviderMessageIds returns the ids that already exist', async () => {
    const { client, calls } = fakeClient({ data: [{ provider_message_id: 'a' }, { provider_message_id: 'b' }], error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    const out = await repo.findExistingProviderMessageIds('ws', ['a', 'b', 'c'])
    expect(out).toEqual(new Set(['a', 'b']))
    expect(calls.find((c) => c.method === 'in')!.args).toEqual(['provider_message_id', ['a', 'b', 'c']])
  })

  it('findExistingProviderMessageIds short-circuits on an empty list without querying', async () => {
    const { client } = fakeClient({ data: [], error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    expect(await repo.findExistingProviderMessageIds('ws', [])).toEqual(new Set())
    expect(client.from).not.toHaveBeenCalled()
  })

  it('latestThreadActivityAt returns the newest last_message_at or null', async () => {
    const a = fakeClient({ data: { last_message_at: '2026-10-10T01:00:00.000Z' }, error: null })
    expect(await new SupabaseInstagramDmRepository(a.client).latestThreadActivityAt('ws', 'conn'))
      .toBe('2026-10-10T01:00:00.000Z')
    const b = fakeClient({ data: null, error: null })
    expect(await new SupabaseInstagramDmRepository(b.client).latestThreadActivityAt('ws', 'conn')).toBeNull()
  })

  it('findThreadByProviderThreadId returns null when not found', async () => {
    const { client } = fakeClient({ data: null, error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    expect(await repo.findThreadByProviderThreadId('ws', 'ig:cust')).toBeNull()
  })

  it('updateThreadStatus throws when the update affects zero rows', async () => {
    const { client } = fakeClient({ data: [], error: null })
    const repo = new SupabaseInstagramDmRepository(client)
    await expect(repo.updateThreadStatus('ws', 'th-1', 'NEEDS_CHECK'))
      .rejects.toThrow('대화 상태 변경에 실패했거나 대상을 찾을 수 없습니다')
  })

  it('recordAudit reports recorded=false instead of throwing, so committed routes do not 500', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'audit table unavailable' } })
    const repo = new SupabaseInstagramDmRepository(client)
    await expect(repo.recordAudit({
      workspace_id: 'ws',
      thread_id: 'th-1',
      actor: 'owner',
      actor_user_id: 'u-1',
      action: 'manual_send',
      provider_message_id: 'ig-1',
      readback_verified: true,
      details: {},
    })).resolves.toEqual({ recorded: false })
  })
})
