import { describe, expect, it, vi, type Mock } from 'vitest'
import { uploadValidatedPrivateFile, type ValidatedUploadRepository } from './validated-upload'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'
const resourceId = '30000000-0000-4000-8000-000000000001'

function createFile(
  bytes: number[],
  type: string,
  name = 'upload.png',
): File {
  const value = new Uint8Array(bytes)

  return {
    name,
    type,
    size: value.byteLength,
    slice(start?: number, end?: number) {
      const sliced = value.slice(start, end)
      return {
        arrayBuffer: async () => sliced.buffer,
      } as Blob
    },
    arrayBuffer: async () => value.buffer,
  } as File
}

function createRepository(overrides: Partial<{
  [K in keyof ValidatedUploadRepository]: Mock<ValidatedUploadRepository[K]>
}> = {}) {
  return {
    registerAsset: overrides.registerAsset ?? vi.fn().mockResolvedValue({ error: null }),
    uploadObject: overrides.uploadObject ?? vi.fn().mockResolvedValue({ error: null }),
    registerKnowledgeChecking:
      overrides.registerKnowledgeChecking ?? vi.fn().mockResolvedValue({ error: null }),
    removeAsset: overrides.removeAsset ?? vi.fn().mockResolvedValue(undefined),
    removeObject: overrides.removeObject ?? vi.fn().mockResolvedValue(undefined),
  }
}

describe('uploadValidatedPrivateFile', () => {
  it('validates and stores content media with pending rights and no upsert', async () => {
    const repository = createRepository()
    const file = createFile(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'image/png',
    )

    await expect(
      uploadValidatedPrivateFile(
        {
          workspaceId,
          userId,
          resourceId,
          bucket: 'content-media',
          role: 'reviewer',
          file,
        },
        repository,
      ),
    ).resolves.toEqual({
      ok: true,
      assetId: resourceId,
      objectPath: `${workspaceId}/${userId}/${resourceId}/asset.png`,
      kind: 'content',
      status: 'pending',
    })

    expect(repository.registerAsset).toHaveBeenCalledWith({
      id: resourceId,
      workspace_id: workspaceId,
      bucket_id: 'content-media',
      object_path: `${workspaceId}/${userId}/${resourceId}/asset.png`,
      kind: 'content',
      mime_type: 'image/png',
      size_bytes: 8,
      sha256_digest: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
      rights_status: 'pending',
      created_by: userId,
    })
    const uploadedBody = repository.uploadObject.mock.calls[0]?.[2]
    expect(uploadedBody).toBeInstanceOf(Blob)
    expect(uploadedBody).toMatchObject({ type: 'image/png', size: 8 })
    expect(repository.uploadObject).toHaveBeenCalledWith(
      'content-media',
      `${workspaceId}/${userId}/${resourceId}/asset.png`,
      uploadedBody,
      { contentType: 'image/png', upsert: false },
    )
    expect(repository.registerKnowledgeChecking).not.toHaveBeenCalled()
  })

  it('records knowledge files as checking only after the object upload succeeds', async () => {
    const repository = createRepository()
    const file = createFile([0x25, 0x50, 0x44, 0x46], 'application/pdf', 'guide.pdf')

    const result = await uploadValidatedPrivateFile(
      {
        workspaceId,
        userId,
        resourceId,
        bucket: 'knowledge-files',
        role: 'manager',
        file,
      },
      repository,
    )

    expect(result).toMatchObject({ ok: true, kind: 'knowledge', status: 'checking' })
    expect(repository.registerKnowledgeChecking).toHaveBeenCalledWith({
      id: resourceId,
      workspace_id: workspaceId,
      media_asset_id: resourceId,
      name: 'guide.pdf',
      status: 'checking',
      evidence: { fileValidated: true },
      created_by: userId,
    })
    expect(repository.uploadObject.mock.invocationCallOrder[0]).toBeLessThan(
      repository.registerKnowledgeChecking.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('rejects a mismatched file signature before any provider call', async () => {
    const repository = createRepository()
    const file = createFile([0x25, 0x50, 0x44, 0x46], 'image/png')

    await expect(
      uploadValidatedPrivateFile(
        {
          workspaceId,
          userId,
          resourceId,
          bucket: 'content-media',
          role: 'owner',
          file,
        },
        repository,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })

    expect(repository.registerAsset).not.toHaveBeenCalled()
    expect(repository.uploadObject).not.toHaveBeenCalled()
  })

  it('validates the exact bytes uploaded even when typed-array slice is poisoned', async () => {
    const repository = createRepository()
    const originalSlice = Uint8Array.prototype.slice
    try {
      Uint8Array.prototype.slice = (() =>
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) as typeof Uint8Array.prototype.slice

      const result = await uploadValidatedPrivateFile(
        {
          workspaceId,
          userId,
          resourceId,
          bucket: 'content-media',
          role: 'owner',
          file: createFile([0x25, 0x50, 0x44, 0x46], 'image/png'),
        },
        repository,
      )

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UPLOAD_SIGNATURE_INVALID' },
      })
      expect(repository.uploadObject).not.toHaveBeenCalled()
    } finally {
      Uint8Array.prototype.slice = originalSlice
    }
  })

  it('rejects viewers before reading or storing the file', async () => {
    const repository = createRepository()
    const file = createFile(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'image/png',
    )

    await expect(
      uploadValidatedPrivateFile(
        { workspaceId, userId, resourceId, bucket: 'content-media', role: 'viewer', file },
        repository,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_FORBIDDEN',
        message: '이 작업공간에서는 파일을 업로드할 수 없습니다.',
      },
    })

    expect(repository.registerAsset).not.toHaveBeenCalled()
    expect(repository.uploadObject).not.toHaveBeenCalled()
  })

  it('removes registered metadata when object upload fails without leaking provider details', async () => {
    const repository = createRepository({
      uploadObject: vi.fn().mockRejectedValue(new Error('PRIVATE_STORAGE_DETAIL')),
    })
    const file = createFile(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'image/png',
    )

    const result = await uploadValidatedPrivateFile(
      { workspaceId, userId, resourceId, bucket: 'content-media', role: 'owner', file },
      repository,
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_PROVIDER_FAILED',
        message: '파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_DETAIL')
    expect(repository.removeAsset).toHaveBeenCalledWith(resourceId)
  })

  it('removes the uploaded object and asset when checking metadata cannot be recorded', async () => {
    const repository = createRepository({
      registerKnowledgeChecking: vi.fn().mockResolvedValue({
        error: { message: 'PRIVATE_DATABASE_DETAIL' },
      }),
    })
    const file = createFile([0x25, 0x50, 0x44, 0x46], 'application/pdf', 'guide.pdf')

    const result = await uploadValidatedPrivateFile(
      { workspaceId, userId, resourceId, bucket: 'knowledge-files', role: 'reviewer', file },
      repository,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_PROVIDER_FAILED' },
    })
    expect(repository.removeObject).toHaveBeenCalledWith(
      'knowledge-files',
      `${workspaceId}/${userId}/${resourceId}/asset.pdf`,
    )
    expect(repository.removeAsset).toHaveBeenCalledWith(resourceId)
  })
})
