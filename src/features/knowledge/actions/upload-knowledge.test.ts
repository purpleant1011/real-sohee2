import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadPrivateFileAction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('./upload-private-file', () => ({
  uploadPrivateFileAction: mocks.uploadPrivateFileAction,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { uploadKnowledgeAction } from './upload-knowledge'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const knowledgeId = '60000000-0000-4000-8000-000000000001'

function validForm() {
  const data = new FormData()
  data.set('workspaceId', workspaceId)
  data.set('file', new File(['trusted text'], 'guide.txt', { type: 'text/plain' }))
  return data
}

describe('uploadKnowledgeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadPrivateFileAction.mockResolvedValue({
      data: {
        assetId: knowledgeId,
        objectPath: `${workspaceId}/guide.txt`,
        kind: 'knowledge',
        status: 'checking',
      },
    })
  })

  it('uses the private knowledge bucket and keeps new files in checking', async () => {
    await expect(uploadKnowledgeAction(validForm())).resolves.toEqual({
      data: { knowledgeId, status: 'checking' },
    })

    const forwarded = mocks.uploadPrivateFileAction.mock.calls[0]?.[0] as FormData
    expect(forwarded.get('workspaceId')).toBe(workspaceId)
    expect(forwarded.get('bucket')).toBe('knowledge-files')
    expect(forwarded.get('file')).toBeInstanceOf(File)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/account/knowledge')
  })

  it('does not call the private uploader without both workspace and file', async () => {
    await expect(uploadKnowledgeAction(new FormData())).resolves.toMatchObject({
      error: { requestId: 'knowledge-upload' },
    })
    expect(mocks.uploadPrivateFileAction).not.toHaveBeenCalled()
  })
})
