import { describe, expect, it } from 'vitest'
import { createSupabaseKnowledgeGateway } from './knowledge-context'

const workspaceId = '11111111-1111-4111-8111-111111111111'

describe('authoritative grounded knowledge gateway', () => {
  it('reads facts through the source lifecycle RPC instead of bare active rows', async () => {
    const client = {
      async rpc(name: string, input: Record<string, unknown>) {
        if (name !== 'get_approved_learning_context' || input.p_workspace_id !== workspaceId) throw new Error('wrong authorization boundary')
        return { data: [{ id: 'fact', category: 'PRICE', content: '서비스 5만원', source_type: 'manual', epoch: 7 }], error: null }
      },
      from() { throw new Error('bare facts bypassed source validation') },
    }
    const result = await createSupabaseKnowledgeGateway(client).facts!(workspaceId)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{ id: 'fact', category: 'PRICE', content: '서비스 5만원', source_type: 'manual', epoch: 7 }])
  })
  it('propagates authority failure rather than returning ordinary empty facts', async () => {
    const error = { code: 'RPC_UNAVAILABLE' }
    const client = { async rpc() { return { data: null, error } }, from() { throw new Error('fallback forbidden') } }
    const result = await createSupabaseKnowledgeGateway(client).facts!(workspaceId)
    expect(result.error).toEqual(error)
  })
})
