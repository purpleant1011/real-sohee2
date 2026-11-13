import { describe, expect, it } from 'vitest'
import { isConversationWorkbenchEnabled } from './conversation-rollout'
describe('conversation workbench release gate', () => {
  it('defaults off and never permits wildcard rollout', () => {
    expect(isConversationWorkbenchEnabled('a', {})).toBe(false)
    expect(isConversationWorkbenchEnabled('a', { CONVERSATION_WORKBENCH_ENABLED: '1', CONVERSATION_WORKBENCH_WORKSPACE_ALLOWLIST: '*' })).toBe(false)
  })
  it('requires an exact server-approved workspace match unless rollout is all', () => {
    const env = { CONVERSATION_WORKBENCH_ENABLED: '1', CONVERSATION_WORKBENCH_WORKSPACE_ALLOWLIST: 'a,b' }
    expect(isConversationWorkbenchEnabled('a', env)).toBe(true)
    expect(isConversationWorkbenchEnabled('c', env)).toBe(false)
    expect(isConversationWorkbenchEnabled('', env)).toBe(false)
    expect(isConversationWorkbenchEnabled('c', { ...env, CONVERSATION_WORKBENCH_ROLLOUT: 'all' })).toBe(true)
    expect(isConversationWorkbenchEnabled('', { ...env, CONVERSATION_WORKBENCH_ROLLOUT: 'all' })).toBe(false)
  })
})
