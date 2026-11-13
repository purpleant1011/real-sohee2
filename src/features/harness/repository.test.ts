import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { listActiveHarnessRules, listApprovedKnowledgeFacts } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

function query(result: unknown) {
  const promise = Promise.resolve(result)
  type FakeQuery = {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    then: PromiseLike<unknown>['then']
  }
  const builder = {} as FakeQuery
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: promise.then.bind(promise),
  })
  return builder
}

describe('listActiveHarnessRules', () => {
  it('includes only active approved rules in model context', async () => {
    const activeQuery = query({
      data: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          workspace_id: workspaceId,
          rule_key: 'approval-before-publish',
          rule_type: 'approval_boundary',
          title: '게시 전 최종 확인',
          description: null,
          structured_rule: { action: 'request_confirmation' },
          applies_to_channels: ['instagram'],
          status: 'active',
          version: 2,
          approved_by_user_id: '10000000-0000-4000-8000-000000000001',
          approved_at: '2026-08-10T01:00:00.000Z',
        },
      ],
      error: null,
    })
    const client = { from: vi.fn(() => activeQuery) } as unknown as ServerSupabaseClient

    const rules = await listActiveHarnessRules({ client, workspaceId })

    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ status: 'active', title: '게시 전 최종 확인' })
    expect(activeQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(activeQuery.eq).toHaveBeenCalledWith('status', 'active')
  })
})

describe('listApprovedKnowledgeFacts', () => {
  it('reads active facts without querying unapproved candidates', async () => {
    const factsQuery = query({
      data: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          workspace_id: workspaceId,
          category: 'operation_policy',
          content: '게시 전에는 최종 확인이 필요하다.',
          status: 'active',
          source_candidate_id: '50000000-0000-4000-8000-000000000001',
          approved_at: '2026-08-10T01:00:00.000Z',
          valid_from: '2026-08-10T01:00:00.000Z',
          valid_until: null,
        },
      ],
      error: null,
    })
    const client = { from: vi.fn(() => factsQuery) } as unknown as ServerSupabaseClient

    const facts = await listApprovedKnowledgeFacts({ client, workspaceId })

    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ status: 'active', category: 'operation_policy' })
    expect(client.from).toHaveBeenCalledTimes(1)
    expect(client.from).toHaveBeenCalledWith('knowledge_facts')
    expect(factsQuery.eq).toHaveBeenCalledWith('status', 'active')
  })
})
