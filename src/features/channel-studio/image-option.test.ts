import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  maybeGenerateStudioImage,
  cleanupQuarantineQuickImage,
  STUDIO_IMAGE_FALLBACK_NOTICE,
} from './image-option'
import type { OpenAIImageClient, ImageGenerationCallInput, ImageGenerationCallOutput } from '@/features/creative/openai-image-client'

function createFakeImageClient(impl?: (input: ImageGenerationCallInput) => Promise<ImageGenerationCallOutput>): {
  client: OpenAIImageClient
  calls: ImageGenerationCallInput[]
} {
  const calls: ImageGenerationCallInput[] = []
  const client: OpenAIImageClient = {
    generateImage: vi.fn(async (input: ImageGenerationCallInput) => {
      calls.push(input)
      if (impl) return impl(input)
      return {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        mimeType: 'image/png',
        sha256Digest: 'fake-sha256',
        providerRequestId: 'req-fake',
        model: 'gpt-image-2.5-sunburst',
        promptTokensEstimate: 100,
        imageTokensEstimate: 1024,
      }
    }),
  }
  return { client, calls }
}

function createFakeAdmin(overrides?: {
  uploadError?: Error | null
  insertError?: Error | null
}) {
  const storageUpload = vi.fn().mockImplementation(async () => {
    if (overrides?.uploadError) {
      return { error: overrides.uploadError }
    }
    return { data: { path: 'uploaded-path' }, error: null }
  })
  const storageRemove = vi.fn().mockResolvedValue({ error: null })
  const dbInsert = vi.fn().mockImplementation(async () => {
    if (overrides?.insertError) {
      return { error: overrides.insertError }
    }
    return { data: null, error: null }
  })

  return {
    storageUpload,
    storageRemove,
    dbInsert,
    admin: {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUpload,
          remove: storageRemove,
        }),
      },
      from: vi.fn().mockReturnValue({
        insert: dbInsert,
      }),
    },
  }
}

describe('maybeGenerateStudioImage', () => {
  const validWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const validUserId = '22222222-2222-4222-8222-222222222222'

  const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

  beforeEach(() => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
  })

  afterEach(() => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
  })

  const baseContext = {
    businessName: '봄빛 베이커리',
    industry: '베이커리 카페',
    location: '서울 마포구',
    summary: '매일 아침 유기농 밀가루로 빵을 굽는 작은 베이커리입니다.',
    brandVoice: '따뜻하고 정겨운 어조',
  }

  it('includeImage=false일 때 외부 호출 0회 및 빈 목록 반환 (RED baseline)', async () => {
    const { client, calls } = createFakeImageClient()
    const { admin, storageUpload, dbInsert } = createFakeAdmin()

    const result = await maybeGenerateStudioImage({
      includeImage: false,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result).toEqual({
      imageIds: [],
      notice: null,
      media: [],
    })
    expect(calls.length).toBe(0)
    expect(storageUpload).not.toHaveBeenCalled()
    expect(dbInsert).not.toHaveBeenCalled()
  })

  it('includeImage=true일 때 1장 생성 및 저장 성공 반환', async () => {
    const { client, calls } = createFakeImageClient()
    const { admin, storageUpload, dbInsert } = createFakeAdmin()

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(calls.length).toBe(1)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(dbInsert).toHaveBeenCalledTimes(1)
    expect(result.imageIds.length).toBe(1)
    expect(typeof result.imageIds[0]).toBe('string')
    expect(result.imageIds[0]?.length).toBeGreaterThan(0)
    expect(result.notice).toBeNull()
    expect(result.media).toEqual([{ type: 'image', mimeType: 'image/png', fileSizeBytes: 8 }])
  })

  it('includeImage=true이지만 provider 호출 실패 시 throw하지 않고 한국어 안내 반환', async () => {
    const { client } = createFakeImageClient(async () => {
      throw new Error('OpenAI billing quota exceeded or 429 rate limit (secret_key=sk-proj-xxx)')
    })
    const { admin } = createFakeAdmin()

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result.imageIds).toEqual([])
    expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
    expect(result.notice).toBe('이미지는 만들지 못해서 글만 보여드려요. 나중에 다시 시도할 수 있어요.')
    expect(result.notice).not.toContain('sk-proj')
    expect(result.notice).not.toContain('OpenAI')
  })

  it('includeImage=true이지만 저장(storage/DB) 실패 시 throw하지 않고 한국어 안내 반환 (F1: providerAttempted=true, needsReconciliation=true)', async () => {
    const { client } = createFakeImageClient()
    const { admin } = createFakeAdmin({
      uploadError: new Error('S3 storage timeout'),
    })

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result.imageIds).toEqual([])
    expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
    expect(result.providerAttempted).toBe(true)
    expect(result.needsReconciliation).toBe(true)
  })

  it('F1/F4: DB insert failure retains providerRequestId for operator reconciliation', async () => {
    const { client } = createFakeImageClient()
    const { admin } = createFakeAdmin({
      insertError: new Error('media_assets DB insert failure'),
    })

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result.imageIds).toEqual([])
    expect(result.providerAttempted).toBe(true)
    expect(result.needsReconciliation).toBe(true)
    expect(result.providerRequestId).toBe('req-fake')
  })

  it('F6: source gate failure mid-generation cleans up freshly stored asset and marks needsReconciliation', async () => {
    const { client } = createFakeImageClient()
    const storageRemove = vi.fn().mockResolvedValue({ error: null })
    const dbDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    const storageUpload = vi.fn().mockResolvedValue({ data: { path: 'uploaded-path' }, error: null })
    const dbInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    const fakeAdmin = {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUpload,
          remove: storageRemove,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'media_assets') {
          return {
            insert: dbInsert,
            delete: dbDelete,
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        return {
          insert: dbInsert,
        }
      }),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 2,
              items: [
                {
                  category: 'visual',
                  content: '모던한 인테리어와 베이지 톤',
                  source_id: '33333333-3333-4333-8333-333333333333',
                  source_revision: 1,
                },
              ],
            },
            error: null,
          })
        }
        if (fn === 'validate_learning_result') {
          // Source was revoked mid-generation!
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin: fakeAdmin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result.imageIds).toEqual([])
    expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
    expect(result.providerAttempted).toBe(true)
    expect(result.needsReconciliation).toBe(true)
    expect(dbDelete).toHaveBeenCalled()
    expect(storageRemove).toHaveBeenCalled()
  })

  it('SOHEE_CHANNEL_LEARNING_ENABLED !== 1 이면 channel visual 지식 제외 및 게이트 비수집 (결함 5 검증)', async () => {
    const originalFlag = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '0'

    try {
      const { client, calls } = createFakeImageClient()
      const storageUpload = vi.fn().mockResolvedValue({ data: { path: 'uploaded-path' }, error: null })
      const dbInsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const rpcValidate = vi.fn().mockResolvedValue({ data: true, error: null })

      const fakeAdmin = {
        storage: { from: vi.fn().mockReturnValue({ upload: storageUpload }) },
        from: vi.fn().mockReturnValue({ insert: dbInsert }),
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === 'get_approved_learning_context') {
            return Promise.resolve({
              data: {
                epoch: 2,
                items: [
                  {
                    category: 'visual',
                    content: '모던한 인테리어와 베이지 톤',
                    source_type: 'channel',
                    source_id: '33333333-3333-4333-8333-333333333333',
                    source_revision: 1,
                  },
                ],
              },
              error: null,
            })
          }
          if (fn === 'validate_learning_result') {
            return rpcValidate()
          }
          return Promise.resolve({ data: null, error: null })
        }),
      }

      const result = await maybeGenerateStudioImage({
        includeImage: true,
        admin: fakeAdmin,
        workspaceId: validWorkspaceId,
        userId: validUserId,
        topic: '신제품 소금빵 출시',
        context: baseContext,
        imageClient: client,
      })

      expect(result.imageIds.length).toBe(1)
      expect(calls.length).toBe(1)
      // Visual guide must NOT be injected into prompt when flag is off
      expect(calls[0]?.prompt).not.toContain('학습된 매장 시각 가이드')
      // Gate check must NOT run when channel dependencies are excluded
      expect(rpcValidate).not.toHaveBeenCalled()
    } finally {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalFlag
    }
  })

  it('사후 게이트 실패 후 cleanupQuarantineQuickImage 결과 success false 시 console.error 및 quarantineFailed 표식 반환 (결함 7 검증)', async () => {
    const originalFlag = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { client } = createFakeImageClient()
      const storageUpload = vi.fn().mockResolvedValue({ data: { path: 'uploaded-path' }, error: null })
      const dbInsert = vi.fn().mockResolvedValue({ data: null, error: null })

      // cleanupQuarantineQuickImage calls will fail
      const storageRemove = vi.fn().mockResolvedValue({ error: new Error('Storage removal failed') })
      const dbDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: new Error('DB delete failed') }),
        }),
      })
      const dbUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: new Error('DB update failed') }),
        }),
      })

      const fakeAdmin = {
        storage: {
          from: vi.fn().mockReturnValue({
            upload: storageUpload,
            remove: storageRemove,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'media_assets') {
            return {
              insert: dbInsert,
              delete: dbDelete,
              update: dbUpdate,
            }
          }
          return { insert: dbInsert }
        }),
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === 'get_approved_learning_context') {
            return Promise.resolve({
              data: {
                epoch: 2,
                items: [
                  {
                    category: 'visual',
                    content: '모던한 인테리어와 베이지 톤',
                    source_type: 'channel',
                    source_id: '33333333-3333-4333-8333-333333333333',
                    source_revision: 1,
                  },
                ],
              },
              error: null,
            })
          }
          if (fn === 'validate_learning_result') {
            return Promise.resolve({ data: false, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
      }

      const result = await maybeGenerateStudioImage({
        includeImage: true,
        admin: fakeAdmin,
        workspaceId: validWorkspaceId,
        userId: validUserId,
        topic: '신제품 소금빵 출시',
        context: baseContext,
        imageClient: client,
      })

      expect(result.imageIds).toEqual([])
      expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
      expect(result.providerAttempted).toBe(true)
      expect(result.needsReconciliation).toBe(true)
      expect(result.quarantineFailed).toBe(true)
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalFlag
    }
  })

  it('location/summary/brandVoice가 null이거나 비어있어도 안전하게 1장 생성', async () => {
    const { client, calls } = createFakeImageClient()
    const { admin, storageUpload, dbInsert } = createFakeAdmin()

    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '가게 소개',
      context: {
        businessName: '봄빛 베이커리',
        industry: '베이커리',
        location: null,
        summary: null,
        brandVoice: null,
      },
      imageClient: client,
    })

    expect(calls.length).toBe(1)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(dbInsert).toHaveBeenCalledTimes(1)
    expect(result.imageIds.length).toBe(1)
    expect(result.notice).toBeNull()
  })

  it('SNS 게시 API를 전혀 호출하지 않고 이미지 저장까지만 완료', async () => {
    const { client, calls } = createFakeImageClient()
    const { admin, storageUpload, dbInsert } = createFakeAdmin()

    // admin 객체에 SNS 관련 메서드가 없음을 확인하고, 오직 storage/media_assets만 접근하는지 확인
    const result = await maybeGenerateStudioImage({
      includeImage: true,
      admin,
      workspaceId: validWorkspaceId,
      userId: validUserId,
      topic: '신제품 소금빵 출시',
      context: baseContext,
      imageClient: client,
    })

    expect(result.imageIds.length).toBe(1)
    expect(calls.length).toBe(1)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(dbInsert).toHaveBeenCalledTimes(1)
    expect((admin as any).publish).toBeUndefined()
  })
})

describe('Instagram 규격용 이미지 형식', () => {
  it('빠른 이미지는 JPEG로 요청해 저장한다', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/features/quick-start/quick-image.ts', 'utf8')
    expect(source).toContain("outputFormat: 'jpeg'")
    expect(source).toContain("filename: 'quick-post.jpg'")
  })
})

describe('cleanupQuarantineQuickImage', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const assetId = 'asset-clean-123'
  const objectPath = 'workspaces/ws-1/media/source/asset-clean-123/original.png'

  it('DB 자산을 먼저 QUARANTINED로 차단한 후 storage와 DB 삭제를 진행하며 metadata를 덮어쓰지 않는다', async () => {
    const callOrder: string[] = []

    const mockUpdateEq2 = vi.fn().mockImplementation(async () => {
      callOrder.push('db_update')
      return { error: null }
    })
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 })
    const mockUpdate = vi.fn().mockImplementation((payload: any) => {
      // Must NOT overwrite generation_metadata (CHECK constraint & evidence preservation)
      expect(payload).not.toHaveProperty('generation_metadata')
      expect(payload).toEqual({
        publish_eligibility: false,
        lifecycle_status: 'QUARANTINED',
      })
      return { eq: mockUpdateEq1 }
    })

    const mockRemove = vi.fn().mockImplementation(async () => {
      callOrder.push('storage_remove')
      return { error: null }
    })

    const mockDeleteEq2 = vi.fn().mockImplementation(async () => {
      callOrder.push('db_delete')
      return { error: null }
    })
    const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 })

    const fakeAdmin = {
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockRemove }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'media_assets') {
          return {
            update: mockUpdate,
            delete: mockDelete,
          }
        }
        return {}
      }),
    }

    const result = await cleanupQuarantineQuickImage({
      admin: fakeAdmin,
      workspaceId,
      assetId,
      objectPath,
    })

    expect(callOrder[0]).toBe('db_update')
    expect(callOrder[1]).toBe('storage_remove')
    expect(callOrder[2]).toBe('db_delete')
    expect(mockUpdateEq1).toHaveBeenCalledWith('id', assetId)
    expect(mockUpdateEq2).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(mockRemove).toHaveBeenCalledWith([objectPath])
    expect(mockDeleteEq1).toHaveBeenCalledWith('id', assetId)
    expect(mockDeleteEq2).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(result.quarantined).toBe(true)
    expect(result.storageRemoved).toBe(true)
    expect(result.dbDeleted).toBe(true)
    expect(result.success).toBe(true)
  })

  it('DB와 storage 모두 실패 시 에러를 은폐하지 않고 console.error를 기록하며 success: false를 반환한다', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockUpdateEq2 = vi.fn().mockResolvedValue({ error: new Error('DB connection refused') })
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 })

    const mockRemove = vi.fn().mockResolvedValue({ error: new Error('Storage 503 unavailable') })

    const mockDeleteEq2 = vi.fn().mockResolvedValue({ error: new Error('DB transaction aborted') })
    const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 })

    const fakeAdmin = {
      storage: {
        from: vi.fn().mockReturnValue({ remove: mockRemove }),
      },
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
        delete: mockDelete,
      }),
    }

    const result = await cleanupQuarantineQuickImage({
      admin: fakeAdmin,
      workspaceId,
      assetId,
      objectPath,
    })

    expect(result.success).toBe(false)
    expect(result.quarantined).toBe(false)
    expect(result.storageRemoved).toBe(false)
    expect(result.dbDeleted).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    // CRITICAL: both DB and storage failed -> must log error and cannot claim safety
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('isReplay: true이거나 외부 SNS 원본인 경우 자산 보호를 위해 삭제/격리를 일절 수행하지 않는다', async () => {
    const mockUpdate = vi.fn()
    const mockRemove = vi.fn()
    const mockDelete = vi.fn()

    const fakeAdmin = {
      storage: { from: vi.fn().mockReturnValue({ remove: mockRemove }) },
      from: vi.fn().mockReturnValue({ update: mockUpdate, delete: mockDelete }),
    }

    // 1. Replay protection
    const replayResult = await cleanupQuarantineQuickImage({
      admin: fakeAdmin,
      workspaceId,
      assetId,
      objectPath,
      isReplay: true,
    })
    expect(replayResult.success).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()

    // 2. External original protection
    const externalResult = await cleanupQuarantineQuickImage({
      admin: fakeAdmin,
      workspaceId,
      assetId,
      objectPath,
      sourceType: 'INSTAGRAM_SYNC',
    })
    expect(externalResult.success).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
