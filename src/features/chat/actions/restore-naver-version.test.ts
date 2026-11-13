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

import { restoreNaverVersionAction } from './restore-naver-version'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'
const v = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const media = '50000000-0000-4000-8000-000000000001'
const fp = (n: number) => String(n).repeat(64)

function payload(text: string, snapshotHash?: string) {
  return {
    channel: 'naver_blog', title: '제목', introduction: '도입', sections: [{ heading: '구분', body: '본문' }],
    keywords: ['태그'], cta: '문의',
    ...(snapshotHash ? { factBasis: { workspaceId, snapshotHash, resolvedAt: '2026-10-28T00:00:00Z', sources: [] } } : {}),
    editorBlocks: [{ kind: 'paragraph', text }, { kind: 'image', mediaId: media, altText: '사진' }],
    imagePlacements: [{ mediaId: media, placement: 'cover', altText: '사진' }],
  }
}

function next(over: Record<string, unknown> = {}) {
  return { data: { versionId: v(4), versionNumber: 4, fingerprint: fp(4), approval: { status: 'unreviewed' }, ...over } }
}

const input = { workspaceId, contentId, versionId: v(3), fingerprint: fp(3), sourceVersionId: v(1) }

describe('ANI-1905: restoreNaverVersionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readiness.mockResolvedValue('ready')
    mocks.loadFacts.mockResolvedValue({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'a'.repeat(64), facts: [] })
    mocks.getDetail.mockResolvedValue({ data: {
      id: contentId, channel: 'naver_blog', currentVersionId: v(3),
      versions: [
        { id: v(3), versionNumber: 3, fingerprint: fp(3), structuredPayload: payload('현재 문단') },
        { id: v(1), versionNumber: 1, fingerprint: fp(1), structuredPayload: payload('예전 문단') },
      ],
    } })
    mocks.rpc.mockResolvedValue({ data: v(4), error: null })
    mocks.getPreview.mockResolvedValue(next())
  })

  it.each(['not_ready', 'unavailable'])('does not call a mutation while command readiness is %s', async status => {
    mocks.readiness.mockResolvedValue(status)
    expect(await restoreNaverVersionAction(input)).toMatchObject({ error: { requestId: 'naver-revision-unavailable' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not mislabel a missing RPC as a version conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect(await restoreNaverVersionAction(input)).toMatchObject({ error: { requestId: 'naver-revision-unavailable' } })
  })

  it('appends the old content as a new unreviewed version', async () => {
    const result = await restoreNaverVersionAction(input)
    expect(result).toMatchObject({ data: { preview: { versionNumber: 4 }, summary: 'v1 내용을 새 버전으로 복원했어요.' } })
    expect(mocks.rpc).toHaveBeenCalledWith('restore_naver_version', {
      p_workspace_id: workspaceId, p_content_id: contentId,
      p_expected_base_version_id: v(3), p_expected_base_fingerprint: fp(3), p_source_version_id: v(1),
    })
  })

  it.each([
    ['restoring the current version', { sourceVersionId: v(3) }],
    ['a stale fingerprint', { fingerprint: fp(9) }],
    ['an unknown source', { sourceVersionId: v(8) }],
    ['malformed ids', { sourceVersionId: 'x' }],
  ])('rejects %s without writing', async (_name, patch) => {
    const result = await restoreNaverVersionAction({ ...input, ...patch })
    expect(result.error).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses a source whose fact basis is outdated', async () => {
    mocks.getDetail.mockResolvedValue({ data: {
      id: contentId, channel: 'naver_blog', currentVersionId: v(3),
      versions: [
        { id: v(3), versionNumber: 3, fingerprint: fp(3), structuredPayload: payload('현재 문단') },
        { id: v(1), versionNumber: 1, fingerprint: fp(1), structuredPayload: payload('예전 문단', 'b'.repeat(64)) },
      ],
    } })
    const result = await restoreNaverVersionAction(input)
    expect(result).toMatchObject({ error: { requestId: 'conversation-restore-naver-claims' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('treats an RPC conflict as stale', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001' } })
    await expect(restoreNaverVersionAction(input)).resolves.toMatchObject({ error: { requestId: 'conversation-restore-naver-stale' } })
  })

  it.each([
    ['reused approval', { approval: { status: 'approved' } }],
    ['reused fingerprint', { fingerprint: fp(3) }],
  ])('rejects a result with %s', async (_n, over) => {
    mocks.getPreview.mockResolvedValue(next(over))
    expect((await restoreNaverVersionAction(input)).error).toBeDefined()
  })
})
