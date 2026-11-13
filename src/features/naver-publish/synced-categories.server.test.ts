import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getSyncedNaverCategories } from './synced-categories.server'

describe('getSyncedNaverCategories', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'

  function createFakeClient({
    connections = [{ id: 'conn-1' }],
    categoriesRows = [
      {
        categories: [
          { id: '1', name: '공지사항', parentId: null },
          { id: '2', name: '업데이트', parentId: '1' },
          { id: 'invalid', name: 123 }, // invalid row that should be dropped
        ],
        synced_at: '2026-10-09T10:00:00Z',
      },
    ],
  }: {
    connections?: Array<{ id: string }> | null
    categoriesRows?: Array<{ categories: any; synced_at: string }> | null
  } = {}) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'browser_channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: connections, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'naver_blog_categories') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: categoriesRows, error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as any
  }

  it('returns empty array when no connected naver_blog connections exist', async () => {
    const client = createFakeClient({ connections: [] })
    const result = await getSyncedNaverCategories(workspaceId, client)
    expect(result).toEqual([])
  })

  it('returns empty array when no categories are synced', async () => {
    const client = createFakeClient({ categoriesRows: [] })
    const result = await getSyncedNaverCategories(workspaceId, client)
    expect(result).toEqual([])
  })

  it('returns validated categories and drops invalid rows', async () => {
    const client = createFakeClient()
    const result = await getSyncedNaverCategories(workspaceId, client)
    expect(result).toEqual([
      { id: '1', name: '공지사항', parentId: null },
      { id: '2', name: '업데이트', parentId: '1' },
    ])
  })

  it('prefers the most recently synced record when multiple exist', async () => {
    const client = createFakeClient({
      connections: [{ id: 'conn-1' }, { id: 'conn-2' }],
      categoriesRows: [
        {
          categories: [{ id: '10', name: '최신 카테고리', parentId: null }],
          synced_at: '2026-10-09T12:00:00Z',
        },
      ],
    })
    const result = await getSyncedNaverCategories(workspaceId, client)
    expect(result).toEqual([{ id: '10', name: '최신 카테고리', parentId: null }])
  })
})
