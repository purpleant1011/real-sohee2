import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { planRenditions } from './plan'
import { executeRendition } from './execute'
import { readRenditions, signRenditionForDisplay } from './repository'

const asset = { id: 'asset', workspaceId: 'workspace', bucket: 'content-media', objectPath: 'workspace/source.png', width: 1200, height: 1200, mimeType: 'image/png', sizeBytes: 3_000_000, rightsExpiresAt: null, qcExpiresAt: null }

describe('vault image renditions', () => {
  it('plans a 4:5 JPEG crop and converts PNG for Instagram without external requests', () => {
    const plan = planRenditions(asset, 'instagram')
    expect(plan.status).toBe('READY')
    if (plan.status !== 'READY') return
    expect(plan.specVersion).toBeTruthy()
    expect(plan.output).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg', width: 1080, height: 1350 })
    expect(plan.crop).toEqual({ left: 120, top: 0, width: 960, height: 1200 })
    expect(plan.requiresTransformation).toBe(true)
  })

  it('keeps a boundary 4:5 JPEG image uncropped', () => {
    const plan = planRenditions({ ...asset, width: 800, height: 1000, mimeType: 'image/jpeg' }, 'instagram')
    expect(plan.status).toBe('READY')
    if (plan.status !== 'READY') return
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 800, height: 1000 })
  })

  it('reads Threads size and formats from the shared spec; unknown formats fail closed', () => {
    expect(planRenditions({ ...asset, mimeType: 'image/png', sizeBytes: 8 * 1024 * 1024 }, 'threads').status).toBe('READY')
    expect(planRenditions({ ...asset, mimeType: 'image/png', sizeBytes: 8 * 1024 * 1024 + 1 }, 'threads').status).toBe('READY') // compress and verify output before storing
    expect(planRenditions({ ...asset, mimeType: 'image/avif' }, 'threads').status).toBe('UNKNOWN')
  })

  it('does not invent unverifiable Naver/Daangn image formats', () => {
    expect(planRenditions(asset, 'naver_blog').status).toBe('UNKNOWN')
    expect(planRenditions(asset, 'daangn_business').status).toBe('UNKNOWN')
  })

  it('hashes actual converted bytes for fingerprint v3, and rejects oversized output', async () => {
    const plan = planRenditions(asset, 'instagram')
    if (plan.status !== 'READY') throw new Error('plan unavailable')
    const transformer = { transform: async () => new Uint8Array([1, 2, 3]) }
    const a = await executeRendition(plan, 'item', new Uint8Array([9]), transformer)
    const b = await executeRendition(plan, 'item', new Uint8Array([9]), transformer)
    expect(a.renditionContentDigest).toBe(createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'))
    expect(a.renditionContentDigest).toBe(b.renditionContentDigest)
    expect(a.record).not.toHaveProperty('signedUrl')
    expect(a.record.vault_item_id).toBe('item')
    const threads = planRenditions(asset, 'threads')
    if (threads.status !== 'READY') throw new Error('plan unavailable')
    await expect(executeRendition(threads, 'item', new Uint8Array([9]), { transform: async () => new Uint8Array(8 * 1024 * 1024 + 1) })).rejects.toThrow('size')
  })

  it('reads only object paths and issues signing exclusively at display time', async () => {
    const rows = [{ id: 'r', workspace_id: 'workspace', vault_item_id: 'item', source_media_asset_id: 'asset', channel: 'instagram', storage_bucket: 'content-media', object_path: `vault-renditions/workspace/${'a'.repeat(64)}.jpg`, rendition_content_digest: 'a'.repeat(64), rights_expires_at: null, qc_expires_at: null }]
    const repository = { list: async () => rows }
    const loaded = await readRenditions(repository, 'workspace', 'item')
    expect(loaded).toEqual(rows)
    expect(JSON.stringify(loaded)).not.toMatch(/signedUrl|token=/)
    const signed = await signRenditionForDisplay(loaded[0], { createSignedUrl: async () => 'https://example.test/?token=ephemeral' }, 60, 'workspace')
    expect(signed).toContain('ephemeral')
    expect(JSON.stringify(loaded)).not.toContain('ephemeral')
  })
})
