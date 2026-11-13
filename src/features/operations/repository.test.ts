import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from './types'
import { listWorkItems } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

function query(result: unknown) {
  const promise = Promise.resolve(result)
  type FakeQuery = {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: PromiseLike<unknown>['then']
  }
  const builder = {} as FakeQuery
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: promise.then.bind(promise),
  })
  return builder
}

describe('listWorkItems', () => {
  it('uses identical workspace and status conditions for list and count', async () => {
    const listQuery = query({
      data: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          workspace_id: workspaceId,
          type: 'content',
          title: '이번 주 콘텐츠',
          summary: null,
          status: 'drafting',
          priority: 'normal',
          owner_type: 'shared',
          owner_user_id: null,
          due_at: null,
          source_thread_id: null,
          source_message_id: null,
          content_item_id: null,
          created_at: '2026-08-10T01:00:00.000Z',
          updated_at: '2026-08-10T01:00:00.000Z',
        },
      ],
      error: null,
    })
    const countQuery = query({ data: null, error: null, count: 1 })
    const client = {
      from: vi.fn().mockReturnValueOnce(listQuery).mockReturnValueOnce(countQuery),
    } as unknown as ServerSupabaseClient

    const result = await listWorkItems({
      client,
      workspaceId,
      statuses: ['idea', 'drafting'],
      limit: 25,
    })

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
    for (const source of [listQuery, countQuery]) {
      expect(source.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
      expect(source.in).toHaveBeenCalledWith('status', ['idea', 'drafting'])
    }
  })
})
