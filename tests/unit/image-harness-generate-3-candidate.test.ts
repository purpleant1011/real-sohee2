import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/onboarding/image-harness/generate/route'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws-1111-2222' }] }),
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
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://public.forbidden.com/leak' } }),
      }),
    },
  }),
}))

vi.mock('@/features/creative/production-generation-factory', () => ({
  createProductionGenerationOrchestrator: vi.fn().mockReturnValue({
    execute: vi.fn().mockImplementation(async (params) => ({
      status: 'READY',
      runId: `run_${params.sequenceNumber}`,
      sha256: `sha256_mock_${params.sequenceNumber}`,
      mediaAsset: {
        id: `asset-uuid-${params.sequenceNumber}`,
        workspace_id: params.workspaceId,
        bucket_id: 'content-media',
        object_path: `${params.workspaceId}/asset-uuid-${params.sequenceNumber}/source.png`,
        sha256_digest: `sha256_mock_${params.sequenceNumber}`,
      },
    })),
  }),
}))

describe('Image Harness Generate Route 3-Candidate & Private Delivery (ANI-1458)', () => {
  it('generates 3 candidate assets and returns authenticated workspace media URLs without getPublicUrl', async () => {
    const req = new Request('http://localhost:3000/api/onboarding/image-harness/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '따뜻한 감성의 헤어살롱 인테리어',
        stylePreset: 'flare',
        directionKey: 'NATURAL_LIGHT',
        generateBatch: true, // Requests 3 candidates
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.assets).toHaveLength(3)

    // Private Delivery Verification: URLs must be authenticated workspace media paths, NEVER public bucket URLs
    for (let i = 0; i < json.assets.length; i++) {
      const asset = json.assets[i]
      expect(asset.url).toBe(`/api/workspaces/ws-1111-2222/media/asset-uuid-${i + 1}`)
      expect(asset.url).not.toContain('public.forbidden.com')
      expect(asset.provenance.model).toBe('gpt-image-2.5-sunburst')
      expect(asset.provenance.stylePreset).toBe('flare')
    }
  })
})
