import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { loadApprovedLocalPayload } from './payload-loader'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const actionId = '10000000-0000-4000-8000-000000000002'
const versionId = '10000000-0000-4000-8000-000000000003'
const approvalId = '10000000-0000-4000-8000-000000000004'
const connectionId = '10000000-0000-4000-8000-000000000005'
const mediaId = '10000000-0000-4000-8000-000000000006'
const fingerprint = 'a'.repeat(64)

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    loadAction: vi.fn().mockResolvedValue({
      id: actionId,
      workspace_id: workspaceId,
      channel: 'naver_blog',
      action_kind: 'blog_post',
      target_external_id: 'findk3',
      target_label: 'findk3 테스트 블로그',
      content_version_id: versionId,
      approval_id: approvalId,
      approval_fingerprint: fingerprint,
      browser_channel_connection_id: connectionId,
      ...overrides,
    }),
    loadVersion: vi.fn().mockResolvedValue({
      id: versionId,
      content_id: '10000000-0000-4000-8000-000000000007',
      fingerprint,
      structured_payload: {
        channel: 'naver_blog',
        title: '승인된 제목',
        introduction: '승인된 도입',
        sections: [{ heading: '첫 구역', body: '승인된 본문' }],
        keywords: ['소희'],
        imagePlacements: [{ mediaId, placement: 'cover', altText: '승인 이미지' }],
        cta: '문의해 주세요.',
      },
    }),
    loadCurrentContent: vi.fn().mockResolvedValue({ current_version_id: versionId }),
    loadApproval: vi.fn().mockResolvedValue({ id: approvalId, version_id: versionId, fingerprint, status: 'approved' }),
    loadConnection: vi.fn().mockResolvedValue({
      id: connectionId,
      channel: 'naver_blog',
      target_external_id: 'findk3',
      external_account_label: 'findk3 테스트 블로그',
      status: 'connected',
    }),
    listMedia: vi.fn().mockResolvedValue([{
      id: mediaId,
      position: 0,
      bucket_id: 'content-media',
      object_path: `${workspaceId}/user/${mediaId}/asset.png`,
      sha256_digest: 'b'.repeat(64),
    }]),
    createSignedUrl: vi.fn().mockResolvedValue('https://storage.example.test/asset.png?token=private'),
    backfillMediaDigest: vi.fn().mockResolvedValue(null),
  }
}

describe('approved local publish payload loader', () => {
  it('loads an exact approved job with ordered signed media', async () => {
    await expect(loadApprovedLocalPayload(workspaceId, actionId, '10000000-0000-4000-8000-000000000008', gateway()))
      .resolves.toMatchObject({
        data: {
          id: actionId,
          channel: 'naver_blog',
          targetExternalId: 'findk3',
          versionFingerprint: fingerprint,
          media: [{ id: mediaId, position: 0, digest: 'b'.repeat(64) }],
        },
      })
  })

  it('includes the connection environment and mutual-neighbor visibility in the approved job', async () => {
    const source = gateway()
    source.loadConnection.mockResolvedValue({
      id: connectionId, channel: 'naver_blog', target_external_id: 'findk3',
      external_account_label: '시험 블로그', environment: 'test', status: 'connected',
    })
    source.loadVersion.mockResolvedValue({
      id: versionId, content_id: '10000000-0000-4000-8000-000000000007', fingerprint,
      structured_payload: {
        channel: 'naver_blog', title: '승인된 제목', introduction: '승인된 도입',
        sections: [{ heading: '첫 구역', body: '승인된 본문' }], keywords: ['소희'],
        imagePlacements: [{ mediaId, placement: 'cover', altText: '승인 이미지' }],
        cta: '문의해 주세요.', visibility: 'mutual_neighbor',
      },
    })
    await expect(loadApprovedLocalPayload(workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source))
      .resolves.toMatchObject({ data: { environment: 'test', structuredPayload: { visibility: 'mutual_neighbor' } } })
  })

  it('publishes the strict Naver payload while ignoring its stored generation blueprint', async () => {
    const source = gateway()
    source.loadVersion.mockResolvedValue({
      id: versionId,
      content_id: '10000000-0000-4000-8000-000000000007',
      fingerprint,
      structured_payload: {
        channel: 'naver_blog', title: '승인된 제목', introduction: '승인된 도입',
        sections: [{ heading: '첫 구역', body: '승인된 본문' }], keywords: ['소희'],
        imagePlacements: [{ mediaId, placement: 'cover', altText: '승인 이미지' }],
        editorBlueprint: [{ kind: 'image_slot', position: 1, altText: '승인 이미지' }],
        editorBlocks: [{ kind: 'image', mediaId, altText: '승인 이미지' }],
        cta: '문의해 주세요.', visibility: 'private',
      },
    })

    const result = await loadApprovedLocalPayload(
      workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source,
    )
    expect(result).toMatchObject({ data: { structuredPayload: { channel: 'naver_blog' } } })
    if ('data' in result) expect(result.data.structuredPayload).not.toHaveProperty('editorBlueprint')
  })

  it('loads twenty approved Naver images without truncating their order', async () => {
    const source = gateway()
    const media = Array.from({ length: 20 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      position: index,
      bucket_id: 'content-media' as const,
      object_path: `${workspaceId}/user/asset-${index + 1}.png`,
      sha256_digest: String(index % 10).repeat(64),
    }))
    source.loadVersion.mockResolvedValue({
      id: versionId,
      content_id: '10000000-0000-4000-8000-000000000007',
      fingerprint,
      structured_payload: {
        channel: 'naver_blog', title: '상세 후기', introduction: '충분한 도입',
        sections: [{ heading: '강조 구간', body: '상세 본문' }], keywords: ['바이름'],
        imagePlacements: media.map((item, index) => ({
          mediaId: item.id, placement: index === 0 ? 'cover' : 'detail', altText: `이미지 ${index + 1}`,
        })),
        cta: '문의해 주세요.',
      },
    })
    source.listMedia.mockResolvedValue(media)

    const result = await loadApprovedLocalPayload(
      workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source,
    )
    expect(result).toMatchObject({ data: { media: expect.arrayContaining([
      expect.objectContaining({ position: 0 }), expect.objectContaining({ position: 19 }),
    ]) } })
    if ('data' in result) expect(result.data.media).toHaveLength(20)
  })

  it('fails closed when current version and approval differ', async () => {
    const source = gateway()
    source.loadCurrentContent.mockResolvedValue({ current_version_id: '10000000-0000-4000-8000-000000000099' })
    await expect(loadApprovedLocalPayload(workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source))
      .resolves.toEqual({ error: { code: 'REAPPROVAL_REQUIRED' } })
    expect(source.createSignedUrl).not.toHaveBeenCalled()
  })

  it('rejects media without a persisted SHA-256 digest', async () => {
    const source = gateway()
    source.listMedia.mockResolvedValue([{
      id: mediaId,
      position: 0,
      bucket_id: 'content-media',
      object_path: 'asset.png',
      sha256_digest: null,
    }])
    await expect(loadApprovedLocalPayload(workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source))
      .resolves.toEqual({ error: { code: 'MEDIA_DIGEST_REQUIRED' } })
  })

  it('backfills a missing legacy digest before exposing approved media to the connector', async () => {
    const source = gateway()
    source.listMedia.mockResolvedValue([{
      id: mediaId,
      position: 0,
      bucket_id: 'content-media',
      object_path: 'asset.png',
      sha256_digest: null,
    }])
    source.backfillMediaDigest.mockResolvedValue('c'.repeat(64))

    await expect(loadApprovedLocalPayload(
      workspaceId, actionId, '10000000-0000-4000-8000-000000000008', source,
    )).resolves.toMatchObject({ data: { media: [{ id: mediaId, digest: 'c'.repeat(64) }] } })
    expect(source.backfillMediaDigest).toHaveBeenCalledWith(workspaceId, expect.objectContaining({ id: mediaId }))
  })
})
