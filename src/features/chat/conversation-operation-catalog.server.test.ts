import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadConversationOperationCatalog } from './conversation-operation-catalog.server'
vi.mock('server-only', () => ({}))
const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '90000000-0000-4000-8000-000000000001'
function database(member: unknown, channels: unknown = [], channelError: unknown = null) {
  const from = vi.fn((table: string) => {
    const result = table === 'workspace_members' ? { data: member, error: null } : { data: channels, error: channelError }
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'limit']) chain[method] = () => chain
    chain.maybeSingle = async () => result
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return chain
  })
  return { client: { from } as unknown as ServerSupabaseClient, from }
}
const member = { workspace_id: workspaceId, user_id: userId, role: 'manager', status: 'active' }
const flags = { CONVERSATION_WORKBENCH_ENABLED: '1', CONVERSATION_WORKBENCH_WORKSPACE_ALLOWLIST: workspaceId,
  CONVERSATION_AGENT_RUNTIME_ENABLED: '1', CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST: workspaceId }

describe('server operation catalog scope and readiness', () => {
  it('derives the real role from membership without creating a thread or job', async () => {
    const db = database(member, [{ workspace_id: workspaceId, channel: 'instagram', status: 'connected' }])
    const result = await loadConversationOperationCatalog({ ...db, workspaceId, userId, modelConfigured: true, agentModelConfigured: true, env: flags })
    expect(result.role).toBe('manager')
    expect(result.items.find(item => item.id === 'publish')?.state).toBe('CONNECT_OR_APPROVE')
    expect(db.from.mock.calls.map(call => call[0])).toEqual(['workspace_members', 'channel_connections'])
  })

  it('does not offer agent work outside the actual workspace rollout', async () => {
    const db = database(member)
    const result = await loadConversationOperationCatalog({ ...db, workspaceId, userId, modelConfigured: true, agentModelConfigured: true,
      env: { ...flags, CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST: '21000000-0000-4000-8000-000000000001' } })
    expect(result.items.find(item => item.id === 'marketing-plan')?.canAsk).toBe(false)
  })

  it('does not promote missing/invalid membership to owner or read channel metadata', async () => {
    for (const row of [null, { ...member, role: null }, { ...member, status: 'disabled' }]) {
      const db = database(row)
      await expect(loadConversationOperationCatalog({ ...db, workspaceId, userId, modelConfigured: true, agentModelConfigured: true, env: flags }))
        .rejects.toThrow('CONVERSATION_CATALOG_FORBIDDEN')
      expect(db.from).not.toHaveBeenCalledWith('channel_connections')
    }
  })

  it('does not turn a failed connection query into a confirmed empty connection list', async () => {
    const db = database(member, null, { code: 'NETWORK_ERROR' })
    await expect(loadConversationOperationCatalog({ ...db, workspaceId, userId, modelConfigured: true, agentModelConfigured: true, env: flags }))
      .rejects.toThrow('CONVERSATION_CATALOG_UNAVAILABLE')
  })

  it('rejects foreign scope rows returned by a privileged data port', async () => {
    const db = database(member, [{ workspace_id: '21000000-0000-4000-8000-000000000001', channel: 'instagram', status: 'connected' }])
    await expect(loadConversationOperationCatalog({ ...db, workspaceId, userId, modelConfigured: true, agentModelConfigured: true, env: flags }))
      .rejects.toThrow('CONVERSATION_CATALOG_SCOPE_MISMATCH')
  })
})
