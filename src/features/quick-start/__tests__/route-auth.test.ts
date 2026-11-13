import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(), createAdminSupabaseClient: vi.fn(), resolveDeterministicWorkspace: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolveDeterministicWorkspace }))
import { authorizeQuickRequest } from '../route-auth'

describe('quick-start write authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })
    mocks.resolveDeterministicWorkspace.mockResolvedValue({ success: true, workspaceId: 'workspace-1', role: 'viewer', status: 'active' })
  })
  it('returns 403 for viewer writes while allowing reads', async () => {
    const denied = await authorizeQuickRequest('workspace-1', { requireRole: 'manager' })
    expect(denied).toBeInstanceOf(NextResponse)
    expect((denied as NextResponse).status).toBe(403)
    expect(await (denied as NextResponse).json()).toMatchObject({ error: '이 작업은 매장 대표 또는 관리자만 할 수 있어요' })
    const allowed = await authorizeQuickRequest('workspace-1')
    expect(allowed).toMatchObject({ workspaceId: 'workspace-1', role: 'viewer' })
  })
})
