import { describe, expect, it } from 'vitest'
import { buildConversationOperationCatalog, parseConversationOperationCatalog } from './conversation-operation-catalog'

const base = { workspaceId: '20000000-0000-4000-8000-000000000001', role: 'owner' as const,
  workbenchEnabled: true, agentEnabled: true, modelConfigured: true, connectedChannels: ['instagram'],
  observedAt: '2026-10-29T12:00:00Z' }

describe('conversation operation catalog', () => {
  it('validates private catalog scope and never accepts arbitrary action URLs', () => {
    const catalog = buildConversationOperationCatalog(base)
    expect(parseConversationOperationCatalog(catalog, base.workspaceId).items).toHaveLength(catalog.items.length)
    expect(() => parseConversationOperationCatalog(catalog, '21000000-0000-4000-8000-000000000001')).toThrow('CONVERSATION_CATALOG_SCOPE_MISMATCH')
    expect(() => parseConversationOperationCatalog({ ...catalog, role: null }, base.workspaceId)).toThrow()
    expect(() => parseConversationOperationCatalog({ ...catalog, items: [{ ...catalog.items[0], directHref: 'https://untrusted.test' }] }, base.workspaceId)).toThrow('CONVERSATION_CATALOG_INVALID')
  })

  it('makes the existing content, customer, booking, knowledge and operations discoverable', () => {
    const result = buildConversationOperationCatalog(base)
    expect(result.items.map(item => item.id)).toEqual(expect.arrayContaining([
      'marketing-plan', 'social-content', 'naver-blog', 'publish', 'comments', 'instagram-dm',
      'reservations', 'knowledge', 'performance', 'ads', 'video', 'channels',
    ]))
    expect(new Set(result.items.map(item => item.id)).size).toBe(result.items.length)
    expect(result.items.every(item => item.directHref.startsWith('/app/'))).toBe(true)
  })

  it('does not interpret an Instagram connection as permission to send DMs or publish', () => {
    const items = buildConversationOperationCatalog(base).items
    expect(items.find(item => item.id === 'publish')).toMatchObject({ state: 'CONNECT_OR_APPROVE', requiresDecision: true })
    expect(items.find(item => item.id === 'instagram-dm')).toMatchObject({ requiresDecision: true })
    expect(items.find(item => item.id === 'instagram-dm')?.description).toContain('발송')
  })

  it('keeps all viewer actions read-only without hiding the existing direct UI', () => {
    const result = buildConversationOperationCatalog({ ...base, role: 'viewer' })
    expect(result.items.every(item => item.canAsk === false)).toBe(true)
    expect(result.items.every(item => item.directHref.length > 0)).toBe(true)
  })

  it('does not gate internal content preparation on having a connected publishing channel', () => {
    const items = buildConversationOperationCatalog({ ...base, connectedChannels: [] }).items
    expect(items.find(item => item.id === 'social-content')).toMatchObject({ canAsk: true, state: 'PREPARE_ONLY' })
    expect(items.find(item => item.id === 'publish')).toMatchObject({ state: 'CONNECT_OR_APPROVE' })
  })

  it('never labels a missing model or unsupported provider as an executable workflow', () => {
    const result = buildConversationOperationCatalog({ ...base, modelConfigured: false })
    expect(result.items.every(item => !item.canAsk)).toBe(true)
    expect(result.items.find(item => item.id === 'video')?.state).toBe('OPEN_EXISTING_UI')
    expect(result.items.find(item => item.id === 'ads')?.state).toBe('OPEN_EXISTING_UI')
  })

  it('preserves existing specialized generation when the generic runtime is off', () => {
    const items = buildConversationOperationCatalog({ ...base, agentEnabled: false }).items
    expect(items.find(item => item.id === 'social-content')?.canAsk).toBe(true)
    expect(items.find(item => item.id === 'knowledge')?.canAsk).toBe(false)
  })
})
