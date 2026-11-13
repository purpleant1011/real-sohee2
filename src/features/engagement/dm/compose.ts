import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseKnowledgeGateway, loadGroundedBusinessContext } from '@/features/channel-studio/knowledge-context'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import { SupabaseInstagramDmRepository } from './repository'
import { generateDmDirectionOptions } from './options-generator'
import { sendInstagramDm, type SendDmActor, type SendInstagramDmOptions } from './send-dm'
import type { InstagramDmThread } from './types'

export function createInstagramDmService(adminClient: SupabaseClient | any) {
  const repo = new SupabaseInstagramDmRepository(adminClient)
  const gateway = createSupabaseKnowledgeGateway(adminClient)

  const loadContext = (workspaceId: string) =>
    loadGroundedBusinessContext(workspaceId, gateway)

  const getChannelCredential = async (
    workspaceId: string,
    channelConnectionId: string,
    channel: 'instagram'
  ) => {
    return loadChannelCredential(workspaceId, channelConnectionId, channel, undefined, undefined, 'message')
  }

  return {
    repo,
    loadContext,
    getChannelCredential,
    generateDraftOptions: async (workspaceId: string, thread: InstagramDmThread) => {
      const context = await loadContext(workspaceId).catch(() => null)
      return generateDmDirectionOptions({
        customerMessage: thread.last_message_text,
        customerHandle: thread.customer_handle,
        context,
      })
    },
    send: (thread: InstagramDmThread, actor: SendDmActor, options?: SendInstagramDmOptions) => {
      return sendInstagramDm(
        thread,
        actor,
        {
          repo,
          getChannelCredential,
          adminClient,
        },
        options
      )
    },
  }
}
