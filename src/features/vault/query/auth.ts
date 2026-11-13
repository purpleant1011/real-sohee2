import { createServerSupabaseClient } from '@/lib/supabase/server'

export interface AuthenticatedWorkspaceContext {
  supabase: any
  userId: string
  workspaceId: string
}

export type AuthResult =
  | { success: true; context: AuthenticatedWorkspaceContext }
  | { success: false; status: number; error: { code: string; message: string } }

/**
 * Validates authentication and active workspace membership.
 * Reuses canonical Supabase server client and workspace_members check pattern.
 */
export async function authenticateWorkspaceMember(
  workspaceId: string,
): Promise<AuthResult> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    return {
      success: false,
      status: 400,
      error: { code: 'INVALID_WORKSPACE_ID', message: '유효한 워크스페이스 ID가 필요합니다.' },
    }
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      success: false,
      status: 401,
      error: { code: 'UNAUTHORIZED', message: '로그인 인증 세션이 필요합니다.' },
    }
  }

  const { data: member, error: memberError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberError || !member) {
    return {
      success: false,
      status: 403,
      error: { code: 'FORBIDDEN', message: '워크스페이스에 접근할 권한이 없습니다.' },
    }
  }

  return {
    success: true,
    context: {
      supabase,
      userId: user.id,
      workspaceId,
    },
  }
}
