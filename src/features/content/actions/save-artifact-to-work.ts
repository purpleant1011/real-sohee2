'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const requestId = 'artifact-work-save'
const inputSchema = z.object({
  artifactId: z.string().uuid(),
  requestKey: z.string().uuid(),
}).strict()
const savedSchema = z.object({
  artifactId: z.string().uuid(),
  workItemId: z.string().uuid(),
  contentItemId: z.string().uuid(),
  versionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
}).strict()

export type SavedArtifactWork = Readonly<z.infer<typeof savedSchema> & { next: string }>

function failure(message: string): ActionResult<SavedArtifactWork> {
  return { error: { message, requestId } }
}

export async function saveArtifactToWork(input: unknown): Promise<ActionResult<SavedArtifactWork>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('대화 결과 저장 요청을 확인해 주세요.')

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || typeof userData.user?.id !== 'string') {
      return failure('로그인 후 다시 시도해 주세요.')
    }

    const { data, error } = await supabase.rpc('save_conversation_artifact_to_work', {
      p_artifact_id: parsed.data.artifactId,
      p_request_key: parsed.data.requestKey,
    })
    const saved = savedSchema.safeParse(data)
    if (error || !saved.success) {
      return failure('결과물을 대화 결과에 저장하지 못했습니다. 상태를 확인하고 다시 시도해 주세요.')
    }

    const next = `/app/work/${saved.data.contentItemId}`
    revalidatePath('/app')
    revalidatePath('/app/work')
    revalidatePath(next)
    return { data: { ...saved.data, next } }
  } catch {
    return failure('결과물을 대화 결과에 저장하지 못했습니다. 상태를 확인하고 다시 시도해 주세요.')
  }
}
