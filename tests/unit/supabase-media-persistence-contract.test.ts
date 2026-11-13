import { describe, it, expect, vi } from 'vitest'
import { SupabasePersistenceAdapter } from '@/features/creative/production-generation-factory'
import type { MediaAsset } from '@/features/media/media-asset-types'

describe('SupabasePersistenceAdapter MediaAsset Contract Invariants (ANI-1458)', () => {
  it('does NOT insert non-existent source_type column into media_assets table', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: insertSpy,
      }),
    }

    const adapter = new SupabasePersistenceAdapter({
      supabaseClient: mockSupabase as any,
      workspaceId: 'ws-test-uuid',
    })

    const sampleAsset: MediaAsset = {
      id: 'asset-1111-2222-3333-4444',
      workspace_id: 'ws-test-uuid',
      bucket_id: 'content-media',
      object_path: 'ws-test-uuid/asset-1111-2222-3333-4444/source.png',
      kind: 'content',
      source_type: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: 102400,
      width: 1024,
      height: 1024,
      sha256_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      rights_status: 'approved',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: { model: 'gpt-image-2.5-flare' },
      created_by: 'system',
      created_at: new Date().toISOString(),
    }

    const result = await adapter.saveMediaAsset(sampleAsset)
    expect(result.error).toBeNull()
    expect(insertSpy).toHaveBeenCalledTimes(1)

    const insertedPayload = insertSpy.mock.calls[0][0]
    // Crucial check: provenance_kind MUST be present, source_type MUST NOT be present
    expect(insertedPayload.provenance_kind).toBe('GENERATED_OPENAI')
    expect(insertedPayload).not.toHaveProperty('source_type')
    expect(insertedPayload.kind).toBe('content')
    expect(insertedPayload.rights_status).toBe('confirmed')
  })

  it('maps database provenance_kind to MediaAsset source_type upon readback', async () => {
    const rawRow = {
      id: 'asset-readback-1234',
      workspace_id: 'ws-test-uuid',
      bucket_id: 'content-media',
      object_path: 'ws-test-uuid/asset-readback-1234/source.png',
      kind: 'content',
      provenance_kind: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: 51200,
      width: 1024,
      height: 1024,
      sha256_digest: 'abc123sha256',
      rights_status: 'approved',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: { model: 'gpt-image-2.5-sunburst' },
      created_by: 'system',
      created_at: new Date().toISOString(),
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: rawRow, error: null }),
            }),
          }),
        }),
      }),
    }

    const adapter = new SupabasePersistenceAdapter({
      supabaseClient: mockSupabase as any,
      workspaceId: 'ws-test-uuid',
    })

    const asset = await adapter.getMediaAsset('asset-readback-1234')
    expect(asset).not.toBeNull()
    expect(asset?.id).toBe('asset-readback-1234')
    expect(asset?.source_type).toBe('GENERATED_OPENAI')
  })
})
