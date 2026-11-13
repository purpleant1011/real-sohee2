import { describe, expect, it } from 'vitest'
import {
  buildApprovedMetaPublishPayload,
  buildReconciledMetaPublishPayload,
} from './meta-publish-payload'

const base = {
  workspace_id: '10000000-0000-4000-8000-000000000001',
  content_id: '11000000-0000-4000-8000-000000000001',
  schedule_id: '20000000-0000-4000-8000-000000000001',
  channel_connection_id: '21000000-0000-4000-8000-000000000001',
  schedule_status: 'publishing',
  version_id: '30000000-0000-4000-8000-000000000001',
  current_version_id: '30000000-0000-4000-8000-000000000001',
  approval_version_id: '30000000-0000-4000-8000-000000000001',
  version_fingerprint: 'a'.repeat(64),
  approval_fingerprint: 'a'.repeat(64),
  approval_status: 'approved',
  disclosure_confirmed: true,
  rights_confirmed: true,
  connection_status: 'connected',
  channel: 'instagram',
  connection_channel: 'instagram',
  external_account_id: 'ig-account-1',
  caption: '본문',
  hashtags: ['소희', '#예약'],
  disclosure: 'AI 보조 제작',
  media: [{
    position: 0,
    media_asset_id: '50000000-0000-4000-8000-000000000001',
    bucket_id: 'content-media',
    object_path: '10000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001/photo.jpg',
    mime_type: 'image/jpeg',
    rights_status: 'confirmed',
  }],
} as const

describe('approved Meta publish payload', () => {
  it('binds text and ordered media to the exact approved current version', () => {
    expect(buildApprovedMetaPublishPayload(base)).toEqual({
      workspaceId: base.workspace_id,
      contentId: base.content_id,
      scheduleId: base.schedule_id,
      channelConnectionId: base.channel_connection_id,
      versionId: base.version_id,
      fingerprint: base.version_fingerprint,
      channel: 'instagram',
      externalAccountId: 'ig-account-1',
      text: '본문\n\n#소희 #예약',
      media: [{ mediaId: base.media[0].media_asset_id, bucket: 'content-media', objectPath: base.media[0].object_path, mimeType: 'image/jpeg' }],
      isAiGenerated: true,
    })
  })

  it.each([
    ['current version changed', { current_version_id: '30000000-0000-4000-8000-000000000099' }],
    ['approval fingerprint changed', { approval_fingerprint: 'b'.repeat(64) }],
    ['rights not confirmed', { rights_confirmed: false }],
    ['channel mismatch', { connection_channel: 'threads' }],
  ])('fails closed when %s', (_label, change) => {
    expect(() => buildApprovedMetaPublishPayload({ ...base, ...change })).toThrow(
      '승인된 게시 버전을 다시 확인해 주세요.',
    )
  })

  it('rejects the final composed Threads text when caption and hashtags exceed 500 characters', () => {
    expect(() => buildApprovedMetaPublishPayload({
      ...base,
      channel: 'threads',
      connection_channel: 'threads',
      caption: '가'.repeat(500),
      hashtags: ['열한글자태그'],
      disclosure: 'AI 보조 제작',
      media: [],
    })).toThrow('승인된 게시 버전을 다시 확인해 주세요.')
  })

  it('parses the same exact approved version only for an unknown reconciliation schedule', () => {
    const unknown = { ...base, schedule_status: 'unknown' }
    expect(buildReconciledMetaPublishPayload(unknown)).toMatchObject({
      workspaceId: base.workspace_id,
      scheduleId: base.schedule_id,
      versionId: base.version_id,
    })
    expect(() => buildApprovedMetaPublishPayload(unknown)).toThrow()
    expect(() => buildReconciledMetaPublishPayload(base)).toThrow()
  })
})
