import { describe, expect, it, vi } from 'vitest'
import { listKnowledgeItems, type KnowledgeGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('listKnowledgeItems', () => {
  it('returns workspace-scoped private items with short-lived signed links', async () => {
    const gateway: KnowledgeGateway = {
      listItems: vi.fn(async () => ({
        data: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            name: '운영 기준.pdf',
            status: 'review_required',
            evidence: { fileValidated: true },
            created_at: '2026-08-09T03:00:00.000Z',
            updated_at: '2026-08-09T04:00:00.000Z',
            media_assets: {
              bucket_id: 'knowledge-files',
              object_path: `${workspaceId}/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/asset.pdf`,
              mime_type: 'application/pdf',
              size_bytes: 1200,
            },
          },
        ],
        error: null,
      })),
      createSignedUrl: vi.fn(async () => ({
        data: { signedUrl: 'https://example.invalid/private-signed-link' },
        error: null,
      })),
    }

    const result = await listKnowledgeItems(workspaceId, gateway)

    expect(result.data).toEqual([
      expect.objectContaining({
        name: '운영 기준.pdf',
        status: 'review_required',
        fileUrl: 'https://example.invalid/private-signed-link',
        canUseAsEvidence: false,
      }),
    ])
  })

  it('fails closed before signing a row from another workspace', async () => {
    const gateway: KnowledgeGateway = {
      listItems: vi.fn(async () => ({
        data: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            workspace_id: '20000000-0000-4000-8000-000000000099',
            name: '숨겨야 하는 자료.pdf',
            status: 'approved',
            evidence: { fileValidated: true, reviewed: true },
            created_at: '2026-08-09T03:00:00.000Z',
            updated_at: '2026-08-09T04:00:00.000Z',
            media_assets: {
              bucket_id: 'knowledge-files',
              object_path: '20000000-0000-4000-8000-000000000099/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/asset.pdf',
              mime_type: 'application/pdf',
              size_bytes: 1200,
            },
          },
        ],
        error: null,
      })),
      createSignedUrl: vi.fn(),
    }

    const result = await listKnowledgeItems(workspaceId, gateway)

    expect(result.error?.requestId).toBe('knowledge-list')
    expect(gateway.createSignedUrl).not.toHaveBeenCalled()
  })
})
