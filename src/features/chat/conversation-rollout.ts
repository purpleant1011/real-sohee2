import { conversationReadRuntimeEnabled } from './conversation-runtime-router'

export function isConversationWorkbenchEnabled(workspaceId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!workspaceId || env.CONVERSATION_WORKBENCH_ENABLED !== '1') return false
  if (env.CONVERSATION_WORKBENCH_ROLLOUT === 'all') return true
  const allowed = (env.CONVERSATION_WORKBENCH_WORKSPACE_ALLOWLIST ?? '').split(',').map(id => id.trim()).filter(Boolean)
  return !allowed.includes('*') && allowed.includes(workspaceId)
}
