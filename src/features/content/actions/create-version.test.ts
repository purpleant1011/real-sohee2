import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  versionMaybeSingle: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: table === 'content_versions' ? mocks.versionMaybeSingle : mocks.maybeSingle,
      }
      return query
    }),
    rpc: mocks.rpc,
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createVersionAction, createVersionWithClient } from './create-version'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  channel: 'instagram' as const,
  caption: '덮어쓰지 않고 새 버전으로 남기는 문구',
  hashtags: ['#소희', '#새버전'],
  disclosure: '모의 생성 콘텐츠입니다.',
  revisionReason: '표현을 더 명확하게 다듬었어요.',
  rightsConfirmed: true as const,
  generationEvidenceConfirmed: true as const,
  mediaIds: ['40000000-0000-4000-8000-000000000001'],
  structuredPayload: {
    channel: 'instagram' as const,
    caption: '덮어쓰지 않고 새 버전으로 남기는 문구',
    hashtags: ['#소희', '#새버전'],
    slides: [{
      mediaId: '40000000-0000-4000-8000-000000000001',
      placement: 'cover' as const,
      altText: '새 버전 안내 이미지',
    }],
    cta: '상담을 예약해 주세요.',
  },
  knowledgeIds: ['60000000-0000-4000-8000-000000000001'],
  harnessRuleIds: ['70000000-0000-4000-8000-000000000001'],
}

describe('createVersionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '10000000-0000-4000-8000-000000000001' } },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({
      data: { role: 'reviewer', status: 'active' },
      error: null,
    })
    mocks.rpc.mockResolvedValue({
      data: '50000000-0000-4000-8000-000000000001',
      error: null,
    })
    mocks.versionMaybeSingle.mockResolvedValue({
      data: { version_number: 2, fingerprint: 'b'.repeat(64) },
      error: null,
    })
  })

  it('revalidates authority with getUser and sends the exact immutable RPC input', async () => {
    await expect(createVersionAction(input)).resolves.toEqual({
      data: {
        versionId: '50000000-0000-4000-8000-000000000001',
        versionNumber: 2,
      },
    })

    expect(mocks.rpc).toHaveBeenCalledWith('create_content_version', {
      p_workspace_id: input.workspaceId,
      p_content_id: input.contentId,
      p_caption: input.caption,
      p_hashtags: input.hashtags,
      p_disclosure: input.disclosure,
      p_metadata: {
        rightsConfirmed: true,
        generationEvidenceConfirmed: true,
          mediaIds: input.mediaIds,
          knowledgeIds: input.knowledgeIds,
          harnessRuleIds: input.harnessRuleIds,
          structuredPayload: input.structuredPayload,
          revisionReason: input.revisionReason,
      },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/work/${input.contentId}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/work')
  })

  it('rejects malformed input before authentication or provider access', async () => {
    await expect(createVersionAction({ ...input, mediaIds: [] })).resolves.toEqual({
      error: {
        message: '새 버전 입력 내용을 확인해 주세요.',
        requestId: 'content-version',
      },
    })
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sends a text-only Threads version to the immutable RPC', async () => {
    const threadsInput = {
      ...input,
      channel: 'threads' as const,
      mediaIds: [],
      structuredPayload: {
        channel: 'threads' as const,
        segments: ['덮어쓰지 않고 새 버전으로 남기는 문구'],
        mediaIds: [],
        question: '어떤 점이 가장 궁금한가요?',
      },
    }

    await expect(createVersionAction(threadsInput)).resolves.toEqual({
      data: {
        versionId: '50000000-0000-4000-8000-000000000001',
        versionNumber: 2,
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_content_version',
      expect.objectContaining({
        p_metadata: expect.objectContaining({ mediaIds: [] }),
      }),
    )
  })

  it('stops when a current authenticated user is unavailable', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })

    await expect(createVersionAction(input)).resolves.toEqual({
      error: {
        message: '로그인 후 다시 시도해 주세요.',
        requestId: 'content-version',
      },
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails closed before the RPC for a viewer or inactive membership', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'viewer', status: 'active' }, error: null })

    await expect(createVersionAction(input)).resolves.toEqual({
      error: {
        message: '이 작업공간에서는 콘텐츠를 수정할 수 없습니다.',
        requestId: 'content-version',
      },
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not expose provider details when the RPC fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('private database detail and identifiers'),
    })

    await expect(createVersionAction(input)).resolves.toEqual({
      error: {
        message: '새 버전을 저장하지 못했습니다. 미디어와 권리 확인 상태를 다시 확인해 주세요.',
        requestId: 'content-version',
      },
    })
  })

  it('regression F2: createVersionWithClient parses version_number and fingerprint from DB row without strict schema error', async () => {
    const fakeFingerprint = 'e'.repeat(64)
    const fakeClient = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: '10000000-0000-4000-8000-000000000001' } },
          error: null,
        })),
      },
      from: vi.fn((table: string) => {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => {
            if (table === 'workspace_members') {
              return { data: { role: 'manager', status: 'active' }, error: null }
            }
            if (table === 'content_versions') {
              return { data: { version_number: 3, fingerprint: fakeFingerprint }, error: null }
            }
            return { data: null, error: null }
          }),
        }
        return query
      }),
      rpc: vi.fn(async () => ({
        data: '50000000-0000-4000-8000-000000000001',
        error: null,
      })),
    } as any

    const result = await createVersionWithClient(fakeClient, input)
    expect(result).toEqual({
      data: {
        versionId: '50000000-0000-4000-8000-000000000001',
        versionNumber: 3,
        fingerprint: fakeFingerprint,
      },
    })
  })
})
