import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  getSyncedNaverCategories: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}))

vi.mock('./synced-categories.server', () => ({
  getSyncedNaverCategories: mocks.getSyncedNaverCategories,
}))

import { getSyncedNaverCategoriesAction } from './get-synced-categories.action'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

describe('getSyncedNaverCategoriesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
    mocks.getSyncedNaverCategories.mockResolvedValue([])
  })

  function mockMembership(result: { role: string; status: string } | null, error: unknown = null) {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: result, error }),
          }),
        }),
      }),
    })
  }

  it('rejects invalid workspace id', async () => {
    const result = await getSyncedNaverCategoriesAction({ workspaceId: 'invalid' })
    expect(result.error?.message).toBe('매장 정보를 확인해 주세요.')
  })

  it('rejects unauthenticated requests', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') })
    const result = await getSyncedNaverCategoriesAction({ workspaceId: WORKSPACE })
    expect(result.error?.message).toBe('로그인이 필요해요.')
  })

  it('rejects non-members', async () => {
    mockMembership(null)
    const result = await getSyncedNaverCategoriesAction({ workspaceId: WORKSPACE })
    expect(result.error?.message).toBe('이 매장에 접근할 수 없어요.')
  })

  it('rejects inactive members', async () => {
    mockMembership({ role: 'reviewer', status: 'disabled' })
    const result = await getSyncedNaverCategoriesAction({ workspaceId: WORKSPACE })
    expect(result.error?.message).toBe('이 매장에 접근할 수 없어요.')
  })

  it('loads synced categories for active member', async () => {
    mockMembership({ role: 'manager', status: 'active' })
    mocks.getSyncedNaverCategories.mockResolvedValue([
      { id: '1', name: '공지사항', parentId: null },
    ])

    const result = await getSyncedNaverCategoriesAction({ workspaceId: WORKSPACE })
    expect(result.data).toEqual([
      { id: '1', name: '공지사항', parentId: null },
    ])
    expect(mocks.getSyncedNaverCategories).toHaveBeenCalledWith(WORKSPACE)
  })
})
