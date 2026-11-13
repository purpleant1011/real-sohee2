'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  urlSourceInputSchema,
  type UrlSourceInput,
} from '../url-source-schema'

export type RegisteredUrlSource = Readonly<UrlSourceInput & { id: string }>

export type UrlSourceInsertGateway = Readonly<{
  insert(input: UrlSourceInput): Promise<RegisteredUrlSource>
}>

type RegisterDependencies = Readonly<{
  authorize(workspaceId: string): Promise<boolean>
  gateway: UrlSourceInsertGateway
}>

function failure(message: string, requestId: string): ActionResult<RegisteredUrlSource> {
  return { error: { message, requestId } }
}

async function createDependencies(): Promise<RegisterDependencies> {
  const supabase = await createServerSupabaseClient()
  return {
    async authorize(workspaceId) {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if (userError || typeof userId !== 'string') return false
      const { data: membership, error } = await supabase
        .from('workspace_members')
        .select('role, status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      return !error && membership?.status === 'active'
        && (membership.role === 'owner' || membership.role === 'manager')
    },
    gateway: {
      async insert(input) {
        const { data: userData, error: userError } = await supabase.auth.getUser()
        const userId = userData?.user?.id
        if (userError || typeof userId !== 'string') throw new Error('url_source_user_missing')
        const { data, error } = await supabase
          .from('knowledge_sources')
          .insert({
            workspace_id: input.workspaceId,
            created_by_user_id: userId,
            source_type: 'url',
            provider_mode: 'registered_only',
            channel_type: input.channel,
            uri: input.url,
            display_name: new URL(input.url).hostname,
            status: input.collectionState === 'refresh_required' ? 'collection_pending' : 'registered',
            refresh_policy: {
              ownership: input.ownership,
              allowedUse: input.allowedUse,
              requestedScope: input.requestedScope,
              collectionState: input.collectionState,
              verifiedOwnership: false,
            },
          })
          .select('id')
          .single()
        if (error || typeof data?.id !== 'string') throw new Error('url_source_insert_failed')
        return { id: data.id, ...input }
      },
    },
  }
}

export async function registerUrlSourceAction(
  input: unknown,
  providedDependencies?: RegisterDependencies,
): Promise<ActionResult<RegisteredUrlSource>> {
  const parsed = urlSourceInputSchema.safeParse(input)
  if (!parsed.success) return failure('주소와 채널을 확인해 주세요.', 'knowledge-url-source-input')

  try {
    const dependencies = providedDependencies ?? await createDependencies()
    if (!await dependencies.authorize(parsed.data.workspaceId)) {
      return failure('주소 출처를 등록할 권한이 없습니다.', 'knowledge-url-source-authorize')
    }
    const source = await dependencies.gateway.insert(parsed.data)
    revalidatePath('/app/account/knowledge')
    return { data: source }
  } catch {
    return failure('주소 출처를 저장하지 못했습니다.', 'knowledge-url-source-save')
  }
}
