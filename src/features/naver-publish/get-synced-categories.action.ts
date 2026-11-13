'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getSyncedNaverCategories } from './synced-categories.server'
import type { NaverCategory } from './types'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
}).strict()

function fail(message: string): ActionResult<never> {
  return { error: { message, requestId: 'get-synced-categories' } }
}

export async function getSyncedNaverCategoriesAction(
  input: unknown,
): Promise<ActionResult<NaverCategory[]>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return fail('매장 정보를 확인해 주세요.')
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      return fail('로그인이 필요해요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError || membership?.status !== 'active') {
      return fail('이 매장에 접근할 수 없어요.')
    }

    const categories = await getSyncedNaverCategories(parsed.data.workspaceId)
    return { data: categories }
  } catch {
    return fail('카테고리 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
