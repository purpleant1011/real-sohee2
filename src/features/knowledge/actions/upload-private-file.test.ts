import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  uploadValidatedPrivateFile: vi.fn(),
  createValidatedUploadRepository: vi.fn(() => ({ repository: true })),
  createAdminSupabaseClient: vi.fn(() => ({ admin: true })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: mocks.maybeSingle,
      }
      return query
    }),
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))
vi.mock('@/lib/supabase/validated-upload-repository', () => ({
  createValidatedUploadRepository: mocks.createValidatedUploadRepository,
}))
vi.mock('@/lib/supabase/validated-upload', () => ({
  uploadValidatedPrivateFile: mocks.uploadValidatedPrivateFile,
}))

import { uploadPrivateFileAction } from './upload-private-file'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('uploadPrivateFileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({
      data: { role: 'reviewer', status: 'active' },
      error: null,
    })
    mocks.uploadValidatedPrivateFile.mockResolvedValue({
      ok: true,
      assetId: '30000000-0000-4000-8000-000000000001',
      objectPath: 'safe/path',
      kind: 'content',
      status: 'pending',
    })
  })

  it('derives the user and role on the server instead of trusting submitted authority', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'upload.png', {
      type: 'image/png',
    })
    const formData = new FormData()
    formData.set('workspaceId', workspaceId)
    formData.set('bucket', 'content-media')
    formData.set('file', file)
    formData.set('userId', '90000000-0000-4000-8000-000000000009')
    formData.set('role', 'owner')

    await expect(uploadPrivateFileAction(formData)).resolves.toMatchObject({
      data: { kind: 'content', status: 'pending' },
    })

    expect(mocks.uploadValidatedPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        userId,
        role: 'reviewer',
        bucket: 'content-media',
        file,
        resourceId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
      { repository: true },
    )
  })

  it('stops before the admin client when the session is not verified', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })

    await expect(uploadPrivateFileAction(new FormData())).resolves.toEqual({
      error: {
        message: '로그인 후 다시 시도해 주세요.',
        requestId: 'private-upload',
      },
    })

    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
    expect(mocks.uploadValidatedPrivateFile).not.toHaveBeenCalled()
  })

  it('stops before the admin client when an active viewer attempts an upload', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { role: 'viewer', status: 'active' },
      error: null,
    })
    const formData = new FormData()
    formData.set('workspaceId', workspaceId)
    formData.set('bucket', 'content-media')
    formData.set('file', new File([new Uint8Array([1])], 'upload.png'))

    await expect(uploadPrivateFileAction(formData)).resolves.toEqual({
      error: {
        message: '이 작업공간에서는 파일을 업로드할 수 없습니다.',
        requestId: 'private-upload',
      },
    })

    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
    expect(mocks.uploadValidatedPrivateFile).not.toHaveBeenCalled()
  })
})
