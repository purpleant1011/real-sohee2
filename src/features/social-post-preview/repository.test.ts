import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { getSocialPostPreviews, type SocialPostPreviewGateway } from './repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const versionId = '20000000-0000-4000-8000-000000000001'

function gateway(): SocialPostPreviewGateway {
  return {
    listVersions: vi.fn().mockResolvedValue({ data: [{
      id: versionId, workspace_id: workspaceId, caption: '최종 게시 문구', hashtags: ['#소희'],
      content_items: { channel: 'instagram' },
    }], error: null }),
    listMedia: vi.fn().mockResolvedValue({ data: [
      { version_id: versionId, media_asset_id: '30000000-0000-4000-8000-000000000002', position: 2 },
      { version_id: versionId, media_asset_id: '30000000-0000-4000-8000-000000000001', position: 1 },
    ], error: null }),
    listAccounts: vi.fn().mockResolvedValue({ data: [{ channel: 'instagram', account_label: '@sohee' }], error: null }),
  }
}

describe('getSocialPostPreviews', () => {
  it('projects the exact version and ordered authenticated media URLs', async () => {
    const result = await getSocialPostPreviews(workspaceId, [versionId], gateway())

    expect(result[versionId]).toMatchObject({ channel: 'instagram', accountLabel: '@sohee', caption: '최종 게시 문구' })
    expect(result[versionId].media.map((item) => item.position)).toEqual([1, 2])
    expect(result[versionId].media[0].src).toBe(`/api/workspaces/${workspaceId}/media/30000000-0000-4000-8000-000000000001`)
  })

  it('fails closed when the projection is malformed', async () => {
    const source = gateway()
    vi.mocked(source.listVersions).mockResolvedValue({ data: [{ id: versionId }], error: null })
    await expect(getSocialPostPreviews(workspaceId, [versionId], source)).resolves.toEqual({})
  })
})
