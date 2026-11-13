import { describe, expect, it } from 'vitest'
import { listUrlSources } from './url-source-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'

describe('listUrlSources', () => {
  it('returns only workspace-bound URL sources with their exact collection states', async () => {
    const result = await listUrlSources(workspaceId, {
      list: async () => ({
        data: [
          {
            id: '20000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            channel_type: 'naver_blog',
            uri: 'https://blog.naver.com/sohee',
            refresh_policy: {
              ownership: 'reference',
              allowedUse: 'pattern_only',
              requestedScope: 'posts',
              collectionState: 'partial',
            },
            last_checked_at: '2026-08-19T01:00:00.000Z',
            error_code: null,
          },
        ],
        error: null,
      }),
    })

    expect(result.data).toEqual([
      expect.objectContaining({
        channel: 'naver_blog',
        collectionState: 'partial',
        allowedUse: 'pattern_only',
      }),
    ])
  })
})
