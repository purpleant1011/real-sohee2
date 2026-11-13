import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  versionMaybeSingle: vi.fn(),
  revise: vi.fn(),
  createProductionTextClient: vi.fn(),
  createOpenAIRevisionProvider: vi.fn(),
  openAIConstructor: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle:
          table === 'content_versions'
            ? mocks.versionMaybeSingle
            : mocks.membershipMaybeSingle,
      }
      return query
    }),
  })),
}))
vi.mock('@/lib/ai/gemini-responses-adapter', () => ({
  createProductionTextClient: mocks.createProductionTextClient,
}))
vi.mock('@/lib/providers/openai-revision-provider', () => ({
  createOpenAIRevisionProvider: mocks.createOpenAIRevisionProvider,
}))
vi.mock('openai', () => ({
  default: mocks.openAIConstructor,
}))

import { reviseContentAction } from './revise-content'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  channel: 'instagram' as const,
  instruction: '문구를 더 따뜻하고 간결하게 바꿔 줘.',
  inputType: 'full' as const,
  currentVersionFingerprint: 'a'.repeat(64),
}

describe('reviseContentAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'reviewer', status: 'active' },
      error: null,
    })
    mocks.versionMaybeSingle.mockResolvedValue({
      data: { content_id: input.contentId, fingerprint: input.currentVersionFingerprint },
      error: null,
    })
    const fakeClient = { responses: { create: vi.fn() } }
    mocks.createProductionTextClient.mockReturnValue(fakeClient)
    mocks.createOpenAIRevisionProvider.mockReturnValue({ mode: 'gemini', revise: mocks.revise })
    mocks.openAIConstructor.mockImplementation(function () { return { responses: { create: vi.fn() } } })
    mocks.revise.mockResolvedValue({
      caption: '소희 AI 수정 문구',
      hashtags: ['#소희'],
      disclosure: 'AI 생성 문구를 검토했습니다.',
      revisionReason: '소희 AI 수정',
    })
  })

  it('verifies the current stored version before returning visible Gemini output', async () => {
    await expect(reviseContentAction(input)).resolves.toEqual({
      data: {
        source: 'gemini',
        caption: '소희 AI 수정 문구',
        hashtags: ['#소희'],
        disclosure: 'AI 생성 문구를 검토했습니다.',
        revisionReason: '소희 AI 수정',
      },
    })
    expect(mocks.revise).toHaveBeenCalledWith(input)
    expect(mocks.createProductionTextClient).toHaveBeenCalled()
    expect(mocks.createOpenAIRevisionProvider).toHaveBeenCalledWith(expect.anything(), 'gemini')
    expect(mocks.openAIConstructor).not.toHaveBeenCalled()
  })

  it('rejects a stale fingerprint without calling the provider', async () => {
    mocks.versionMaybeSingle.mockResolvedValue({
      data: { content_id: input.contentId, fingerprint: 'b'.repeat(64) },
      error: null,
    })

    await expect(reviseContentAction(input)).resolves.toMatchObject({
      error: { requestId: 'content-revision-stale' },
    })
    expect(mocks.revise).not.toHaveBeenCalled()
    expect(mocks.createProductionTextClient).not.toHaveBeenCalled()
  })

  it('does not construct the provider when the member cannot revise content', async () => {
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'viewer', status: 'active' },
      error: null,
    })

    await expect(reviseContentAction(input)).resolves.toMatchObject({
      error: { requestId: 'content-revision' },
    })
    expect(mocks.createProductionTextClient).not.toHaveBeenCalled()
    expect(mocks.revise).not.toHaveBeenCalled()
  })
})
