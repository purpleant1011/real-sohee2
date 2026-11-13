import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPreview: vi.fn(), rpc: vi.fn(), getDetail: vi.fn(), loadFacts: vi.fn(), revalidatePath: vi.fn(), readiness: vi.fn(),
}))
vi.mock('@/features/content/naver-revision-readiness', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/content/naver-revision-readiness')>(), loadNaverRevisionReadiness: mocks.readiness,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: mocks.getPreview }))
vi.mock('@/features/content/repository', () => ({ getContentDetail: mocks.getDetail }))
vi.mock('@/features/knowledge/approved-fact-resolver', () => ({ loadApprovedFactSnapshot: mocks.loadFacts }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({ rpc: mocks.rpc })) }))

import { naverMetaRevisionAction } from './naver-meta-revision'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'
const media = '50000000-0000-4000-8000-000000000001'
const v = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fp = (n: number) => String(n).repeat(64)
const input = { workspaceId, contentId, versionId: v(3), fingerprint: fp(3), title: '새 제목', keywords: ['새태그', '#둘째', ' 새태그 '] }

function payload(factHash?: string) {
  return {
    channel: 'naver_blog', title: '기존 제목', introduction: '도입', sections: [{ heading: 'h', body: 'b' }],
    keywords: ['기존'], cta: '문의',
    ...(factHash ? { factBasis: { workspaceId, snapshotHash: factHash, resolvedAt: '2026-10-28T00:00:00Z', sources: [] } } : {}),
    editorBlocks: [{ kind: 'paragraph', text: '문단' }, { kind: 'image', mediaId: media, altText: '사진' }],
    imagePlacements: [{ mediaId: media, placement: 'cover', altText: '사진' }],
  }
}

describe('ANI-1905: naverMetaRevisionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readiness.mockResolvedValue('ready')
    mocks.loadFacts.mockResolvedValue({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'a'.repeat(64), facts: [] })
    mocks.getDetail.mockResolvedValue({ data: {
      id: contentId, channel: 'naver_blog', currentVersionId: v(3),
      versions: [{ id: v(3), fingerprint: fp(3), structuredPayload: payload() }],
    } })
    mocks.rpc.mockResolvedValue({ data: v(4), error: null })
    mocks.getPreview.mockResolvedValue({ data: { versionId: v(4), fingerprint: fp(4), approval: { status: 'unreviewed' } } })
  })

  it.each(['not_ready', 'unavailable'])('does not call a mutation while command readiness is %s', async status => {
    mocks.readiness.mockResolvedValue(status)
    expect(await naverMetaRevisionAction(input)).toMatchObject({ error: { requestId: 'naver-revision-unavailable' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not mislabel a missing RPC as a version conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect(await naverMetaRevisionAction(input)).toMatchObject({ error: { requestId: 'naver-revision-unavailable' } })
  })

  it('normalizes tags and sends only title/tags to the RPC', async () => {
    await expect(naverMetaRevisionAction(input)).resolves.toMatchObject({ data: { summary: '제목과 태그를 새 버전으로 저장했어요.' } })
    expect(mocks.rpc).toHaveBeenCalledWith('create_naver_meta_revision', {
      p_workspace_id: workspaceId, p_content_id: contentId,
      p_expected_base_version_id: v(3), p_expected_base_fingerprint: fp(3),
      p_title: '새 제목', p_keywords: ['새태그', '둘째'], p_hashtags: ['#새태그', '#둘째'],
    })
  })

  it.each([
    ['unchanged', { title: '기존 제목', keywords: ['기존'] }],
    ['blank tags', { keywords: ['#', ' '] }],
    ['stale fingerprint', { fingerprint: fp(9) }],
    ['malformed id', { versionId: 'x' }],
  ])('rejects %s without writing', async (_n, patch) => {
    expect((await naverMetaRevisionAction({ ...input, ...patch })).error).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('blocks when the fact basis is outdated', async () => {
    mocks.getDetail.mockResolvedValue({ data: {
      id: contentId, channel: 'naver_blog', currentVersionId: v(3),
      versions: [{ id: v(3), fingerprint: fp(3), structuredPayload: payload('b'.repeat(64)) }],
    } })
    await expect(naverMetaRevisionAction(input)).resolves.toMatchObject({ error: { requestId: 'conversation-naver-meta-claims' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('blocks guarantee wording in the title', async () => {
    const result = await naverMetaRevisionAction({ ...input, title: '네이버 검색 1위 보장' })
    expect(result.error).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['conflict', () => mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001' } })],
    ['reused approval', () => mocks.getPreview.mockResolvedValue({ data: { versionId: v(4), fingerprint: fp(4), approval: { status: 'approved' } } })],
    ['reused fingerprint', () => mocks.getPreview.mockResolvedValue({ data: { versionId: v(4), fingerprint: fp(3), approval: { status: 'unreviewed' } } })],
  ])('fails closed on %s', async (_n, arrange) => {
    arrange()
    expect((await naverMetaRevisionAction(input)).error).toBeDefined()
  })
})
