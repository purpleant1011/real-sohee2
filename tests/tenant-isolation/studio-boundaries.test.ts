import { describe, expect, it, vi } from 'vitest'
import { decideProposal, listKnowledgeDetails, listStudioMessages, updateGoal } from '../../src/features/sohee-studio/repository'

// Model the Data API predicates over real fixture rows. This is a query-contract
// test, not proof of RLS: the separate SQL suite supplies actual role execution.
function clientFor(tables: Record<string, Record<string, unknown>[]>) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  return {
    queries,
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      queries.push({ table, filters })
      const result = () => ({ data: (tables[table] ?? []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)), error: null })
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder },
        in: (key: string, value: unknown[]) => { filters.push([key, value]); return builder },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
        then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
      }
      return builder
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'proposal_not_found' } }),
  }
}

describe('ANI-1587 Studio query workspace contracts', () => {
  it('does not return foreign messages or proposals for a guessed thread ID', async () => {
    const client = clientFor({
      messages: [{ id: 'foreign-message', workspace_id: 'B', thread_id: 'foreign-thread' }],
      sohee_studio_proposals: [{ id: 'foreign-proposal', workspace_id: 'B', source_message_id: 'foreign-message' }],
    })
    expect(await listStudioMessages('A', 'foreign-thread', undefined, client)).toEqual({ messages: [], proposals: [] })
    expect(client.queries.every(query => query.filters.some(([key, value]) => key === 'workspace_id' && value === 'A'))).toBe(true)
  })
  it('does not return foreign facts or derived evidence excerpts', async () => {
    const client = clientFor({ knowledge_facts: [{ id: 'foreign-fact', workspace_id: 'B', content: 'private-fixture' }] })
    expect(await listKnowledgeDetails('A', client)).toEqual([])
  })
  it('cannot update a foreign goal by ID', async () => {
    const client = clientFor({ sohee_goals: [{ id: 'foreign-goal', workspace_id: 'B', version: 1 }] })
    await expect(updateGoal({ workspaceId: 'A', goalId: 'foreign-goal', userId: 'actor-A', expectedVersion: 1, title: 'attempt' }, client)).rejects.toThrow()
  })
  it('binds decision RPC to workspace, proposal and actor; not-found is not success', async () => {
    const client = clientFor({})
    await expect(decideProposal({ workspaceId: 'A', proposalId: 'foreign-proposal', userId: 'actor-A', decision: 'confirm' }, client)).rejects.toThrow('proposal_not_found')
    expect(client.rpc).toHaveBeenCalledWith('decide_studio_proposal', expect.objectContaining({ p_workspace_id: 'A', p_proposal_id: 'foreign-proposal', p_user_id: 'actor-A' }))
  })
})
