import { describe, expect, it, vi } from 'vitest'
import type { ContentRepositoryGateway } from './repository'
import { getContentDetail, listConfirmedContentMedia, listContent } from './repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const foreignWorkspaceId = '10000000-0000-4000-8000-000000000002'
const firstMediaId = '40000000-0000-4000-8000-000000000001'
const secondMediaId = '40000000-0000-4000-8000-000000000002'

const rows = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    workspace_id: workspaceId,
    title: '여름 캠페인 초안',
    channel: 'instagram',
    status: 'draft',
    current_version_id: '30000000-0000-4000-8000-000000000001',
    created_at: '2026-08-09T01:00:00.000Z',
    updated_at: '2026-08-09T05:00:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    workspace_id: workspaceId,
    title: '승인 대기 게시물',
    channel: 'threads',
    status: 'review',
    current_version_id: '30000000-0000-4000-8000-000000000002',
    created_at: '2026-08-09T02:00:00.000Z',
    updated_at: '2026-08-09T04:00:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    workspace_id: workspaceId,
    title: '승인 완료 게시물',
    channel: 'instagram',
    status: 'approved',
    current_version_id: '30000000-0000-4000-8000-000000000003',
    created_at: '2026-08-09T03:00:00.000Z',
    updated_at: '2026-08-09T03:00:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    workspace_id: workspaceId,
    title: '복구가 필요한 게시물',
    channel: 'threads',
    status: 'scheduled',
    current_version_id: '30000000-0000-4000-8000-000000000004',
    created_at: '2026-08-09T04:00:00.000Z',
    updated_at: '2026-08-09T02:00:00.000Z',
  },
] as const

const versions = rows.map((row, index) => ({
  id: row.current_version_id,
  content_id: row.id,
  version_number: index + 1,
  caption: `${row.title} 본문`,
  created_at: row.updated_at,
}))

function gateway(overrides: Partial<ContentRepositoryGateway> = {}): ContentRepositoryGateway {
  return {
    listItems: vi.fn(async () => ({ data: rows, error: null })),
    listCurrentVersions: vi.fn(async () => ({ data: versions, error: null })),
    listFailedContentIds: vi.fn(async () => ({
      data: [{ content_id: rows[3].id }],
      error: null,
    })),
    getItem: vi.fn(async () => ({ data: rows[0], error: null })),
    listVersions: vi.fn(async () => ({
      data: [
        {
          ...versions[0],
          workspace_id: workspaceId,
          hashtags: ['#여름'],
          disclosure: '모의 콘텐츠 예시입니다.',
          fingerprint: 'a'.repeat(64),
          revision_reason: '첫 버전을 만들었어요.',
          rights: { confirmed: true },
          generation_evidence: { confirmed: true },
          structured_payload: {
            channel: 'instagram',
            caption: '여름 캠페인 초안 본문',
            hashtags: ['#여름'],
            slides: [
              {
                mediaId: firstMediaId,
                placement: 'cover',
                altText: '여름 관리 표지 이미지',
              },
              {
                mediaId: secondMediaId,
                placement: 'action',
                altText: '상담 행동 유도 이미지',
              },
            ],
            cta: '상담을 예약해 주세요.',
          },
          harness_rule_ids: ['70000000-0000-4000-8000-000000000001'],
          content_version_knowledge: [
            { knowledge_item_id: '60000000-0000-4000-8000-000000000001' },
          ],
        },
      ],
      error: null,
    })),
    listVersionMedia: vi.fn(async () => ({
      data: {
        links: [
          {
            workspace_id: workspaceId,
            version_id: versions[0].id,
            media_asset_id: secondMediaId,
            position: 1,
            media_assets: {
              id: secondMediaId,
              workspace_id: workspaceId,
              mime_type: 'image/png',
              rights_status: 'confirmed',
              width: 1080,
              height: 1350,
              size_bytes: 240_000,
            },
          },
          {
            workspace_id: foreignWorkspaceId,
            version_id: versions[0].id,
            media_asset_id: '40000000-0000-4000-8000-000000000099',
            position: 2,
            media_assets: {
              id: '40000000-0000-4000-8000-000000000099',
              workspace_id: foreignWorkspaceId,
              mime_type: 'image/png',
              rights_status: 'confirmed',
              width: 1080,
              height: 1350,
              size_bytes: 240_000,
            },
          },
          {
            workspace_id: workspaceId,
            version_id: versions[0].id,
            media_asset_id: firstMediaId,
            position: 0,
            media_assets: {
              id: firstMediaId,
              workspace_id: workspaceId,
              mime_type: 'image/png',
              rights_status: 'confirmed',
              // 서버가 원본 크기를 모르는 경우(옛 행·측정 실패) — 0 은 크기가 아니다.
              width: 0,
              height: null,
              size_bytes: null,
            },
          },
        ],
        artifacts: [{
          version_id: versions[0].id,
          artifact_slides: [
            {
              position: 2,
              role: 'action',
              media_asset_id: secondMediaId,
              alt_text: '상담 행동 유도 이미지',
              rights_status: 'confirmed',
            },
            {
              position: 1,
              role: 'cover',
              media_asset_id: firstMediaId,
              alt_text: '여름 관리 표지 이미지',
              rights_status: 'confirmed',
            },
          ],
        }],
      },
      error: null,
    })),
    listConfirmedMedia: vi.fn(async () => ({ data: [], error: null })),
    ...overrides,
  }
}

describe('listContent', () => {
  it('calculates tabs and filtered items from the same workspace-bound source', async () => {
    const result = await listContent(workspaceId, 'in_progress', null, '', gateway())

    expect(result.error).toBeUndefined()
    if (!result.data) throw new Error('expected content list data')

    expect(result.data.items).toHaveLength(2)
    expect(result.data.items.every((item) => ['draft', 'review'].includes(item.status))).toBe(true)
    expect(result.data.items.every((item) => item.source === 'actual')).toBe(true)
  })

  it('searches titles without changing the matching tab count contract', async () => {
    const result = await listContent(workspaceId, 'all', null, '승인', gateway())

    expect(result.data?.items.map((item) => item.title)).toEqual([
      '승인 대기 게시물',
      '승인 완료 게시물',
    ])
  })

  it('puts failed scheduled content only in the recovery tab', async () => {
    const result = await listContent(workspaceId, 'recovery', null, '', gateway())

    expect(result.data?.items.map((item) => item.id)).toEqual([rows[3].id])
  })

  it('rejects malformed workspace and cursor input before querying data', async () => {
    const source = gateway()

    expect((await listContent('unsafe', 'all', null, '', source)).error?.requestId).toBe(
      'content-list-input',
    )
    expect(
      (await listContent(workspaceId, 'all', 'not-a-date', '', source)).error?.requestId,
    ).toBe('content-list-input')
    expect(source.listItems).not.toHaveBeenCalled()
  })
})

describe('listConfirmedContentMedia', () => {
  it('returns only workspace-bound confirmed content assets', async () => {
    const assetId = '40000000-0000-4000-8000-000000000001'
    const source = gateway({
      listConfirmedMedia: vi.fn(async () => ({
        data: [
          {
            id: assetId,
            workspace_id: workspaceId,
            mime_type: 'image/png',
            size_bytes: 2048,
            created_at: '2026-08-09T05:00:00.000Z',
          },
        ],
        error: null,
      })),
    })

    await expect(listConfirmedContentMedia(workspaceId, source)).resolves.toEqual({
      data: [
        {
          id: assetId,
          mimeType: 'image/png',
          sizeBytes: 2048,
          createdAt: '2026-08-09T05:00:00.000Z',
        },
      ],
    })
  })
})

describe('getContentDetail', () => {
  it('reads historical draft evidence objects without inventing confirmation', async () => {
    const source = gateway()
    const original = await source.listVersions(workspaceId, rows[0].id)
    const version = (original.data as Record<string, unknown>[])[0]
    source.getItem = async () => ({ data: { ...rows[0], current_version_id: null }, error: null })
    source.listVersions = async () => ({ data: [{ ...version, rights: { mediaUrls: [] }, generation_evidence: { source: 'legacy' }, structured_payload: {} }], error: null })
    const result = await getContentDetail(workspaceId, rows[0].id, source)
    expect(result.error).toBeUndefined()
    expect(result.data?.currentVersionId).toBeNull()
    expect(result.data?.versions[0]).toMatchObject({
      caption: '여름 캠페인 초안 본문', rightsConfirmed: false, generationEvidenceConfirmed: false,
    })
  })

  it('returns the immutable version history newest first', async () => {
    const result = await getContentDetail(workspaceId, rows[0].id, gateway())

    expect(result.data?.title).toBe('여름 캠페인 초안')
    expect(result.data?.versions).toHaveLength(1)
    expect(result.data?.versions[0]).toMatchObject({
      versionNumber: 1,
      caption: '여름 캠페인 초안 본문',
      revisionReason: '첫 버전을 만들었어요.',
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaCount: 2,
      media: [
        {
          id: firstMediaId,
          position: 1,
          mimeType: 'image/png',
          altText: '여름 관리 표지 이미지',
          role: 'cover',
          rightsStatus: 'confirmed',
          // 크기를 모르는 행은 null 로 남긴다. 0 을 크기로 넘기지 않는다.
          width: null,
          height: null,
          sizeBytes: null,
        },
        {
          id: secondMediaId,
          position: 2,
          mimeType: 'image/png',
          altText: '상담 행동 유도 이미지',
          role: 'action',
          rightsStatus: 'confirmed',
          // 원본 기준 크기·용량은 업로드 때 기록된 값을 그대로 내려준다.
          width: 1080,
          height: 1350,
          sizeBytes: 240_000,
        },
      ],
      structuredPayload: expect.objectContaining({ channel: 'instagram' }),
      knowledgeIds: ['60000000-0000-4000-8000-000000000001'],
      harnessRuleIds: ['70000000-0000-4000-8000-000000000001'],
    })
  })

  it('preserves Naver image descriptions from the exact structured version when no artifact row exists', async () => {
    const versionId = versions[0].id
    const source = gateway({
      getItem: vi.fn(async () => ({ data: { ...rows[0], channel: 'naver_blog', current_version_id: versionId }, error: null })),
      listVersions: vi.fn(async () => ({ data: [{
        ...versions[0], workspace_id: workspaceId, hashtags: ['#바이름'], disclosure: '정보성 안내',
        fingerprint: 'c'.repeat(64), revision_reason: '공개 범위 변경', rights: { confirmed: true },
        generation_evidence: { confirmed: true }, harness_rule_ids: [], content_version_knowledge: [],
        structured_payload: {
          channel: 'naver_blog', title: '상담 기준', introduction: '도입',
          sections: [{ heading: '기준', body: '본문' }], keywords: ['바이름'],
          imagePlacements: [{ mediaId: firstMediaId, placement: 'cover', altText: '눈썹 상담 공개 표지' }],
          cta: '상담해 주세요.', visibility: 'public',
        },
      }], error: null })),
      listVersionMedia: vi.fn(async () => ({ data: {
        links: [{
          workspace_id: workspaceId, version_id: versionId, media_asset_id: firstMediaId, position: 0,
          media_assets: { id: firstMediaId, workspace_id: workspaceId, mime_type: 'image/png', rights_status: 'confirmed', width: 800, height: 800, size_bytes: 90_000 },
        }],
        artifacts: [],
      }, error: null })),
    })

    const result = await getContentDetail(workspaceId, rows[0].id, source)
    expect(result.data?.versions[0]?.media[0]).toMatchObject({
      id: firstMediaId, altText: '눈썹 상담 공개 표지', role: 'cover',
      width: 800, height: 800, sizeBytes: 90_000,
    })
  })

  it('keeps a safe non-empty image description on a revised Threads version without an artifact row', async () => {
    const versionId = versions[1].id
    const source = gateway({
      getItem: vi.fn(async () => ({ data: { ...rows[1], current_version_id: versionId }, error: null })),
      listVersions: vi.fn(async () => ({ data: [{
        ...versions[1], workspace_id: workspaceId, hashtags: ['#바이름'], disclosure: 'AI 제작 안내',
        fingerprint: 'd'.repeat(64), revision_reason: '대표 이미지 선택', rights: { confirmed: true },
        generation_evidence: { confirmed: true }, harness_rule_ids: [], content_version_knowledge: [],
        structured_payload: {
          channel: 'threads', segments: ['상담 기준을 확인해 보세요.'], mediaIds: [firstMediaId],
          question: '어떤 점이 궁금한가요?',
        },
      }], error: null })),
      listVersionMedia: vi.fn(async () => ({ data: {
        links: [{
          workspace_id: workspaceId, version_id: versionId, media_asset_id: firstMediaId, position: 0,
          media_assets: { id: firstMediaId, workspace_id: workspaceId, mime_type: 'image/png', rights_status: 'confirmed', width: 800, height: 800, size_bytes: 90_000 },
        }],
        artifacts: [],
      }, error: null })),
    })

    const result = await getContentDetail(workspaceId, rows[1].id, source)
    expect(result.data?.versions[0]?.media[0]).toMatchObject({
      id: firstMediaId, altText: '1번 게시 이미지', role: null,
    })
  })

  it('hides a missing or foreign-workspace content identifier as not found', async () => {
    const source = gateway({
      getItem: vi.fn(async (requestedWorkspaceId) => ({
        data: requestedWorkspaceId === foreignWorkspaceId ? rows[0] : null,
        error: null,
      })),
    })

    const result = await getContentDetail(workspaceId, rows[0].id, source)

    expect(result).toEqual({
      error: {
        message: '요청한 작업을 찾을 수 없습니다.',
        requestId: 'content-not-found',
      },
    })
    expect(source.listVersions).not.toHaveBeenCalled()
  })

  it('does not expose provider errors', async () => {
    const source = gateway({
      getItem: vi.fn(async () => ({ data: null, error: new Error('PRIVATE_DATABASE_DETAIL') })),
    })

    expect(await getContentDetail(workspaceId, rows[0].id, source)).toEqual({
      error: {
        message: '작업 상세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'content-detail',
      },
    })
  })
})
