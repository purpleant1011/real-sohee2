import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadPrivateFileAction: vi.fn(),
  getUser: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  assetMaybeSingle: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
  upsert: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ from: () => ({ upsert: mocks.upsert }) }),
}))

vi.mock('@/features/knowledge/actions/upload-private-file', () => ({
  uploadPrivateFileAction: mocks.uploadPrivateFileAction,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: mocks.membershipMaybeSingle,
        }
        return query
      }
      const query = {
        update: mocks.update,
        eq: vi.fn(() => query),
        select: vi.fn(() => query),
        maybeSingle: mocks.assetMaybeSingle,
      }
      mocks.update.mockReturnValue(query)
      return query
    }),
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { uploadContentMediaAction } from './upload-content-media'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const assetId = '30000000-0000-4000-8000-000000000001'

function validForm() {
  const data = new FormData()
  data.set('workspaceId', workspaceId)
  data.set('file', new File([new Uint8Array([1])], 'asset.png', { type: 'image/png' }))
  data.set('rightsAcknowledged', 'true')
  return data
}

describe('uploadContentMediaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadPrivateFileAction.mockResolvedValue({
      data: { assetId, objectPath: 'safe/path', kind: 'content', status: 'pending' },
    })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'owner', status: 'active' },
      error: null,
    })
    mocks.assetMaybeSingle.mockResolvedValue({ data: { id: assetId }, error: null })
    mocks.upsert.mockResolvedValue({ error: null })
  })

  it('uploads validated bytes first and confirms rights only for a current manager role', async () => {
    const formData = validForm()

    await expect(uploadContentMediaAction(formData)).resolves.toEqual({
      data: { assetId, rightsStatus: 'confirmed' },
    })
    expect(mocks.uploadPrivateFileAction).toHaveBeenCalledWith(
      expect.objectContaining({ get: expect.any(Function) }),
    )
    expect(mocks.update).toHaveBeenCalledWith({ rights_status: 'confirmed' })
  })

  it('requires an explicit rights acknowledgement before uploading bytes', async () => {
    const formData = validForm()
    formData.delete('rightsAcknowledged')

    await expect(uploadContentMediaAction(formData)).resolves.toMatchObject({
      error: { requestId: 'content-media-upload' },
    })
    expect(mocks.uploadPrivateFileAction).not.toHaveBeenCalled()
  })

  it('keeps a reviewer upload pending instead of forging manager confirmation', async () => {
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'reviewer', status: 'active' },
      error: null,
    })

    await expect(uploadContentMediaAction(validForm())).resolves.toMatchObject({
      error: { message: expect.stringContaining('관리자') },
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('observes photo_uploaded for the confirmed asset only (ANI-1602)', async () => {
    await uploadContentMediaAction(validForm())
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: workspaceId, user_id: 'user-1', event: 'photo_uploaded', dedupe_key: `photo_uploaded:${assetId}` }),
      expect.anything(),
    )
  })

  it('does not observe an upload whose rights confirmation failed, and a telemetry failure never fails the upload', async () => {
    mocks.assetMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await uploadContentMediaAction(validForm())
    expect(mocks.upsert).not.toHaveBeenCalled()
    mocks.upsert.mockRejectedValue(new Error('db down'))
    await expect(uploadContentMediaAction(validForm())).resolves.toEqual({ data: { assetId, rightsStatus: 'confirmed' } })
  })
})
