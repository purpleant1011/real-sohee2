export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context'
import { persistActiveWorkspaceCookie } from '@/features/auth/active-workspace.server'

/**
 * ANI-1779: 작업공간 전환. 화면이 보낸 가게 id 를 그대로 믿지 않고 **멤버십을 다시 검증**한 뒤
 * 서버가 읽는 쿠키에 저장한다. 거부·실패 시 쿠키를 쓰지 않으므로 화면은 이전 가게로 남는다.
 */

const NO_STORE = { 'cache-control': 'private, no-store' } as const

const switchBodySchema = z.object({ workspaceId: z.string().uuid() }).strict()

type MembershipCheck = 'active' | 'forbidden' | 'not_found' | 'unavailable'

type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  verifyMembership(input: Readonly<{ userId: string; workspaceId: string }>): Promise<MembershipCheck>
  persistActiveWorkspace(workspaceId: string): Promise<void>
}>

function failure(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers: NO_STORE })
}

export function createWorkspaceSwitchPostHandler(dependencies: Dependencies) {
  return async function POST(request: Request) {
    let userId: string | null
    try {
      userId = await dependencies.authenticate()
    } catch {
      return failure('WORKSPACE_SELECTION_UNAVAILABLE', 500)
    }
    if (!userId) return failure('AUTH_REQUIRED', 401)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure('WORKSPACE_INVALID', 400)
    }

    const parsed = switchBodySchema.safeParse(body)
    if (!parsed.success) return failure('WORKSPACE_INVALID', 400)
    const { workspaceId } = parsed.data

    let check: MembershipCheck
    try {
      check = await dependencies.verifyMembership({ userId, workspaceId })
    } catch {
      check = 'unavailable'
    }
    // 비멤버십·비활성 멤버십은 권한 없음으로 거절하고 저장하지 않는다.
    if (check === 'forbidden' || check === 'not_found') {
      return failure('WORKSPACE_FORBIDDEN', 403)
    }
    if (check !== 'active') return failure('WORKSPACE_SELECTION_UNAVAILABLE', 500)

    try {
      await dependencies.persistActiveWorkspace(workspaceId)
    } catch {
      return failure('WORKSPACE_SELECTION_UNAVAILABLE', 500)
    }

    return Response.json({ data: { activeId: workspaceId } }, { headers: NO_STORE })
  }
}

export async function POST(request: Request) {
  let client: any
  try {
    client = await createServerSupabaseClient()
  } catch {
    return failure('WORKSPACE_SELECTION_UNAVAILABLE', 500)
  }
  if (!client) return failure('WORKSPACE_SELECTION_UNAVAILABLE', 500)

  const handler = createWorkspaceSwitchPostHandler({
    async authenticate() {
      const result = await client.auth.getClaims()
      const subject = result?.data?.claims?.sub
      return result?.error || typeof subject !== 'string' || subject.length === 0 ? null : subject
    },
    async verifyMembership({ userId, workspaceId }) {
      const resolution = await resolveDeterministicWorkspace({
        supabase: client,
        userId,
        requestedWorkspaceId: workspaceId,
      })
      if (resolution.success) return 'active'
      switch (resolution.error) {
        case 'CROSS_TENANT_ACCESS_DENIED':
          return 'forbidden'
        case 'WORKSPACE_NOT_FOUND':
          return 'not_found'
        default:
          return 'unavailable'
      }
    },
    persistActiveWorkspace: persistActiveWorkspaceCookie,
  })

  return handler(request)
}
