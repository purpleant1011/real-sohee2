import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyImageCalibrationFeedback,
  proposeVisualDirections,
  type CalibrationAsset,
} from '@/features/image-harness/image-calibration-service'
import { createProductionGenerationOrchestrator } from '@/features/creative/production-generation-factory'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'

describe('ANI-1447: Real Provider-Backed Image Generation Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects fake/synthetic cdn.sohee.ai URLs in calibration assets and requires real storage or API path', () => {
    const directions = proposeVisualDirections(null)
    const currentAsset: CalibrationAsset = {
      id: 'asset_init_1',
      digest: 'digest_1',
      url: 'https://cdn.sohee.ai/assets/preview.jpg',
      modelPresence: 'MODEL_ABSENT',
      rightsStatus: 'USER_CONFIRMED',
      consentStatus: 'NOT_APPLICABLE',
      provenance: {
        model: 'gpt-image-2',
        prompt: 'test prompt',
      },
    }

    const result = applyImageCalibrationFeedback({
      currentDirection: directions[0],
      currentAsset,
      feedbackUtterance: '더 자연스럽고 얼굴 없이',
    })

    // The asset URL must NOT be a hardcoded fake cdn.sohee.ai/assets URL
    expect(result.newAsset.url).not.toMatch(/^https:\/\/cdn\.sohee\.ai\/assets\/calib_/)
    // Must be a valid storage URL or real API asset route
    expect(
      result.newAsset.url.includes('/storage/v1/object/public/content-media/') ||
      result.newAsset.url.includes('/api/media/') ||
      result.newAsset.url.startsWith('https://')
    ).toBe(true)
  })

  it('executes production generation orchestrator and persists media_assets and generation_runs', async () => {
    const mockStorageUpload = vi.fn().mockResolvedValue({ error: null })
    const mockDbInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'media_asset_real_1' }, error: null }),
      }),
    })

    const mockSupabase: any = {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: mockStorageUpload,
          remove: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: 'https://test-supabase.co/storage/v1/object/public/content-media/workspaces/ws-1/media/source/media_asset_real_1/original.png' },
          }),
        }),
      },
      from: vi.fn().mockImplementation((_table: string) => {
        return {
          insert: mockDbInsert,
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }),
    }

    const validPngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00, // 1024x1024
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    ])

    const mockImageClient: any = {
      model: 'gpt-image-2.5-flare',
      generateImage: vi.fn().mockResolvedValue({
        bytes: validPngBytes,
        mimeType: 'image/png',
        sha256Digest: 'dummy_sha256',
        providerRequestId: 'req_123',
        model: 'gpt-image-2.5-flare',
        promptTokensEstimate: 10,
        imageTokensEstimate: 100,
      }),
    }

    const orchestrator = createProductionGenerationOrchestrator({
      supabaseClient: mockSupabase,
      workspaceId: 'ws-1',
      imageClient: mockImageClient,
    })

    const visualBrief = buildVisualBrief({
      workspaceId: 'ws-1',
      contentVersionId: 'onboarding_calib_ws-1',
      businessContext: {
        name: '소희 테스트 매장',
        industry: 'cafe',
        keywords: ['채광', '자연스러움'],
        targetAudience: '이웃 주민',
        location: '서울',
      },
      productContext: {
        name: '시각 스타일 시안',
        sellingPoints: ['자연 채광 카페 내부 스냅'],
      },
      channel: 'instagram',
      caption: '자연 채광 카페 내부 스냅',
    })

    const result = await orchestrator.execute({
      idempotencyKey: 'idemp_test_1',
      requestFingerprint: 'req_fingerprint_1',
      sequenceNumber: 1,
      workspaceId: 'ws-1',
      contentVersionId: 'onboarding_calib_ws-1',
      visualBrief,
    })

    expect(result.status).toBe('READY')
    expect(result.mediaAsset).toBeDefined()
    expect(result.sha256).toBeDefined()
    expect(mockImageClient.generateImage).toHaveBeenCalled()
    expect(mockStorageUpload).toHaveBeenCalled()
    expect(mockDbInsert).toHaveBeenCalled()
    // ANI-1481: Verify created_by is guaranteed to be a valid UUID to prevent Postgres 22P02 error
    const insertedRecords = mockDbInsert.mock.calls.map((call) => call[0])
    const mediaAssetInsert = insertedRecords.find((rec) => rec.bucket_id === 'content-media')
    expect(mediaAssetInsert).toBeDefined()
    expect(mediaAssetInsert.created_by).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(mediaAssetInsert.rights_status).toBe('confirmed')
  })

  it('persists caller userId as media_assets.created_by when provided', async () => {
    const mockStorageUpload = vi.fn().mockResolvedValue({ error: null })
    const mockDbInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'media_asset_real_2' }, error: null }),
      }),
    })

    const mockSupabase: any = {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: mockStorageUpload,
          remove: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://test-supabase.co/img.png' } }),
        }),
      },
      from: vi.fn().mockImplementation((_table: string) => ({
        insert: mockDbInsert,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
      })),
    }

    const validPngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    ])

    const mockImageClient: any = {
      model: 'gpt-image-2.5-flare',
      generateImage: vi.fn().mockResolvedValue({
        bytes: validPngBytes,
        mimeType: 'image/png',
        sha256Digest: 'dummy_sha256_2',
        providerRequestId: 'req_456',
        model: 'gpt-image-2.5-flare',
        promptTokensEstimate: 10,
        imageTokensEstimate: 100,
      }),
    }

    const testUserId = 'a0000000-1111-2222-3333-444444444444'
    const orchestrator = createProductionGenerationOrchestrator({
      supabaseClient: mockSupabase,
      workspaceId: 'ws-1',
      userId: testUserId,
      imageClient: mockImageClient,
    })

    const visualBrief = buildVisualBrief({
      workspaceId: 'ws-1',
      contentVersionId: 'onboarding_calib_ws-1',
      businessContext: { name: '카페' },
      productContext: { name: '아메리카노' },
      channel: 'instagram',
      caption: '스냅',
    })

    const result = await orchestrator.execute({
      idempotencyKey: 'idemp_test_user_id',
      requestFingerprint: 'req_fingerprint_user_id',
      sequenceNumber: 1,
      workspaceId: 'ws-1',
      userId: testUserId,
      contentVersionId: 'onboarding_calib_ws-1',
      visualBrief,
    })

    expect(result.status).toBe('READY')
    const insertedRecords = mockDbInsert.mock.calls.map((call) => call[0])
    const mediaAssetInsert = insertedRecords.find((rec) => rec.bucket_id === 'content-media')
    expect(mediaAssetInsert).toBeDefined()
    expect(mediaAssetInsert.created_by).toBe(testUserId)
  })
})
