import { Blob } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { beginMediaUpload, completeMediaUpload, withdrawMediaRights } from './media-upload'
import { computeSha256 } from './media-storage'

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGDcAAAAASUVORK5CYII=', 'base64')
const workspaceId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const rights = { copyright: 'owned', commercialUse: true, identifiablePeople: 'none', consentReference: null }
function fixture() {
  let row: any = null
  const download = vi.fn(async () => ({ data: new Blob([bytes]), error: null }))
  const bucket = { createSignedUploadUrl: vi.fn(async () => ({ data: { token: 'test-only', signedUrl: 'https://storage.invalid/upload' }, error: null })), download }
  const admin = { storage: { from: () => bucket }, from: () => {
    let update: any
    const q: any = { select: () => q, eq: () => q,
      insert: async (value: any) => { row = value; return { error: null } },
      update: (value: any) => { update = value; return q },
      maybeSingle: async () => { if (update) row = { ...row, ...update }; return { data: row, error: null } },
    }
    return q
  } }
  return { admin, bucket, get row() { return row }, set row(value: any) { row = value } }
}
const input = { mimeType: 'image/png', sizeBytes: bytes.length, sha256Digest: computeSha256(bytes), rights }

describe('private photo upload (ANI-1593)', () => {
  it('uses a server path and verifies storage bytes plus persisted READY row', async () => {
    const f = fixture()
    const started = await beginMediaUpload({ admin: f.admin, workspaceId, userId, input })
    expect(f.row).toMatchObject({ provenance_kind: 'USER_UPLOAD', lifecycle_status: 'PENDING_VALIDATION', publish_eligibility: false })
    expect(started.objectPath).toContain(`workspaces/${workspaceId}/media/source/`)
    const done = await completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })
    expect(done).toMatchObject({ assetId: started.assetId, publishEligible: true, storageVerified: true })
    expect(f.row).toMatchObject({ lifecycle_status: 'READY', width: 1, height: 1, rights_status: 'confirmed' })
    await completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })
    expect(f.bucket.download).toHaveBeenCalledTimes(2)
  })
  it('keeps upload pending when storage is unavailable so finalization can retry', async () => {
    const f = fixture()
    const started = await beginMediaUpload({ admin: f.admin, workspaceId, userId, input })
    f.bucket.download.mockResolvedValueOnce({ data: null as any, error: { message: 'offline' } } as any)
    await expect(completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })).rejects.toMatchObject({ code: 'STORAGE_READBACK' })
    expect(f.row.publish_eligibility).toBe(false)
    expect(f.row.lifecycle_status).toBe('PENDING_VALIDATION')
    await expect(completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })).resolves.toMatchObject({ storageVerified: true })
  })
  it('rejects digest mismatch, foreign workspace and HEIC until a verified decoder exists', async () => {
    const f = fixture()
    await expect(beginMediaUpload({ admin: f.admin, workspaceId, userId, input: { ...input, mimeType: 'image/heic' } })).rejects.toThrow('HEIC')
    const started = await beginMediaUpload({ admin: f.admin, workspaceId, userId, input: { ...input, sha256Digest: 'a'.repeat(64) } })
    await expect(completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    f.row = { ...f.row, workspace_id: 'foreign' }
    await expect(completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('withdraws rights without deleting the original or claiming to remove an external post', async () => {
    const f = fixture()
    const started = await beginMediaUpload({ admin: f.admin, workspaceId, userId, input })
    await completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })
    await withdrawMediaRights({ admin: f.admin, workspaceId, userId, assetId: started.assetId })
    expect(f.row).toMatchObject({ rights_status: 'rejected', publish_eligibility: false })
    expect(f.row.generation_metadata.rightsWithdrawnBy).toBe(userId)
    expect(f.row.generation_metadata.rightsWithdrawnAt).toEqual(expect.any(String))
    await completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })
    expect(f.row.publish_eligibility).toBe(false)
  })
  it('allows a private draft photo with unknown rights but never marks it publishable', async () => {
    const f = fixture()
    const started = await beginMediaUpload({ admin: f.admin, workspaceId, userId, input: { ...input, rights: { ...rights, copyright: 'unknown' } } })
    expect(await completeMediaUpload({ admin: f.admin, workspaceId, userId, assetId: started.assetId })).toMatchObject({ publishEligible: false })
  })
})
