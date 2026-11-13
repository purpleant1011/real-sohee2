import type { SupabaseClient } from '@supabase/supabase-js'
import { createGeminiTextGenerator } from '@/features/vault/transform/adapters/gemini'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import { createSupabaseKnowledgeGateway, loadGroundedBusinessContext } from '@/features/channel-studio/knowledge-context'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import { SupabaseEngagementRepository } from './repository'
import { runEngagementCycle } from './cycle'
import { sendCommentReply } from './send'
import { generateCommentReplyDraft } from './draft'
import { classifyComment } from './classify'

export function createEngagementService(
  adminClient: SupabaseClient | any,
  providedGenerator?: TextGenerator
) {
  const repo = new SupabaseEngagementRepository(adminClient)
  const generator = providedGenerator ?? createGeminiTextGenerator()
  const gateway = createSupabaseKnowledgeGateway(adminClient)

  const loadContext = (workspaceId: string) =>
    loadGroundedBusinessContext(workspaceId, gateway)

  const getChannelCredential = async (
    workspaceId: string,
    channelConnectionId: string,
    channel: 'instagram' | 'threads'
  ) => {
    return loadChannelCredential(workspaceId, channelConnectionId, channel, undefined, undefined,
      channel === 'instagram' ? 'comment_reply' : 'reply')
  }

  return {
    repo,
    generator,
    loadContext,
    classify: (commentText: string) => classifyComment(commentText, generator),
    draft: async (params: {
      workspaceId: string
      commentId: string
      commentText: string
      channel: 'instagram' | 'threads'
      authorHandle: string
    }) => {
      const context = await loadContext(params.workspaceId)
      return generateCommentReplyDraft({
        ...params,
        context,
        generator,
      })
    },
    send: (
      comment: Parameters<typeof sendCommentReply>[0],
      actor: Parameters<typeof sendCommentReply>[1],
      options?: Parameters<typeof sendCommentReply>[3]
    ) => {
      return sendCommentReply(comment, actor, {
        repo,
        getChannelCredential,
        adminClient,
      }, options)
    },
    runCycle: (workspaceId: string, options?: { maxClassify?: number; maxSends?: number }) => {
      return runEngagementCycle(workspaceId, {
        repo,
        textGenerator: generator,
        loadContext,
        getChannelCredential,
        adminClient,
        maxClassifyAndDraft: options?.maxClassify,
        maxSends: options?.maxSends,
      })
    },
  }
}
