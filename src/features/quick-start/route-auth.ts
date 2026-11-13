import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { WorkspaceRole } from '@/features/auth/workspace-context'

export interface AuthorizedQuickContext {
  userId: string
  workspaceId: string
  role: WorkspaceRole
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  admin: any
}

/** Resolves the signed-in user and a workspace they actually belong to (never trusts a client-supplied id alone). */
export async function authorizeQuickRequest(
  requestedWorkspaceId?: string | null,
  options?: { requireRole?: 'owner' | 'manager' | 'reviewer'; forbiddenMessage?: string },
): Promise<AuthorizedQuickContext | NextResponse> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })

  const { resolveDeterministicWorkspace } = await import('@/features/auth/workspace-context')
  const resolved = await resolveDeterministicWorkspace({
    supabase,
    userId: user.id,
    userEmail: user.email,
    requestedWorkspaceId,
  })
  if (!resolved.success) {
    return NextResponse.json(
      { error: resolved.statusCode === 404 ? '소속된 매장이 없어요.' : resolved.message },
      { status: resolved.statusCode },
    )
  }
  if (options?.requireRole) {
    const isAllowed =
      resolved.role === 'owner' ||
      (options.requireRole !== 'owner' && resolved.role === 'manager') ||
      (options.requireRole === 'reviewer' && resolved.role === 'reviewer')
    if (!isAllowed) {
      return NextResponse.json(
        { error: options.forbiddenMessage ?? '이 작업은 매장 대표 또는 관리자만 할 수 있어요' },
        { status: 403 },
      )
    }
  }
  return { userId: user.id, workspaceId: resolved.workspaceId, role: resolved.role, supabase, admin: createAdminSupabaseClient() as any }
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse
}
