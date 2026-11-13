import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase/server'

export type WorkspaceAuthSuccess = {
  ok: true
  userId: string
  email?: string
  role: string
  workspaceId: string
}

export type WorkspaceAuthFailure = {
  ok: false
  status: 401 | 403 | 400
  error: string
  message: string
}

export type WorkspaceAuthResult = WorkspaceAuthSuccess | WorkspaceAuthFailure

/**
 * Server-side authorization guard to prevent IDOR/BOLA and ensure strict workspace boundary.
 * Enforces:
 * 1. User must be authenticated (401).
 * 2. Default/dummy workspace 'ws-default' is blocked in production mutations (400/403).
 * 3. User must be an active member of the requested workspaceId (403).
 * 4. Special demo isolation for showcase accounts.
 */
export async function requireWorkspaceMembership(
  workspaceId: string,
  options?: { allowDemoBypass?: boolean }
): Promise<WorkspaceAuthResult> {
  if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_WORKSPACE_ID',
      message: '유효한 작업공간 식별자가 필요합니다.',
    }
  }

  const cleanWsId = workspaceId.trim()

  // Block dummy workspace in production
  const isProduction =
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PUBLIC_APP_ENV !== 'staging' &&
    process.env.NEXT_PUBLIC_APP_ENV !== 'test'

  if (cleanWsId === 'ws-default' && isProduction) {
    return {
      ok: false,
      status: 403,
      error: 'PRODUCTION_DEFAULT_WORKSPACE_PROHIBITED',
      message: '운영 환경에서는 기본 가상 작업공간을 사용할 수 없습니다.',
    }
  }

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return {
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
      }
    }

    // Showcase Demo Isolation (ANI-700 / ANI-721)
    if (user.email === 'test@example.com') {
      const demoWsId = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID || 'ws-demo-byreum'
      if (cleanWsId !== demoWsId && !options?.allowDemoBypass) {
        return {
          ok: false,
          status: 403,
          error: 'SHOWCASE_DEMO_ISOLATED',
          message: '데모 계정은 지정된 데모 쇼케이스 작업공간에만 접근할 수 있습니다.',
        }
      }
      return {
        ok: true,
        userId: user.id,
        email: user.email,
        role: 'owner',
        workspaceId: cleanWsId,
      }
    }

    // Membership check from database
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, status')
      .eq('workspace_id', cleanWsId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (memberError) {
      console.error('[requireWorkspaceMembership] DB check error:', memberError)
      return {
        ok: false,
        status: 403,
        error: 'WORKSPACE_QUERY_FAILED',
        message: '작업공간 권한을 확인할 수 없습니다.',
      }
    }

    if (!membership) {
      // Also check if user is the direct owner in workspaces table
      const { data: workspaceOwner, error: ownerError } = await supabase
        .from('workspaces')
        .select('id, created_by')
        .eq('id', cleanWsId)
        .eq('created_by', user.id)
        .maybeSingle()

      if (ownerError || !workspaceOwner) {
        return {
          ok: false,
          status: 403,
          error: 'WORKSPACE_FORBIDDEN',
          message: '해당 작업공간에 대한 접근 권한이 없습니다.',
        }
      }

      return {
        ok: true,
        userId: user.id,
        email: user.email,
        role: 'owner',
        workspaceId: cleanWsId,
      }
    }

    return {
      ok: true,
      userId: user.id,
      email: user.email,
      role: membership.role || 'member',
      workspaceId: cleanWsId,
    }
  } catch (err) {
    console.error('[requireWorkspaceMembership] Unexpected error:', err)
    return {
      ok: false,
      status: 403,
      error: 'SERVER_ERROR',
      message: '작업공간 접근 검증 중 오류가 발생했습니다.',
    }
  }
}
