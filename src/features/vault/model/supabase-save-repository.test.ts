import { describe, expect, it } from 'vitest'
import { SupabaseVaultSaveRepository } from './supabase-save-repository'

function fakeDb() {
  const tables = new Map<string, any[]>([
    ['content_items', [{ workspace_id: 'A', id: 'content', title: '제목' }]],
    ['content_versions', [{ workspace_id: 'A', content_id: 'content', id: 'version', caption: '본문', hashtags: [] }]],
    ['content_version_media', []],
    ['vault_items', []], ['vault_variant_payloads', []], ['vault_events', []],
    ['channel_connections', []], ['meta_channel_credentials', []], ['channel_verification_runs', []],
  ])
  const writes: string[] = []
  const client = {
    from(table: string) {
      if (!tables.has(table)) throw new Error(`Unrecognized table ${table}`)
      const filters: Array<(row: any) => boolean> = []
      const matching = () => tables.get(table)!.filter(row => filters.every(test => test(row)))
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: any) => { filters.push(row => row[field] === value); return chain },
        in: (field: string, values: any[]) => { filters.push(row => values.includes(row[field])); return chain },
        is: (field: string, value: any) => { filters.push(row => row[field] === value); return chain },
        order: () => chain,
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (done: any) => done({ data: matching(), error: null }),
        upsert: (value: any, options: any) => {
          if (options?.onConflict !== 'workspace_id,idempotency_key' || options?.ignoreDuplicates !== true) throw new Error('unsafe upsert')
          writes.push(table)
          const rows = tables.get(table)!
          if (table === 'vault_items' && rows.some(row => row.workspace_id === value.workspace_id && row.idempotency_key === value.idempotency_key)) return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }
          const row = { ...value, id: `${table}-${rows.length + 1}`, created_at: 'today', updated_at: 'today', occurred_at: 'today' }
          rows.push(row)
          return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }
        },
        insert: (value: any) => {
          writes.push(table)
          const rows = tables.get(table)!
          const row = { ...value, id: `${table}-${rows.length + 1}`, created_at: 'today', updated_at: 'today', occurred_at: 'today' }
          rows.push(row)
          return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }
        },
      }
      return chain
    },
  }
  return { client, tables, writes }
}

describe('service role vault repository SQL boundaries', () => {
  it('returns no draft when content or version belongs to another workspace', async () => {
    const { client, writes } = fakeDb()
    const repo = new SupabaseVaultSaveRepository(client as never)
    expect(await repo.getDraft('B', 'content', 'version')).toBeNull()
    expect(await repo.getDraft('A', 'content', 'wrong')).toBeNull()
    expect(writes).toEqual([])
  })
  it('reads only persisted verification receipts and never invokes a live provider probe', async () => {
    const { client, tables, writes } = fakeDb()
    const repo = new SupabaseVaultSaveRepository(client as never)
    const disconnected = await repo.getChannelTruth('A')
    expect(disconnected.instagram.verified).toBe(false)
    tables.get('meta_channel_credentials')!.push({ workspace_id: 'A', provider: 'instagram', status: 'active', granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'], token_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), channel_connections: { external_account_id: 'ig-123' } })
    tables.get('channel_verification_runs')!.push({ workspace_id: 'A', channel: 'instagram', status: 'VERIFIED', read_after_write_at: new Date().toISOString() })
    const connected = await repo.getChannelTruth('A')
    expect(connected.instagram).toEqual({ verified: true, accountId: 'ig-123' })
    expect(writes).toEqual([])
  })
  it('inserts at most one item per channel-scoped key and never touches external action tables', async () => {
    const { client, tables, writes } = fakeDb()
    const repo = new SupabaseVaultSaveRepository(client as never)
    const input: any = { workspaceId: 'A', contentId: 'content', versionId: 'version', channel: 'instagram', idempotencyKey: 'same-key', policyVersion: 'v1', specVersion: 'v1', approvalState: 'APPROVED', fingerprintSchemaVersion: 3, approvedFingerprint: 'a'.repeat(64), releaseGate: 'HELD_CONNECTION_PENDING', holdReason: 'CHANNEL_NOT_CONNECTED', heldAt: 'today', heldBy: null, targetDate: null, approvedBy: null, bundleId: null, deletedAt: null }
    const first = await repo.createItem(input)
    const replay = await repo.createItem(input)
    expect(first.created).toBe(true)
    expect(replay).toEqual({ item: first.item, created: false })
    expect(tables.get('vault_items')).toHaveLength(1)
    expect(writes).toEqual(['vault_items', 'vault_items'])
  })
})
