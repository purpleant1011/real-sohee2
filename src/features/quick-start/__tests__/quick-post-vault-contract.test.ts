import { describe, expect, it, vi } from 'vitest'
import { ensureQuickPostVaultVersions, getQuickPostApprovalOptions } from '../quick-post-vault-contract'

const ws = '81111111-1111-4111-8111-111111111111'
const user = '71111111-1111-4111-8111-111111111111'
const id = '91111111-1111-4111-8111-111111111111'
const image = '92222222-2222-4222-8222-222222222222'
const mission = { id, workspace_id: ws, status: 'AWAITING_APPROVAL', content_id: null, content_version_id: null, metadata: { lane: 'QUICK_POST', quick: { revision: 1, topic: '첫 인사', createdBy: user }, payload: { copies: { instagram: { caption: '우리 가게 첫 인사', hashtags: [] }, threads: { content: '첫 인사' } }, imageIds: [image], channels: [] } } }

function db(row = mission) {
  const stored: Record<string, any[]> = { marketing_missions: [structuredClone(row)], content_items: [], content_versions: [], content_version_media: [], media_assets: [{ id: image, workspace_id: ws, mime_type: 'image/png', size_bytes: 1000, sha256_digest: 'a'.repeat(64) }], channel_connections: [] }
  const from = vi.fn((table: string) => {
    let rows = stored[table] ?? []
    const q: any = {
      select: vi.fn(() => q), eq: vi.fn((field: string, value: unknown) => { rows = rows.filter(r => field === 'metadata->quick->>revision' ? String(r.metadata?.quick?.revision) === value : r[field] === value); return q }), order: vi.fn(() => q), in: vi.fn(() => q),
      maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      single: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
      insert: vi.fn((value: any) => { const added = Array.isArray(value) ? value : [value]; stored[table] ??= []; stored[table].push(...added); rows = added; return q }),
      upsert: vi.fn((value: any) => { stored[table] ??= []; const existing = stored[table].find(r => r.id === value.id || (table === 'content_version_media' && r.version_id === value.version_id && r.media_asset_id === value.media_asset_id)); if (!existing) stored[table].push(value); rows = [value]; return Promise.resolve({ data: value, error: null }) }),
      update: vi.fn((value: any) => { rows.forEach(r => Object.assign(r, value)); return q }),
    }
    return q
  })
  return { stored, from, admin: { from } as any }
}

describe('quick-post vault contract', () => {
  it('links each channel to its own immutable content version; replay creates no duplicate', async () => {
    const { admin, stored } = db()
    await ensureQuickPostVaultVersions(admin, ws, user, id)
    await ensureQuickPostVaultVersions(admin, ws, user, id)
    expect(stored.content_items).toHaveLength(2)
    expect(stored.content_versions).toHaveLength(2)
    expect(stored.content_versions.map(v => v.caption)).toEqual(['우리 가게 첫 인사', '첫 인사'])
    expect(stored.content_versions[1].content_id).toBe(stored.content_items[1].id)
  })

  it('offers unconnected threads for saving, blocks publication with Korean explanation and fails the PNG instagram spec', async () => {
    const { admin } = db()
    await ensureQuickPostVaultVersions(admin, ws, user, id)
    const dto = await getQuickPostApprovalOptions(admin, ws, id, { stage: 'PREPARE_ONLY', verifiedChannels: [] } as any)
    expect(dto.targets).toHaveLength(2)
    expect(dto.targets.find(t => t.channel === 'threads')).toMatchObject({ actions: { VAULT: { allowed: true }, PUBLISH: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' } } })
    expect(dto.targets.find(t => t.channel === 'instagram')).toMatchObject({ actions: { VAULT: { allowed: false } } })
    expect(dto.targets[0].specLabel).not.toMatch(/FAIL|UNKNOWN|PASS/)
  })

  it('identifies CONNECTION_IDENTITY_MISSING when channel is connected but external_account_id is null', async () => {
    const { admin, stored } = db()
    stored.channel_connections = [
      { workspace_id: ws, channel: 'threads', status: 'connected', account_label: '@threads_user', external_account_id: null },
    ]
    await ensureQuickPostVaultVersions(admin, ws, user, id)
    const dto = await getQuickPostApprovalOptions(admin, ws, id, { stage: 'PREPARE_ONLY', verifiedChannels: [] } as any)
    const thTarget = dto.targets.find(t => t.channel === 'threads')
    expect(thTarget).toBeDefined()
    expect(thTarget?.reasonCode).toBe('CONNECTION_IDENTITY_MISSING')
    expect(thTarget?.actions.PUBLISH).toMatchObject({
      allowed: false,
      message: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
    })
    expect(thTarget?.handle).toBe('@threads_user')
  })

  it('returns no foreign mission or payload when workspace does not match', async () => {
    const { admin } = db()
    await expect(getQuickPostApprovalOptions(admin, '82222222-2222-4222-8222-222222222222', id, { stage: 'PREPARE_ONLY', verifiedChannels: [] } as any)).rejects.toMatchObject({ status: 404 })
  })
})
