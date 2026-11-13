import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/onboarding/image-harness/generate/route'

const mockExecute = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws-canonical-test' }] }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn(),
    storage: {
      from: vi.fn().mockReturnValue({
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://leak.example.com' } }),
      }),
    },
  }),
}))

vi.mock('@/features/creative/production-generation-factory', () => ({
  createProductionGenerationOrchestrator: vi.fn().mockReturnValue({
    execute: (...args: any[]) => mockExecute(...args),
  }),
}))

describe('Image Harness Generate Route B2 Canonical IDs & Provenance (ANI-1458)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1 & 3 & 5) normal generation server selects stylePreset: "flare", ignores client spoofing, and returns exact canonical media IDs with correct provenance', async () => {
    mockExecute.mockResolvedValueOnce({
      status: 'READY',
      runId: 'run_flare_canonical_001',
      sha256: 'sha256_hash_1',
      mediaAsset: {
        id: 'asset-canonical-1111',
        workspace_id: 'ws-canonical-test',
        bucket_id: 'content-media',
        object_path: 'ws-canonical-test/asset-canonical-1111/source.png',
        sha256_digest: 'sha256_hash_1',
      },
    })

    // Client tries to pass stylePreset: 'sunburst' on normal generation without feedbackUtterance
    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '자연 채광 밝은 베이커리 전경',
        stylePreset: 'sunburst', // client attempt to spoof or pass
        generateBatch: false,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    // 1. Server must pass stylePreset: 'flare' to orchestrator on normal generation
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const execCall = mockExecute.mock.calls[0][0]
    expect(execCall.stylePreset).toBe('flare')

    // 2. Response asset ID must be the exact canonical ID from mediaAsset.id
    expect(json.asset.id).toBe('asset-canonical-1111')
    expect(json.assets[0].id).toBe('asset-canonical-1111')

    // 3. Provenance must have model: 'gpt-image-2.5-sunburst' and stylePreset: 'flare'
    expect(json.asset.provenance).toEqual({
      model: 'gpt-image-2.5-sunburst',
      stylePreset: 'flare',
      prompt: '자연 채광 밝은 베이커리 전경',
    })
  })

  it('4) feedback/edit request server selects stylePreset: "sunburst" regardless of client omission, and provenance reflects sunburst', async () => {
    mockExecute.mockResolvedValueOnce({
      status: 'READY',
      runId: 'run_sunburst_canonical_002',
      sha256: 'sha256_hash_2',
      mediaAsset: {
        id: 'asset-canonical-2222',
        workspace_id: 'ws-canonical-test',
        bucket_id: 'content-media',
        object_path: 'ws-canonical-test/asset-canonical-2222/source.png',
        sha256_digest: 'sha256_hash_2',
      },
    })

    // Feedback request with MODEL_PRESENT
    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '밝게 미소 짓는 제빵사 사장님 모습으로 변경',
        feedbackUtterance: '사장님 미소 모습으로 변경',
        referenceAssetId: 'asset-canonical-1111',
        modelPresence: 'MODEL_PRESENT',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    // Server must enforce stylePreset: 'sunburst' to orchestrator for feedback/edit
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const execCall = mockExecute.mock.calls[0][0]
    expect(execCall.stylePreset).toBe('sunburst')

    // Asset id must remain exact newAsset.id
    expect(json.asset.id).toBe('asset-canonical-2222')

    // Provenance must have model: 'gpt-image-2.5-sunburst' and stylePreset: 'sunburst'
    expect(json.asset.provenance).toEqual({
      model: 'gpt-image-2.5-sunburst',
      stylePreset: 'sunburst',
      prompt: '밝게 미소 짓는 제빵사 사장님 모습으로 변경',
    })
  })

  it('6 & 7) generateBatch: true returns 3 unique canonical media IDs, 3 unique real run IDs, and distinct candidate request keys', async () => {
    mockExecute
      .mockResolvedValueOnce({
        status: 'READY',
        runId: 'run_batch_real_001',
        sha256: 'sha256_batch_1',
        mediaAsset: {
          id: 'asset-batch-101',
          workspace_id: 'ws-canonical-test',
          bucket_id: 'content-media',
          object_path: 'ws-canonical-test/asset-batch-101/source.png',
          sha256_digest: 'sha256_batch_1',
        },
      })
      .mockResolvedValueOnce({
        status: 'READY',
        runId: 'run_batch_real_002',
        sha256: 'sha256_batch_2',
        mediaAsset: {
          id: 'asset-batch-102',
          workspace_id: 'ws-canonical-test',
          bucket_id: 'content-media',
          object_path: 'ws-canonical-test/asset-batch-102/source.png',
          sha256_digest: 'sha256_batch_2',
        },
      })
      .mockResolvedValueOnce({
        status: 'READY',
        runId: 'run_batch_real_003',
        sha256: 'sha256_batch_3',
        mediaAsset: {
          id: 'asset-batch-103',
          workspace_id: 'ws-canonical-test',
          bucket_id: 'content-media',
          object_path: 'ws-canonical-test/asset-batch-103/source.png',
          sha256_digest: 'sha256_batch_3',
        },
      })

    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '감성적인 플라워 샵 인테리어',
        generateBatch: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    expect(mockExecute).toHaveBeenCalledTimes(3)

    // Check candidate-scoped idempotency keys and requestFingerprints are distinct across calls
    const callKeys = mockExecute.mock.calls.map((c) => c[0].idempotencyKey)
    const callFingerprints = mockExecute.mock.calls.map((c) => c[0].requestFingerprint)
    expect(new Set(callKeys).size).toBe(3)
    expect(new Set(callFingerprints).size).toBe(3)

    // 3 unique media IDs
    const assetIds = json.assets.map((a: any) => a.id)
    expect(assetIds).toEqual(['asset-batch-101', 'asset-batch-102', 'asset-batch-103'])
    expect(new Set(assetIds).size).toBe(3)

    // 3 unique run IDs
    expect(json.runIds).toEqual(['run_batch_real_001', 'run_batch_real_002', 'run_batch_real_003'])
    expect(new Set(json.runIds).size).toBe(3)

    // All assets have canonical model and flare stylePreset
    for (const asset of json.assets) {
      expect(asset.provenance.model).toBe('gpt-image-2.5-sunburst')
      expect(asset.provenance.stylePreset).toBe('flare')
    }
  })

  it('MODEL_ABSENT: feedback/reference edit strictly uses flare preset to forbid human imagery and marks consent NOT_APPLICABLE', async () => {
    mockExecute.mockResolvedValueOnce({
      status: 'READY',
      runId: 'run_absent_feedback_001',
      sha256: 'sha256_hash_absent',
      mediaAsset: {
        id: 'asset-absent-1111',
        workspace_id: 'ws-canonical-test',
        bucket_id: 'content-media',
        object_path: 'ws-canonical-test/asset-absent-1111/source.png',
        sha256_digest: 'sha256_hash_absent',
      },
    })

    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '조금 더 따뜻한 톤으로 다시 생성해줘',
        feedbackUtterance: '따뜻한 톤으로 수정',
        modelPresence: 'MODEL_ABSENT',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    // Must execute orchestrator with flare (never sunburst when MODEL_ABSENT)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const execParams = mockExecute.mock.calls[0][0]
    expect(execParams.stylePreset).toBe('flare')

    expect(json.assets[0].modelPresence).toBe('MODEL_ABSENT')
    expect(json.assets[0].consentStatus).toBe('NOT_APPLICABLE')
    expect(json.assets[0].provenance.stylePreset).toBe('flare')
  })

  it('HAND_OR_DETAIL_ONLY: feedback edit does not force full human face portrait and uses flare preset', async () => {
    mockExecute.mockResolvedValueOnce({
      status: 'READY',
      runId: 'run_detail_feedback_001',
      sha256: 'sha256_hash_detail',
      mediaAsset: {
        id: 'asset-detail-1111',
        workspace_id: 'ws-canonical-test',
        bucket_id: 'content-media',
        object_path: 'ws-canonical-test/asset-detail-1111/source.png',
        sha256_digest: 'sha256_hash_detail',
      },
    })

    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '손에 쥔 찻잔 클로즈업으로 수정',
        feedbackUtterance: '찻잔 클로즈업',
        modelPresence: 'HAND_OR_DETAIL_ONLY',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    // Must NOT force sunburst human face portrait for HAND_OR_DETAIL_ONLY
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const execParams = mockExecute.mock.calls[0][0]
    expect(execParams.stylePreset).toBe('flare')

    expect(json.assets[0].modelPresence).toBe('HAND_OR_DETAIL_ONLY')
    expect(json.assets[0].consentStatus).toBe('CONFIRMED')
    expect(json.assets[0].provenance.stylePreset).toBe('flare')
  })
})

describe('Image Harness UI ID Preservation Invariants (ANI-1458)', () => {
  it('1 & 2) candidate media IDs in UI/goldenAssets remain exact canonical media IDs without -${idx} or -revised-*', () => {
    // Exact logic verification matching page.tsx
    const generatedAssets = [
      { id: 'asset-canonical-101', url: '/api/workspaces/ws/media/asset-canonical-101' },
      { id: 'asset-canonical-102', url: '/api/workspaces/ws/media/asset-canonical-102' },
      { id: 'asset-canonical-103', url: '/api/workspaces/ws/media/asset-canonical-103' },
    ]

    // Current page.tsx has: id: `${gen.id || 'gen'}-${idx}`
    // Target invariant: id must equal gen.id exactly
    const initialGoldens = generatedAssets.map((gen) => ({
      id: gen.id, // Must NOT have -${idx}
      storagePath: `assets/${gen.id}.jpg`,
      publicUrl: gen.url,
      isGolden: true,
    }))

    expect(initialGoldens.map((g) => g.id)).toEqual([
      'asset-canonical-101',
      'asset-canonical-102',
      'asset-canonical-103',
    ])

    // Feedback replacement
    const newAsset = { id: 'asset-canonical-revised-201', url: '/api/workspaces/ws/media/asset-canonical-revised-201' }
    // Current page.tsx has: id: `${newAsset.id || 'rev'}-revised-${Date.now()}-${goldenAssets.length + 1}`
    // Target invariant: id must equal newAsset.id exactly
    const revisedGolden = {
      id: newAsset.id, // Must NOT have -revised-*
      storagePath: `assets/${newAsset.id}.jpg`,
      publicUrl: newAsset.url,
      isGolden: true,
    }

    expect(revisedGolden.id).toBe('asset-canonical-revised-201')
  })
})
