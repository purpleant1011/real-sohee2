'use server'

import type { ActionResult } from '@/lib/errors/result'
import { createProductionTextClient } from '@/lib/ai/gemini-responses-adapter'
import { createOpenAIRevisionProvider } from '@/lib/providers/openai-revision-provider'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { revisionInputSchema, revisionResultSchema } from '../version-schema'

type GeminiRevision = Readonly<{
  source: 'gemini'
  caption: string
  hashtags: readonly string[]
  disclosure: string
  revisionReason: string
}>
export type OpenAIRevision = GeminiRevision

function failure(message: string, requestId = 'content-revision'): ActionResult<GeminiRevision> {
  return { error: { message, requestId } }
}

export async function reviseContentAction(input: unknown): Promise<ActionResult<GeminiRevision>> {
  const parsed = revisionInputSchema.safeParse(input)
  if (!parsed.success) return failure('수정 지시 내용을 확인해 주세요.')

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string' || userId.length === 0) {
      return failure('로그인 후 다시 시도해 주세요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    if (
      membershipError ||
      membership?.status !== 'active' ||
      (membership.role !== 'owner' &&
        membership.role !== 'manager' &&
        membership.role !== 'reviewer')
    ) {
      return failure('이 작업공간에서는 콘텐츠를 수정할 수 없습니다.')
    }

    const { data: version, error: versionError } = await supabase
      .from('content_versions')
      .select('content_id, fingerprint')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('content_id', parsed.data.contentId)
      .eq('id', parsed.data.versionId)
      .maybeSingle()
    if (
      versionError ||
      version?.content_id !== parsed.data.contentId ||
      version?.fingerprint !== parsed.data.currentVersionFingerprint
    ) {
      return failure('최신 버전을 다시 열고 수정해 주세요.', 'content-revision-stale')
    }

    const provider = createOpenAIRevisionProvider(createProductionTextClient() as never, 'gemini')
    const revised = revisionResultSchema.safeParse(await provider.revise(parsed.data))
    if (!revised.success) return failure('AI 수정 결과를 만들지 못했습니다.')

    return { data: { source: 'gemini', ...revised.data } }
  } catch {
    return failure('AI 수정을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
