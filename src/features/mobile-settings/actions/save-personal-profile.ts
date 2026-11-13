'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const profileInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, '표시 이름을 1자 이상 80자 이하로 입력해 주세요.')
    .max(80, '표시 이름을 1자 이상 80자 이하로 입력해 주세요.'),
})

export type SavePersonalProfileResult =
  | { ok: true; message: string; displayName: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'UNAVAILABLE'; message: string }

export async function savePersonalProfileAction(
  input: unknown,
): Promise<SavePersonalProfileResult> {
  const parsed = profileInputSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? '표시 이름을 1자 이상 80자 이하로 입력해 주세요.'
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: firstError,
    }
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
    const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null

    if (claimsError || !userId) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        message: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
      }
    }

    const trimmed = parsed.data.displayName

    // migration 20260822183153_user_profile_images.sql:
    // authenticated 롤은 display_name, avatar_* 컬럼만 update 권한이 부여되어 있음.
    // updated_at은 트리거(profiles_set_updated_at)가 자동으로 갱신하므로 포함하지 않는다.
    const { data: existing, error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: trimmed,
      })
      .eq('id', userId)
      .select('id, display_name')
      .maybeSingle()

    if (updateError) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      }
    }

    if (!existing) {
      const { error: insertError } = await supabase.from('profiles').insert({
        id: userId,
        display_name: trimmed,
      })

      if (insertError) {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
        }
      }
    }

    revalidatePath('/app/system/privacy')
    revalidatePath('/app', 'layout')

    return {
      ok: true,
      message: '표시 이름을 저장했어요.',
      displayName: trimmed,
    }
  } catch {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
    }
  }
}
