import { describe, expect, it } from 'vitest'
import { buildApprovedMetaPublishPayload } from './meta-publish-payload'
import { buildApprovedChannelPreview, buildDraftChannelPreview, evaluateMetaChannelLimits } from './channel-preview'

const row = {
  workspace_id: '10000000-0000-4000-8000-000000000001', content_id: '11000000-0000-4000-8000-000000000001', schedule_id: '20000000-0000-4000-8000-000000000001',
  schedule_status: 'publishing', version_id: '30000000-0000-4000-8000-000000000001',
  current_version_id: '30000000-0000-4000-8000-000000000001', approval_version_id: '30000000-0000-4000-8000-000000000001',
  version_fingerprint: 'a'.repeat(64), approval_fingerprint: 'a'.repeat(64), approval_status: 'approved',
  disclosure_confirmed: true, rights_confirmed: true, connection_status: 'connected',
  channel: 'instagram', connection_channel: 'instagram',
  channel_connection_id: '40000000-0000-4000-8000-000000000001', external_account_id: '1789001',
  caption: '첫 줄\n둘째 줄', hashtags: ['소희', '#정확한버전'], disclosure: 'AI 보조 제작',
  media: [
    { position: 1, media_asset_id: '50000000-0000-4000-8000-000000000002', bucket_id: 'content-media', object_path: 'second.jpg', mime_type: 'image/jpeg', rights_status: 'confirmed' },
    { position: 0, media_asset_id: '50000000-0000-4000-8000-000000000001', bucket_id: 'content-media', object_path: 'first.jpg', mime_type: 'image/jpeg', rights_status: 'confirmed' },
  ],
}

describe('channel preview payload identity', () => {
  it('uses the exact version, copy, media ids, and order sent to the provider', () => {
    const payload = buildApprovedMetaPublishPayload(row)
    const preview = buildApprovedChannelPreview(payload, { versionNumber: 3, accountLabel: '@sohee' })
    expect(preview.versionId).toBe(payload.versionId)
    expect(preview.fingerprint).toBe(payload.fingerprint)
    expect(preview.text).toBe(payload.text)
    expect(preview.media.map((item) => item.mediaId)).toEqual(payload.media.map((item) => item.mediaId))
    expect(preview.media.map((item) => item.altText)).toEqual(['1번 이미지', '2번 이미지'])
    expect(preview.text).toBe('첫 줄\n둘째 줄\n\n#소희 #정확한버전')
  })

  it('blocks a Threads preview/payload that exceeds the provider copy limit', () => {
    expect(() => buildApprovedMetaPublishPayload({
      ...row, channel: 'threads', connection_channel: 'threads', caption: '가'.repeat(501), media: [],
    })).toThrow('승인된 게시 버전을 다시 확인해 주세요.')
  })

  it('fails closed when a draft violates the same provider media limits', () => {
    expect(() => buildDraftChannelPreview({
      channel: 'instagram',
      versionId: row.version_id,
      versionNumber: 1,
      fingerprint: row.version_fingerprint,
      caption: '본문',
      hashtags: [],
      disclosure: '',
      media: [],
    })).toThrow('승인된 게시 버전을 다시 확인해 주세요.')

    expect(() => buildDraftChannelPreview({
      channel: 'threads',
      versionId: row.version_id,
      versionNumber: 1,
      fingerprint: row.version_fingerprint,
      caption: '본문',
      hashtags: [],
      disclosure: '',
      media: [
        { id: row.media[0].media_asset_id, position: 0, mimeType: 'image/jpeg', altText: '첫 장' },
        { id: row.media[1].media_asset_id, position: 1, mimeType: 'image/jpeg', altText: '둘째 장' },
      ],
    })).toThrow('승인된 게시 버전을 다시 확인해 주세요.')
  })

  it('returns channel-specific repair guidance from the shared limit evaluator', () => {
    expect(evaluateMetaChannelLimits({ channel: 'threads', text: '본문', mediaCount: 2 }))
      .toEqual([{ code: 'threads_media', message: 'Threads는 현재 이미지 1장까지 게시할 수 있어요.' }])
  })

  it('classifies an overlong Instagram caption as a text issue', () => {
    expect(evaluateMetaChannelLimits({ channel: 'instagram', text: '가'.repeat(2_201), mediaCount: 1 }))
      .toEqual([{ code: 'instagram_text', message: 'Instagram 문구는 2,200자 이내로 줄여 주세요.' }])
  })
})
