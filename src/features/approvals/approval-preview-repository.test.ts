import { describe, expect, it, vi } from 'vitest'
import type { ContentDetail } from '@/features/content/types'
import { getApprovalPreview } from './approval-preview-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'
const versionId = '30000000-0000-4000-8000-000000000001'
const mediaA = '40000000-0000-4000-8000-000000000001'
const mediaB = '40000000-0000-4000-8000-000000000002'

const detail: ContentDetail = {
  id: contentId,
  title: '실제 버전 미리보기',
  status: 'review',
  channel: 'instagram',
  currentVersionId: versionId,
  currentVersionNumber: 3,
  createdAt: '2026-08-13T01:00:00.000Z',
  updatedAt: '2026-08-13T02:00:00.000Z',
  source: 'actual',
  versions: [{
    id: versionId,
    versionNumber: 3,
    caption: '정확한 본문',
    hashtags: ['소희'],
    disclosure: 'AI 보조 제작',
    fingerprint: 'a'.repeat(64),
    revisionReason: null,
    createdAt: '2026-08-13T02:00:00.000Z',
    rightsConfirmed: true,
    generationEvidenceConfirmed: true,
    mediaCount: 2,
    media: [
      { id: mediaB, position: 2, mimeType: 'image/png', altText: '둘째 장', role: 'detail', rightsStatus: 'confirmed' },
      // 원본 기준 크기·용량을 서버가 아는 사진(ANI-1764).
      { id: mediaA, position: 1, mimeType: 'image/jpeg', altText: '첫 장', role: 'cover', rightsStatus: 'confirmed', width: 1080, height: 1350, sizeBytes: 240_000 },
    ],
    structuredPayload: null,
    knowledgeIds: [],
    harnessRuleIds: [],
  }],
}

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    getContentDetail: vi.fn(async () => ({ data: detail })),
    listConnections: vi.fn(async () => ({ data: [{
      id: '50000000-0000-4000-8000-000000000001',
      workspace_id: workspaceId,
      channel: 'instagram',
      status: 'connected',
      account_label: '@sohee',
    }], error: null })),
    listApprovals: vi.fn(async () => ({ data: [{
      id: '60000000-0000-4000-8000-000000000001',
      workspace_id: workspaceId,
      content_id: contentId,
      version_id: versionId,
      fingerprint: 'a'.repeat(64),
      status: 'approved',
      decided_at: '2026-08-13T03:00:00.000Z',
    }], error: null })),
    ...overrides,
  }
}

describe('approval preview repository', () => {
  it('does not show a connected account as publish-ready when its token has expired', async () => {
    const result = await getApprovalPreview(workspaceId, contentId, gateway({ listConnections: async () => ({ data: [{
      id: '50000000-0000-4000-8000-000000000001', workspace_id: workspaceId, channel: 'instagram', status: 'connected', account_label: '@sohee', token_expires_at: '2000-01-01T00:00:00Z',
    }], error: null }) }))
    expect(result.data?.account.status).toBe('expired')
    expect(result.data?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'channel_expired' })]))
  })
  it('binds the connected account and ordered media to the exact current version', async () => {
    const result = await getApprovalPreview(workspaceId, contentId, gateway())
    expect(result.data).toMatchObject({
      contentId,
      versionId,
      versionNumber: 3,
      fingerprint: 'a'.repeat(64),
      channel: 'instagram',
      account: { label: '@sohee', status: 'connected' },
      approval: { status: 'approved', fingerprint: 'a'.repeat(64) },
      caption: '정확한 본문',
      hashtags: ['소희'],
      disclosure: 'AI 보조 제작',
      text: '정확한 본문\n\n#소희',
      issues: [],
    })
    expect(result.data?.media.map(({ id }) => id)).toEqual([mediaA, mediaB])
    expect(result.data?.media.map(({ src }) => src)).toEqual([
      `/api/workspaces/${workspaceId}/media/${mediaA}`,
      `/api/workspaces/${workspaceId}/media/${mediaB}`,
    ])
    // 원본 크기·용량은 서버가 아는 사진만 내려가고, 모르는 사진은 null 이다(0 으로 채우지 않는다).
    expect(result.data?.media.map(({ width, height, sizeBytes }) => ({ width, height, sizeBytes }))).toEqual([
      { width: 1080, height: 1350, sizeBytes: 240_000 },
      { width: null, height: null, sizeBytes: null },
    ])
  })

  it('fails closed when the repository returns a different workspace', async () => {
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      listConnections: vi.fn(async () => ({ data: [{
        id: '50000000-0000-4000-8000-000000000001', workspace_id: '90000000-0000-4000-8000-000000000001',
        channel: 'instagram', status: 'connected', account_label: '@other',
      }], error: null })),
    }))
    expect(result).toMatchObject({ error: { requestId: 'approval-preview' } })
  })

  it('reports an actionable issue for duplicate media positions and a disconnected channel', async () => {
    const brokenDetail: ContentDetail = {
      ...detail,
      versions: [{ ...detail.versions[0]!, media: detail.versions[0]!.media.map((media) => ({ ...media, position: 1 })) }],
    }
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      getContentDetail: vi.fn(async () => ({ data: brokenDetail })),
      listConnections: vi.fn(async () => ({ data: [], error: null })),
    }))
    expect(result.data?.account.status).toBe('disconnected')
    expect(result.data?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['media_order', 'channel_disconnected']))
  })

  it.each(['ready', 'not_ready', 'unavailable', 'throws'] as const)('keeps publishing and copy independent of Naver revision readiness: %s', async readiness => {
    const naverDetail: ContentDetail = {
      ...detail,
      channel: 'naver_blog',
      title: '반영구 눈썹 상담 전 확인 기준',
      versions: [{
        ...detail.versions[0]!,
        structuredPayload: {
          channel: 'naver_blog',
          title: '반영구 눈썹 상담 전 확인 기준',
          introduction: '상담 전에 확인할 내용을 정리했습니다.',
          sections: [{ heading: '원하는 디자인', body: '원하는 느낌을 구체적으로 알려주세요.' }],
          keywords: ['바이름', '반영구눈썹'],
          imagePlacements: [{ mediaId: mediaA, placement: 'cover', altText: '눈썹 상담 표지' }],
          editorBlocks: [
            { kind: 'paragraph', text: '상담 전에 확인할 내용입니다.' },
            { kind: 'image', mediaId: mediaA, altText: '눈썹 상담 표지' },
            { kind: 'cta', text: '상담 전에 궁금한 점을 정리해 보세요.' },
          ],
          cta: '상담 전에 궁금한 점을 정리해 보세요.',
          visibility: 'private',
        },
        media: [{ id: mediaA, position: 1, mimeType: 'image/png', altText: '눈썹 상담 표지', role: 'cover', rightsStatus: 'confirmed' }],
        mediaCount: 1,
      }],
    }
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      getContentDetail: vi.fn(async () => ({ data: naverDetail })),
      readNaverRevisionReadiness: readiness === 'throws' ? vi.fn().mockRejectedValue(new Error('private detail')) : vi.fn().mockResolvedValue(readiness),
      listConnections: vi.fn(async () => ({ data: [{
        id: '50000000-0000-4000-8000-000000000001', workspace_id: workspaceId,
        channel: 'naver_blog', status: 'connected', account_label: 'findk3',
      }], error: null })),
      listApprovals: vi.fn(async () => ({ data: [], error: null })),
    }))

    expect(result.data).toMatchObject({
      channel: 'naver_blog',
      visibility: 'private',
      account: { label: 'findk3', status: 'connected' },
      approval: { status: 'unreviewed' },
    })
    expect(result.data?.naverCopy).toEqual({
      title: '반영구 눈썹 상담 전 확인 기준',
      introduction: '상담 전에 확인할 내용을 정리했습니다.',
      sections: [{ heading: '원하는 디자인', body: '원하는 느낌을 구체적으로 알려주세요.' }],
      keywords: ['바이름', '반영구눈썹'],
      cta: '상담 전에 궁금한 점을 정리해 보세요.',
    })
    expect(result.data?.issues).toEqual([])
    expect(result.data?.naverRevisionReadiness).toBe(readiness === 'throws' ? 'unavailable' : readiness)
    expect(result.data?.text).toContain('반영구 눈썹 상담 전 확인 기준')
    expect(result.data?.text).toContain('상담 전에 확인할 내용입니다.')
    expect(result.data?.text).not.toContain('원하는 디자인')
    expect(result.data?.text).toBe([
      '반영구 눈썹 상담 전 확인 기준',
      '상담 전에 확인할 내용입니다.',
      '상담 전에 궁금한 점을 정리해 보세요.',
      'AI 보조 제작',
      '#바이름 #반영구눈썹',
    ].join('\n\n'))
    expect(result.data?.naverBlocks?.map((block) => block.kind)).toEqual(['paragraph', 'image', 'cta'])
  })

  it.each(['wrong_id', 'wrong_order', 'missing_image'] as const)('rejects Naver %s media rather than approving a different manuscript', async (mismatch) => {
    const placements = [mediaA, mediaB].map((mediaId) => ({ mediaId, placement: 'inline' as const, altText: '사진' }))
    const media = [detail.versions[0]!.media[1]!, detail.versions[0]!.media[0]!]
    const brokenMedia = mismatch === 'missing_image' ? media.slice(0, 1)
      : mismatch === 'wrong_order' ? media.map((item, index) => ({ ...item, position: 2 - index }))
      : media.map((item, index) => index === 0 ? { ...item, id: '40000000-0000-4000-8000-000000000003' } : item)
    const naverDetail: ContentDetail = {
      ...detail, channel: 'naver_blog', versions: [{
        ...detail.versions[0]!, media: brokenMedia,
        structuredPayload: {
          channel: 'naver_blog', title: '원고 제목', introduction: '원고 소개',
          sections: [{ heading: '원래 소제목', body: '원래 본문' }], keywords: ['안내'],
          imagePlacements: placements,
          editorBlocks: [{ kind: 'paragraph', text: '최종 본문' }, ...placements.map((item) => ({ kind: 'image' as const, mediaId: item.mediaId, altText: item.altText }))],
          cta: '문의해 주세요.',
        },
      }],
    }

    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      getContentDetail: vi.fn(async () => ({ data: naverDetail })),
      listConnections: vi.fn(async () => ({ data: [], error: null })),
      listApprovals: vi.fn(async () => ({ data: [], error: null })),
    }))

    expect(result).toMatchObject({ error: { requestId: 'approval-preview' } })
    expect(result.data).toBeUndefined()
  })

  it('keeps a Naver preview visible while a revoked Chrome connection awaits reconnection', async () => {
    const naverDetail: ContentDetail = {
      ...detail,
      channel: 'naver_blog',
      versions: [{
        ...detail.versions[0]!,
        structuredPayload: {
          channel: 'naver_blog', title: '눈썹 상담 안내', introduction: '상담 전 확인할 내용입니다.',
          sections: [{ heading: '맞춤 상담', body: '현재 눈썹과 원하는 분위기를 확인해 보세요.' }],
          keywords: ['눈썹상담'], imagePlacements: [{ mediaId: mediaA, placement: 'cover', altText: '눈썹 상담 표지' }],
          cta: '문의해 보세요.', visibility: 'public',
        },
        media: [detail.versions[0]!.media[1]!],
        mediaCount: 1,
      }],
    }
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      getContentDetail: vi.fn(async () => ({ data: naverDetail })),
      listConnections: vi.fn(async () => ({ data: [{
        id: '50000000-0000-4000-8000-000000000001', workspace_id: workspaceId,
        channel: 'naver_blog', status: 'revoked', account_label: 'findk3',
      }], error: null })),
      listApprovals: vi.fn(async () => ({ data: [], error: null })),
    }))

    expect(result.error).toBeUndefined()
    expect(result.data?.account).toMatchObject({ label: 'findk3', status: 'disconnected' })
    expect(result.data?.issues).toContainEqual(expect.objectContaining({ code: 'channel_disconnected' }))
  })

  it('produces a blocking issue when Threads credential lacks required publish scopes', async () => {
    const threadsDetail: ContentDetail = {
      ...detail,
      channel: 'threads',
      versions: [{
        ...detail.versions[0]!,
        caption: 'Threads 원고',
        hashtags: ['스레드'],
        media: [{ ...detail.versions[0]!.media[0]!, position: 1 }],
        mediaCount: 1,
      }],
    }
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      getContentDetail: vi.fn(async () => ({ data: threadsDetail })),
      listConnections: vi.fn(async () => ({ data: [{
        id: '50000000-0000-4000-8000-000000000001',
        workspace_id: workspaceId,
        channel: 'threads',
        status: 'connected',
        account_label: '@threads_user',
      }], error: null })),
      listMetaCredentials: vi.fn(async () => ({ data: [{
        channel_connection_id: '50000000-0000-4000-8000-000000000001',
        provider: 'threads',
        status: 'active',
        // missing threads_content_publish
        granted_scopes: [
          'threads_basic',
        ],
      }], error: null })),
    }))

    expect(result.error).toBeUndefined()
    expect(result.data?.issues).toContainEqual(expect.objectContaining({
      code: 'channel_missing_scope',
      message: 'Threads 연결이 만료되었거나 권한이 없어요. 채널을 다시 연결해 주세요.',
      recoveryHref: '/app/channels',
    }))
  })

  it('produces a blocking issue when Instagram credential lacks required publish scopes', async () => {
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      listMetaCredentials: vi.fn(async () => ({ data: [{
        channel_connection_id: '50000000-0000-4000-8000-000000000001',
        provider: 'instagram',
        status: 'active',
        // missing instagram_business_content_publish
        granted_scopes: [
          'instagram_business_basic',
        ],
      }], error: null })),
    }))

    expect(result.error).toBeUndefined()
    expect(result.data?.issues).toContainEqual(expect.objectContaining({
      code: 'channel_missing_scope',
      message: 'Instagram 연결이 만료되었거나 권한이 없어요. 채널을 다시 연결해 주세요.',
      recoveryHref: '/app/channels',
    }))
  })

  it('does not produce a channel_missing_scope issue when only publish scopes are granted', async () => {
    const result = await getApprovalPreview(workspaceId, contentId, gateway({
      listMetaCredentials: vi.fn(async () => ({ data: [{
        channel_connection_id: '50000000-0000-4000-8000-000000000001',
        provider: 'instagram',
        status: 'active',
        granted_scopes: [
          'instagram_business_basic',
          'instagram_business_content_publish',
        ],
      }], error: null })),
    }))

    expect(result.error).toBeUndefined()
    expect(result.data?.issues.some((issue) => issue.code === 'channel_missing_scope')).toBe(false)
  })
})

