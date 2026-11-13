import { describe, expect, it, vi } from 'vitest'
import { customerDispatcher } from './customer-dispatcher'
import type { ToolExecutionContext } from '../types'

const scope = { workspaceId: 'workspace', correlationId: 'turn', intentMode: 'DRAFT' as const }
describe('server-injected conversation draft preparation', () => {
  it.each(['comment.reply_draft', 'dm.reply_draft'])('fails closed without a server-owned draft port: %s', async toolName => {
    const result = await customerDispatcher.execute({ _toolName: toolName, targetId: 'target', draftText: '안내 문안', sourceRef: 'source' }, scope)
    expect(result).toMatchObject({ success: false, status: 'BLOCKED', error: { code: 'DRAFT_PREPARER_UNAVAILABLE' } })
  })
  it.each([['comment.reply_draft', 'comment'], ['dm.reply_draft', 'dm']])('delegates only draft data and the canonical kind: %s', async (toolName, targetKind) => {
    const prepared = { success: true, toolId: toolName, status: 'COMPLETED' as const, data: { requiresUserApproval: true } }
    const prepareInteractionDraft = vi.fn().mockResolvedValue(prepared)
    const context = { ...scope, prepareInteractionDraft } as ToolExecutionContext
    const result = await customerDispatcher.execute({ _toolName: toolName, targetKind: 'spoofed', workspaceId: 'foreign',
      actorId: 'owner', targetId: 'target', draftText: '안내 문안', sourceRef: 'source' }, context)
    expect(prepareInteractionDraft).toHaveBeenCalledExactlyOnceWith({ targetKind, targetId: 'target', draftText: '안내 문안', sourceRef: 'source' })
    expect(result).toEqual(prepared)
    expect(result.proposal).toBeUndefined()
  })
})
