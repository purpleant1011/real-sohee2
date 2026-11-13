'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const requestId = 'content-item'
const inputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    channel: z.enum(['instagram', 'threads', 'naver_blog', 'naver_place']),
  })
  .strict()
const rowSchema = z.object({ id: z.string().uuid() }).strict()

export type CreatedItem = Readonly<{ contentId: string; next: string }>

function failure(message: string): ActionResult<CreatedItem> {
  return { error: { message, requestId } }
}

export async function createContentItemWithClient(
  supabase: Pick<SupabaseClient<Database>, 'auth' | 'from'>,
  input: unknown,
): Promise<ActionResult<CreatedItem>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('새 작업 입력 내용을 확인해 주세요.')

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
    return failure('이 작업공간에서는 새 콘텐츠를 만들 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('content_items')
    .insert({
      workspace_id: parsed.data.workspaceId,
      title: parsed.data.title,
      channel: parsed.data.channel,
      created_by: userId,
    })
    .select('id')
    .single()
  const row = rowSchema.safeParse(data)

  if (error || !row.success) {
    return failure('새 작업을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }

  const next = `/app/work/${row.data.id}/edit`
  return { data: { contentId: row.data.id, next } }
}

export async function createContentItemAction(input: unknown): Promise<ActionResult<CreatedItem>> {
  try {
    const supabase = await createServerSupabaseClient()
    const result = await createContentItemWithClient(supabase, input)
    if (result.data) {
      revalidatePath('/app/work')
    }
    return result
  } catch {
    return failure('새 작업을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
