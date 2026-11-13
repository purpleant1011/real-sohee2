import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  itemSingle: vi.fn(),
  insert: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: mocks.membershipMaybeSingle,
        }
        return query
      }

      const mutation = {
        select: vi.fn(() => mutation),
        single: mocks.itemSingle,
      }
      return { insert: mocks.insert.mockReturnValue(mutation) }
    }),
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createContentItemAction } from './create-item'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  title: '가을 캠페인',
  channel: 'instagram',
}

describe('createContentItemAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '10000000-0000-4000-8000-000000000001' } },
      error: null,
    })
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'owner', status: 'active' },
      error: null,
    })
    mocks.itemSingle.mockResolvedValue({
      data: { id: '30000000-0000-4000-8000-000000000001' },
      error: null,
    })
  })

  it('inserts only safe initial columns and returns the new detail path', async () => {
    await expect(createContentItemAction(input)).resolves.toEqual({
      data: {
        contentId: '30000000-0000-4000-8000-000000000001',
        next: '/app/work/30000000-0000-4000-8000-000000000001/edit',
      },
    })

    expect(mocks.insert).toHaveBeenCalledWith({
      workspace_id: input.workspaceId,
      title: input.title,
      channel: input.channel,
      created_by: '10000000-0000-4000-8000-000000000001',
    })
  })

  it('rejects a viewer before attempting an insert', async () => {
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { role: 'viewer', status: 'active' },
      error: null,
    })

    await expect(createContentItemAction(input)).resolves.toMatchObject({
      error: { requestId: 'content-item' },
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
