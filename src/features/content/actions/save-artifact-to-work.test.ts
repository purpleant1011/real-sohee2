import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { saveArtifactToWork } from './save-artifact-to-work'

const input = {
  artifactId: '10000000-0000-4000-8000-000000000001',
  requestKey: '20000000-0000-4000-8000-000000000001',
}
const saved = {
  artifactId: input.artifactId,
  workItemId: '30000000-0000-4000-8000-000000000001',
  contentItemId: '40000000-0000-4000-8000-000000000001',
  versionId: '50000000-0000-4000-8000-000000000001',
  versionNumber: 1,
}

describe('saveArtifactToWork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '60000000-0000-4000-8000-000000000001' } },
      error: null,
    })
    mocks.rpc.mockResolvedValue({ data: saved, error: null })
  })

  it('uses the authenticated RPC with only the artifact and one-time request key', async () => {
    await expect(saveArtifactToWork(input)).resolves.toEqual({
      data: { ...saved, next: `/app/work/${saved.contentItemId}` },
    })

    expect(mocks.rpc).toHaveBeenCalledWith('save_conversation_artifact_to_work', {
      p_artifact_id: input.artifactId,
      p_request_key: input.requestKey,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/work')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/work/${saved.contentItemId}`)
  })

  it('rejects extra client supplied copy and media before authentication', async () => {
    await expect(saveArtifactToWork({
      ...input,
      caption: '클라이언트가 바꾼 문안',
      mediaAssetId: '70000000-0000-4000-8000-000000000001',
    })).resolves.toMatchObject({ error: { requestId: 'artifact-work-save' } })

    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('stops before the RPC when the authenticated user is unavailable', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })

    await expect(saveArtifactToWork(input)).resolves.toMatchObject({
      error: { message: '로그인 후 다시 시도해 주세요.' },
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not expose database details when saving fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('PRIVATE_DATABASE_DETAIL_WITH_IDS'),
    })

    await expect(saveArtifactToWork(input)).resolves.toEqual({
      error: {
        message: '결과물을 대화 결과에 저장하지 못했습니다. 상태를 확인하고 다시 시도해 주세요.',
        requestId: 'artifact-work-save',
      },
    })
  })
})
