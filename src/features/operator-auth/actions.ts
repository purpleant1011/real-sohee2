'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { clearReviewPassCookie } from './review-mode'
import { clearLegacyOperatorCookie } from './legacy-cookie'

export async function operatorSignOutAction(): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove obsolete cookies even if the auth provider is unavailable.
    await clearReviewPassCookie()
    await clearLegacyOperatorCookie()

    // Sign out the Supabase user session.
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) return { success: false, error: '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.' }

    return { success: true }
  } catch {
    return { success: false, error: '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.' }
  }
}
