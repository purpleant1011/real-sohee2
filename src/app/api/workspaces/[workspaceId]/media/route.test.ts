import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/content/actions/upload-content-media', () => ({
  uploadContentMediaAction: vi.fn(),
}))

import { createWorkspaceMediaPostHandler } from './route'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('POST workspace conversation media', () => {
  it('binds the upload to the workspace path and returns the confirmed asset', async () => {
    const upload = vi.fn(async (formData: FormData) => ({
      data: {
        assetId: '30000000-0000-4000-8000-000000000001',
        rightsStatus: 'confirmed' as const,
      },
      receivedWorkspaceId: formData.get('workspaceId'),
    }))
    const formData = new FormData()
    formData.set('workspaceId', '40000000-0000-4000-8000-000000000001')
    formData.set('rightsAcknowledged', 'true')
    formData.set('file', new File(['image'], 'asset.png', { type: 'image/png' }))

    const response = await createWorkspaceMediaPostHandler({ upload })(
      { formData: async () => formData } as Request,
      { params: Promise.resolve({ workspaceId }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        assetId: '30000000-0000-4000-8000-000000000001',
        rightsStatus: 'confirmed',
      },
    })
    await expect(upload.mock.results[0]?.value).resolves.toMatchObject({ receivedWorkspaceId: workspaceId })
  })
})
