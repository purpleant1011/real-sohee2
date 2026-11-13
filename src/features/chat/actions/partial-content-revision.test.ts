import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

const mocks = vi.hoisted(() => ({
  getPreview: vi.fn(),
  generateImage: vi.fn(),
  revise: vi.fn(),
  rpc: vi.fn(),
  getDetail: vi.fn(),
  loadFacts: vi.fn(),
  revalidatePath: vi.fn(),
  readiness: vi.fn(),
  assetLookup: vi.fn(),
}))

vi.mock('@/features/content/naver-revision-readiness', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/content/naver-revision-readiness')>(), loadNaverRevisionReadiness: mocks.readiness,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: mocks.getPreview }))
vi.mock('@/features/content/actions/generate-content-image', () => ({ generateContentImageAction: mocks.generateImage }))
vi.mock('@/features/content/actions/revise-content', () => ({ reviseContentAction: mocks.revise }))
vi.mock('@/features/content/repository', () => ({ getContentDetail: mocks.getDetail }))
vi.mock('@/features/knowledge/approved-fact-resolver', () => ({ loadApprovedFactSnapshot: mocks.loadFacts }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    rpc: mocks.rpc,
    from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.eq = () => q; q.maybeSingle = mocks.assetLookup; return q },
  })),
}))

import { partialContentRevisionAction } from './partial-content-revision'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'
const mediaOne = '50000000-0000-4000-8000-000000000001'
const mediaTwo = '50000000-0000-4000-8000-000000000002'
const replacement = '50000000-0000-4000-8000-000000000003'

function preview(versionNumber: number): ApprovalPreviewSnapshot {
  const versionId = `30000000-0000-4000-8000-${String(versionNumber).padStart(12, '0')}`
  const fingerprint = String(versionNumber).repeat(64).slice(0, 64)
  return {
    workspaceId,
    contentId,
    versionId,
    versionNumber,
    fingerprint,
    approval: { id: null, status: 'unreviewed', fingerprint: null },
    channel: 'instagram',
    account: {
      connectionId: '40000000-0000-4000-8000-000000000001',
      label: '@sohee',
      status: 'connected',
    },
    caption: '기존 본문',
    hashtags: ['#기존'],
    disclosure: 'AI 보조 제작',
    text: '기존 본문\n\n#기존\n\nAI 보조 제작',
    media: [
      { id: mediaOne, position: 1, mimeType: 'image/png', altText: '첫 이미지', src: '/media/one' },
      { id: mediaTwo, position: 2, mimeType: 'image/png', altText: '둘째 이미지', src: '/media/two' },
    ],
    issues: [],
  }
}

function input(scope: 'caption' | 'image_replace' | 'media_reorder' | 'media_limit' | 'disclosure_repair') {
  const current = preview(3)
  return {
    workspaceId,
    contentId,
    versionId: current.versionId,
    fingerprint: current.fingerprint,
    scope,
    instruction: '첫 문장만 더 짧게 바꿔줘',
    targetPosition: scope === 'image_replace' || scope === 'media_limit' ? 2 : null,
    orderedMediaIds: scope === 'media_reorder' ? [mediaTwo, mediaOne] : null,
  }
}

describe('partialContentRevisionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPreview.mockReset()
    mocks.readiness.mockResolvedValue('ready')
    mocks.revise.mockResolvedValue({
      data: {
        source: 'gemini',
        caption: '짧아진 본문',
        hashtags: ['#기존'],
        disclosure: 'AI 보조 제작',
        revisionReason: '첫 문장만 짧게 수정',
      },
    })
    mocks.generateImage.mockResolvedValue({
      data: { source: 'openai', assetId: replacement, rightsStatus: 'confirmed' },
    })
    mocks.rpc.mockResolvedValue({ data: preview(4).versionId, error: null })
    mocks.assetLookup.mockResolvedValue({ data: { id: replacement }, error: null })
  })

  it('creates one immutable next version while changing only the instructed caption', async () => {
    mocks.getPreview
      .mockResolvedValueOnce({ data: preview(3) })
      .mockResolvedValueOnce({ data: { ...preview(4), caption: '짧아진 본문' } })

    await expect(partialContentRevisionAction(input('caption'))).resolves.toMatchObject({
      data: { preview: { versionNumber: 4, caption: '짧아진 본문' }, revisionSummary: '본문만 수정했어요.' },
    })
    expect(mocks.revise).toHaveBeenCalledWith(expect.objectContaining({
      currentCaption: '기존 본문',
      currentHashtags: ['#기존'],
      inputType: 'caption',
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({
      p_expected_base_version_id: preview(3).versionId,
      p_expected_base_fingerprint: preview(3).fingerprint,
      p_caption: '짧아진 본문',
      p_hashtags: ['#기존'],
      p_media_ids: [mediaOne, mediaTwo],
    }))
  })

  it('preserves the existing disclosure when a caption revision returns an empty disclosure', async () => {
    mocks.revise.mockResolvedValueOnce({
      data: {
        source: 'gemini',
        caption: '짧아진 본문',
        hashtags: ['#기존'],
        disclosure: '',
        revisionReason: '본문에서 AI 문구 제거',
      },
    })
    mocks.getPreview
      .mockResolvedValueOnce({ data: preview(3) })
      .mockResolvedValueOnce({ data: preview(4) })

    await partialContentRevisionAction(input('caption'))

    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({
      p_caption: '짧아진 본문',
      p_disclosure: 'AI 보조 제작',
    }))
  })

  it('repairs only a missing disclosure in a new immutable version', async () => {
    const current = {
      ...preview(3),
      disclosure: '',
      issues: [{ code: 'disclosure', message: '게시 고지를 확인해 주세요.' }],
    }
    const next = {
      ...preview(4),
      disclosure: 'AI를 활용해 제작한 이미지와 문안입니다.',
      issues: [],
    }
    mocks.getPreview
      .mockResolvedValueOnce({ data: current })
      .mockResolvedValueOnce({ data: next })

    await expect(partialContentRevisionAction(input('disclosure_repair'))).resolves.toMatchObject({
      data: { revisionSummary: '안전한 게시 고지를 적용했어요.' },
    })
    expect(mocks.revise).not.toHaveBeenCalled()
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({
      p_caption: '기존 본문',
      p_hashtags: ['#기존'],
      p_disclosure: 'AI를 활용해 제작한 이미지와 문안입니다.',
      p_media_ids: [mediaOne, mediaTwo],
    }))
  })

  it('replaces only the selected image position and preserves the other media order', async () => {
    mocks.getPreview
      .mockResolvedValueOnce({ data: preview(3) })
      .mockResolvedValueOnce({ data: preview(4) })

    await expect(partialContentRevisionAction(input('image_replace'))).resolves.toMatchObject({
      data: { revisionSummary: '2번 이미지만 새 결과로 교체했어요.' },
    })
    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      versionId: preview(3).versionId,
      prompt: '첫 문장만 더 짧게 바꿔줘',
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({
      p_media_ids: [mediaOne, replacement],
    }))
  })

  it('swaps in an already composed image without generating a new one', async () => {
    mocks.getPreview
      .mockResolvedValueOnce({ data: preview(3) })
      .mockResolvedValueOnce({ data: preview(4) })

    await expect(partialContentRevisionAction({ ...input('image_replace'), existingAssetId: replacement })).resolves.toMatchObject({
      data: { revisionSummary: '2번 이미지를 문구를 얹은 이미지로 바꿨어요.' },
    })
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({ p_media_ids: [mediaOne, replacement] }))
  })

  it('refuses an existing asset that is not a confirmed image of this workspace', async () => {
    mocks.getPreview.mockResolvedValueOnce({ data: preview(3) })
    mocks.assetLookup.mockResolvedValue({ data: null, error: null })

    await expect(partialContentRevisionAction({ ...input('image_replace'), existingAssetId: replacement })).resolves.toMatchObject({
      error: { message: expect.stringContaining('이미지를 확인') },
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates a new Threads version with only the selected representative image', async () => {
    const current = {
      ...preview(3),
      channel: 'threads' as const,
      disclosure: '',
      issues: [
        { code: 'disclosure', message: '게시 고지를 확인해 주세요.' },
        { code: 'threads_media', message: 'Threads는 현재 이미지 1장까지 게시할 수 있어요.' },
      ],
    }
    const next = {
      ...preview(4),
      channel: 'threads' as const,
      media: [preview(4).media[1]],
      issues: [],
    }
    mocks.getPreview
      .mockResolvedValueOnce({ data: current })
      .mockResolvedValueOnce({ data: next })

    await expect(partialContentRevisionAction(input('media_limit'))).resolves.toMatchObject({
      data: { revisionSummary: '2번 이미지를 Threads 대표 이미지로 선택했어요.' },
    })
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('create_scoped_content_revision', expect.objectContaining({
      p_media_ids: [mediaTwo],
      p_disclosure: 'AI를 활용해 제작한 이미지와 문안입니다.',
    }))
  })

  it.each(['caption', 'hashtags', 'image_add', 'image_replace', 'media_reorder', 'media_limit', 'disclosure_repair'] as const)(
    'rejects Naver %s before spending credits or losing the structured manuscript', async (scope) => {
      mocks.getPreview.mockResolvedValue({ data: { ...preview(3), channel: 'naver_blog' } })

      const result = await partialContentRevisionAction({ ...input('caption'), scope })

      expect(result).toMatchObject({ error: { requestId: 'conversation-partial-revision-naver' } })
      expect(mocks.revise).not.toHaveBeenCalled()
      expect(mocks.generateImage).not.toHaveBeenCalled()
      expect(mocks.rpc).not.toHaveBeenCalled()
    },
  )

  it('rejects a stale conversation card before any AI or database mutation', async () => {
    mocks.getPreview.mockResolvedValueOnce({ data: preview(4) })

    await expect(partialContentRevisionAction(input('caption'))).resolves.toMatchObject({
      error: { requestId: 'conversation-partial-revision-stale' },
    })
    expect(mocks.revise).not.toHaveBeenCalled()
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['saved', 'claims', 'stale', 'approved-reused', 'fingerprint-reused', 'facts-changed', 'not-ready', 'readiness-error', 'rpc-missing'] as const)('ANI-1905: one-block revision boundary: %s', async scenario => {
    const naverCurrent = {
      ...preview(3),
      channel: 'naver_blog' as const,
      naverBlocks: [
        { kind: 'paragraph' as const, text: '기존 문단 1' },
        { kind: 'paragraph' as const, text: '기존 문단 2' },
      ],
      naverCopy: {
        title: '네이버 포스팅 제목',
        introduction: '기존 도입',
        sections: [{ heading: '섹션 1', body: '기존 본문' }],
        keywords: ['#네이버'],
        cta: '문의하기',
      },
    }
    mocks.getDetail.mockResolvedValue({ data: {
      id: contentId, channel: 'naver_blog', currentVersionId: preview(3).versionId,
      versions: [{
        id: preview(3).versionId, fingerprint: preview(3).fingerprint,
        structuredPayload: {
          channel: 'naver_blog', ...naverCurrent.naverCopy,
          ...(scenario === 'facts-changed' ? { factBasis: {
            workspaceId, snapshotHash: 'b'.repeat(64), resolvedAt: '2026-10-28T00:00:00Z', sources: [],
          } } : {}),
          editorBlocks: [
            ...naverCurrent.naverBlocks,
            { kind: 'image', mediaId: mediaOne, altText: '첫 이미지' },
            { kind: 'image', mediaId: mediaTwo, altText: '둘째 이미지' },
          ],
          imagePlacements: [
            { mediaId: mediaOne, placement: 'cover', altText: '첫 이미지' },
            { mediaId: mediaTwo, placement: 'inline', altText: '둘째 이미지' },
          ],
        },
      }],
    } })
    mocks.loadFacts.mockResolvedValue({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'a'.repeat(64), facts: [] })
    const naverNext = {
      ...preview(4),
      channel: 'naver_blog' as const,
      naverBlocks: [
        { kind: 'paragraph' as const, text: '기존 문단 1' },
        { kind: 'paragraph' as const, text: '수정된 문단 2' },
      ],
    }

    if (scenario === 'stale') mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    if (scenario === 'not-ready') mocks.readiness.mockResolvedValue('not_ready')
    if (scenario === 'readiness-error') mocks.readiness.mockResolvedValue('unavailable')
    if (scenario === 'rpc-missing') mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    if (scenario === 'approved-reused') naverNext.approval = { id: null, status: 'approved', fingerprint: preview(3).fingerprint }
    if (scenario === 'fingerprint-reused') naverNext.fingerprint = preview(3).fingerprint
    mocks.getPreview
      .mockResolvedValueOnce({ data: naverCurrent })
      .mockResolvedValueOnce({ data: naverNext })

    const result = await partialContentRevisionAction({
      workspaceId,
      contentId,
      versionId: preview(3).versionId,
      fingerprint: preview(3).fingerprint,
      scope: 'naver_block',
      targetBlockIndex: 1,
      instruction: scenario === 'claims' ? '커트 99,000원 무료 이벤트' : '수정된 문단 2',
      targetPosition: null,
      orderedMediaIds: null,
    })

    if (scenario !== 'saved') {
      expect(result.error).toBeDefined()
      if (['not-ready', 'readiness-error', 'rpc-missing'].includes(scenario)) {
        expect(result.error?.requestId).toBe('naver-revision-unavailable')
        if (scenario !== 'rpc-missing') expect(mocks.rpc).not.toHaveBeenCalled()
      }
      expect(mocks.generateImage).not.toHaveBeenCalled()
      expect(mocks.revise).not.toHaveBeenCalled()
      if (scenario === 'claims' || scenario === 'facts-changed') expect(mocks.rpc).not.toHaveBeenCalled()
      return
    }
    expect(result).toMatchObject({
      data: {
        preview: { versionNumber: 4 },
        revisionSummary: '2번 문단을 수정했어요.',
        diff: { blockId: `${preview(3).versionId}:1`, before: '기존 문단 2', after: '수정된 문단 2' },
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('create_naver_block_revision', {
      p_workspace_id: workspaceId, p_content_id: contentId,
      p_expected_base_version_id: preview(3).versionId, p_expected_base_fingerprint: preview(3).fingerprint,
      p_block_index: 1, p_replacement_text: '수정된 문단 2',
    })
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.revise).not.toHaveBeenCalled()
  })
})
