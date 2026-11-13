import { describe, expect, it, vi } from 'vitest'
import { collectKnowledgeSource } from './url-collection-runner'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const sourceId = '20000000-0000-4000-8000-000000000001'

describe('collectKnowledgeSource', () => {
  it('does not invoke a collector through an authenticated barrier', async () => {
    const collect = vi.fn()
    const result = await collectKnowledgeSource(
      { workspaceId, sourceId },
      {
        load: async () => ({
          id: sourceId,
          workspaceId,
          channel: 'naver_place',
          ownership: 'owned',
          url: 'https://map.naver.com/p/entry/place/123',
          collectionState: 'connection_required',
        }),
        save: async (source) => source,
        saveCandidates: async () => undefined,
      },
      { naver_place: { collect } },
    )

    expect(result.data?.collectionState).toBe('connection_required')
    expect(collect).not.toHaveBeenCalled()
  })

  it('persists an explicit partial result without turning it into complete', async () => {
    const save = vi.fn(async (source) => source)
    const result = await collectKnowledgeSource(
      { workspaceId, sourceId },
      {
        load: async () => ({
          id: sourceId,
          workspaceId,
          channel: 'naver_blog',
          ownership: 'owned',
          url: 'https://blog.naver.com/sohee',
          collectionState: 'refresh_required',
        }),
        save,
        saveCandidates: async () => undefined,
      },
      {
        naver_blog: {
          collect: async () => ({
            collectionState: 'partial',
            observations: [{ category: 'business_fact', content: '공개 소개 문구를 확인했어요.' }],
          }),
        },
      },
    )

    expect(result.data?.collectionState).toBe('partial')
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ collectionState: 'partial' }))
  })
})
