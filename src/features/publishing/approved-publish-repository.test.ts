import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  loadApprovedPublishMaterial,
  loadReconciledPublishMaterial,
} from './approved-publish-repository'

const row = {
  workspace_id: '10000000-0000-4000-8000-000000000001',
  content_id: '11000000-0000-4000-8000-000000000001',
  schedule_id: '20000000-0000-4000-8000-000000000001',
  channel_connection_id: '21000000-0000-4000-8000-000000000001',
  schedule_status: 'publishing',
  version_id: '30000000-0000-4000-8000-000000000001',
  current_version_id: '30000000-0000-4000-8000-000000000001',
  approval_version_id: '30000000-0000-4000-8000-000000000001',
  version_fingerprint: 'a'.repeat(64), approval_fingerprint: 'a'.repeat(64),
  approval_status: 'approved', disclosure_confirmed: true, rights_confirmed: true,
  connection_status: 'connected', channel: 'instagram', connection_channel: 'instagram',
  external_account_id: '1789001', caption: '본문', hashtags: ['소희'], disclosure: 'AI 보조 제작',
  media: [{ position: 0, media_asset_id: '40000000-0000-4000-8000-000000000001', bucket_id: 'content-media', object_path: 'workspace/content/version/image.jpg', mime_type: 'image/jpeg', rights_status: 'confirmed' }],
}

describe('approved publish repository', () => {
  it('loads the server-validated exact version, signs only its media, and verifies external reachability', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null })
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example.test/signed-image' }, error: null })
    const probe = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '1234' } }))

    await expect(loadApprovedPublishMaterial(row.workspace_id, row.schedule_id, {
      rpc, createSignedUrl, probe,
    })).resolves.toMatchObject({
      payload: { contentId: row.content_id, versionId: row.version_id, fingerprint: row.version_fingerprint, channel: 'instagram', externalAccountId: '1789001' },
      mediaUrls: ['https://storage.example.test/signed-image'],
    })
    expect(rpc).toHaveBeenCalledWith('load_approved_meta_publish_payload', {
      p_workspace_id: row.workspace_id, p_schedule_id: row.schedule_id,
    })
    expect(createSignedUrl).toHaveBeenCalledWith('content-media', row.media[0].object_path, 900)
    expect(probe).toHaveBeenCalledWith('https://storage.example.test/signed-image', expect.objectContaining({ method: 'HEAD' }))
  })

  it('fails closed when signed media is not publicly reachable as the approved mime type', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ data: row, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example.test/signed-image' }, error: null }),
      probe: vi.fn().mockResolvedValue(new Response(null, { status: 403, headers: { 'content-type': 'application/json' } })),
    }
    await expect(loadApprovedPublishMaterial(row.workspace_id, row.schedule_id, gateway))
      .rejects.toThrow('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
  })

  it('uses the reconciliation-only payload contract for an unknown schedule', async () => {
    const unknownRow = { ...row, schedule_status: 'unknown' }
    const rpc = vi.fn().mockResolvedValue({ data: unknownRow, error: null })
    const gateway = {
      rpc,
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example.test/signed-image' }, error: null }),
      probe: vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    }

    await expect(loadReconciledPublishMaterial(row.workspace_id, row.schedule_id, gateway))
      .resolves.toMatchObject({ payload: { scheduleId: row.schedule_id } })
    expect(rpc).toHaveBeenCalledWith('load_reconciled_meta_publish_payload', {
      p_workspace_id: row.workspace_id,
      p_schedule_id: row.schedule_id,
    })
  })

  it('publishes an immutable Instagram PNG through a version-linked durable JPEG derivative', async () => {
    const pngRow = {
      ...row,
      media: [{
        ...row.media[0],
        object_path: 'workspace/content/version/original.png',
        mime_type: 'image/png',
      }],
    }
    const derivativePath = [
      'workspace/content/version/publish-derivatives/instagram',
      row.version_id,
      `${row.media[0].media_asset_id}.jpg`,
    ].join('/')
    const sourceUrl = 'https://storage.example.test/signed-original-png'
    const derivativeUrl = 'https://storage.example.test/signed-instagram-jpeg'
    const createSignedUrl = vi.fn()
      .mockResolvedValueOnce({ data: { signedUrl: sourceUrl }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: derivativeUrl }, error: null })
    const fetchMedia = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ))
    const transformToJpeg = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      { status: 200, headers: { 'content-type': 'image/jpeg' } },
    ))
    const uploadDerivative = vi.fn().mockResolvedValue({ data: { path: derivativePath }, error: null })
    const probe = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }))

    await expect(loadApprovedPublishMaterial(row.workspace_id, row.schedule_id, {
      rpc: vi.fn().mockResolvedValue({ data: pngRow, error: null }),
      createSignedUrl,
      fetchMedia,
      transformToJpeg,
      uploadDerivative,
      probe,
    })).resolves.toMatchObject({ mediaUrls: [derivativeUrl] })

    expect(transformToJpeg).toHaveBeenCalledOnce()
    expect(uploadDerivative).toHaveBeenCalledWith(
      'content-media',
      derivativePath,
      expect.any(ArrayBuffer),
      {
        cacheControl: '86400',
        contentType: 'image/jpeg',
        upsert: true,
        metadata: {
          channel: 'instagram',
          contentVersionId: row.version_id,
          derivativeKind: 'publish-jpeg',
          sourceMediaAssetId: row.media[0].media_asset_id,
          sourceMimeType: 'image/png',
          sourceObjectPath: pngRow.media[0].object_path,
        },
      },
    )
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, 'content-media', pngRow.media[0].object_path, 900)
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, 'content-media', derivativePath, 3600)
    expect(probe).toHaveBeenCalledWith(derivativeUrl, expect.objectContaining({ method: 'HEAD' }))
  })
})
