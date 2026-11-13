export const dynamic = 'force-dynamic'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listActiveWorkspaceMemberships } from '@/features/auth/workspace-context'
import { normalizeWorkspaceName, resolveWorkspaceList } from '@/features/auth/active-workspace'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'

/**
 * ANI-1779: 앱 셸 작업공간 선택기의 목록 API.
 *
 * - 인증 사용자의 **활성** 멤버십과 서버가 확인한 가게 이름만 내려준다.
 * - 조회 실패는 빈 목록이 아니다. `loadState` 를 `empty` 로 위장하지 않고 5xx 로 끝낸다.
 * - 선택 상태(쿠키)는 이 응답에서 읽기 전용으로만 알려 주며, 변경은 POST /api/workspaces/active 다.
 */

const NO_STORE = { 'cache-control': 'private, no-store' } as const

type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  readPreferredWorkspaceId(): Promise<string | null>
  listMemberships(userId: string): Promise<unknown[]>
  loadWorkspaceNames(
    workspaceIds: readonly string[],
  ): Promise<Readonly<Record<string, string | null>>>
}>

function failure(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers: NO_STORE })
}

export function createWorkspaceListGetHandler(dependencies: Dependencies) {
  return async function GET() {
    let userId: string | null
    try {
      userId = await dependencies.authenticate()
    } catch {
      return failure('WORKSPACE_LIST_UNAVAILABLE', 500)
    }
    if (!userId) return failure('AUTH_REQUIRED', 401)

    try {
      const memberships = await dependencies.listMemberships(userId)
      const activeMemberships = listActiveWorkspaceMemberships(memberships)
      // 응답 형식이 계약과 다르면 0건이 아니라 오류다(fail-closed).
      if (activeMemberships === null) return failure('WORKSPACE_LIST_UNAVAILABLE', 500)

      const preferredWorkspaceId = await dependencies.readPreferredWorkspaceId()
      const names = activeMemberships.length > 0
        ? await dependencies.loadWorkspaceNames(
          activeMemberships.map((membership) => membership.workspaceId),
        )
        : {}

      const resolution = resolveWorkspaceList({
        memberships,
        names,
        preferredWorkspaceId,
      })

      if (resolution.state === 'unavailable') return failure('WORKSPACE_LIST_UNAVAILABLE', 500)
      if (resolution.state === 'empty') {
        return Response.json(
          { data: { loadState: 'empty', workspaces: [], activeId: null, fellBack: false } },
          { headers: NO_STORE },
        )
      }

      return Response.json(
        {
          data: {
            loadState: 'ready',
            workspaces: resolution.workspaces,
            activeId: resolution.activeId,
            fellBack: resolution.fellBack,
          },
        },
        { headers: NO_STORE },
      )
    } catch {
      return failure('WORKSPACE_LIST_UNAVAILABLE', 500)
    }
  }
}

export async function GET() {
  let client: any
  try {
    client = await createServerSupabaseClient()
  } catch {
    return failure('WORKSPACE_LIST_UNAVAILABLE', 500)
  }
  if (!client) return failure('WORKSPACE_LIST_UNAVAILABLE', 500)

  return createWorkspaceListGetHandler({
    async authenticate() {
      const result = await client.auth.getClaims()
      const subject = result?.data?.claims?.sub
      return result?.error || typeof subject !== 'string' || subject.length === 0 ? null : subject
    },
    readPreferredWorkspaceId: readPreferredWorkspaceIdFromCookies,
    async listMemberships(userId) {
      const result = await client
        .from('workspace_members')
        .select('workspace_id, role, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
      if (result?.error) throw new Error('WORKSPACE_MEMBERSHIP_LOOKUP_FAILED')
      return Array.isArray(result?.data) ? result.data : []
    },
    async loadWorkspaceNames(workspaceIds) {
      if (workspaceIds.length === 0) return {}
      const result = await client.from('workspaces').select('id, name').in('id', workspaceIds)
      if (result?.error) throw new Error('WORKSPACE_NAME_LOOKUP_FAILED')
      const names: Record<string, string | null> = {}
      for (const row of Array.isArray(result?.data) ? result.data : []) {
        if (typeof row?.id !== 'string') continue
        names[row.id] = normalizeWorkspaceName(row?.name)
      }
      return names
    },
  })()
}
