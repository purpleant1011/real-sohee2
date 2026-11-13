import 'server-only'
import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { isConversationWorkbenchEnabled } from './conversation-rollout'
import { isConversationAgentRuntimeEnabled } from './prepared-conversation-routing'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'

const uuid = z.string().uuid()
const memberSchema = z.object({ workspace_id: uuid, user_id: uuid,
  role: z.enum(['owner', 'manager', 'reviewer', 'viewer']), status: z.literal('active') })
const channelSchema = z.object({ workspace_id: uuid, channel: z.string().min(1), status: z.string().min(1) })

/** Read-only discovery; membership and channel metadata never imply external execution permission. */
export async function loadConversationOperationCatalog(input: {
  client: ServerSupabaseClient; workspaceId: string; userId: string
  modelConfigured: boolean; agentModelConfigured: boolean
  env?: Record<string, string | undefined>
}) {
  const workspaceId = uuid.parse(input.workspaceId)
  const userId = uuid.parse(input.userId)
  const env = input.env ?? process.env
  const membership = await input.client.from('workspace_members').select('workspace_id,user_id,role,status')
    .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle()
  if (membership.error) throw new Error('CONVERSATION_CATALOG_UNAVAILABLE')
  const member = memberSchema.safeParse(membership.data)
  if (!member.success || member.data.workspace_id !== workspaceId || member.data.user_id !== userId) {
    throw new Error('CONVERSATION_CATALOG_FORBIDDEN')
  }
  const connections = await input.client.from('channel_connections').select('workspace_id,channel,status')
    .eq('workspace_id', workspaceId).eq('status', 'connected').limit(100)
  const channels = z.array(channelSchema).safeParse(connections.data)
  if (connections.error || !channels.success) throw new Error('CONVERSATION_CATALOG_UNAVAILABLE')
  if (channels.data.some(row => row.workspace_id !== workspaceId)) throw new Error('CONVERSATION_CATALOG_SCOPE_MISMATCH')
  return buildConversationOperationCatalog({ workspaceId, role: member.data.role,
    workbenchEnabled: isConversationWorkbenchEnabled(workspaceId, env),
    agentEnabled: isConversationAgentRuntimeEnabled(workspaceId, env) && input.agentModelConfigured,
    modelConfigured: input.modelConfigured,
    connectedChannels: channels.data.filter(row => row.status === 'connected').map(row => row.channel),
    observedAt: new Date().toISOString(),
  })
}
