import 'server-only'

import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveActiveWorkspaceSelection } from './active-workspace'
import { readPreferredWorkspaceIdFromCookies } from './active-workspace.server'

/** layout·홈은 같은 RSC 요청 안에서만 인증·가게 해석을 공유한다. 요청 간 캐시는 금지한다. */
export const readAppWorkspace = cache(async () => {
  const supabase = await createServerSupabaseClient()
  const claimsResult = await supabase?.auth?.getClaims?.()
  const subject = claimsResult?.data?.claims?.sub
  const userId = typeof subject === 'string' && subject ? subject : null
  if (!userId) return { supabase, userId: null, workspace: null, error: null }

  const { data: memberships, error } = (await supabase
    ?.from?.('workspace_members')
    ?.select?.('workspace_id, role, status')
    ?.eq?.('user_id', userId)
    ?.order?.('created_at', { ascending: true })) ?? {}
  const preferredWorkspaceId = await readPreferredWorkspaceIdFromCookies()
  return {
    supabase,
    userId,
    workspace: error ? null : resolveActiveWorkspaceSelection(memberships, preferredWorkspaceId),
    error: error ?? null,
  }
})
