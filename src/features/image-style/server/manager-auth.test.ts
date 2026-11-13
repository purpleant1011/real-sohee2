// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = mocks.membership
      return q
    },
  })),
}))

import { authorizeManager } from './manager-auth'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('authorizeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await authorizeManager(workspaceId)
    expect(result).toEqual({ message: '로그인 후 다시 시도해 주세요.' })
  })

  it('rejects users with auth error', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('auth error') })
    const result = await authorizeManager(workspaceId)
    expect(result).toEqual({ message: '로그인 후 다시 시도해 주세요.' })
  })

  it('rejects non-members or inactive members', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValueOnce({ data: null, error: null })
    const notMember = await authorizeManager(workspaceId)
    expect(notMember).toEqual({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })

    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValueOnce({ data: { role: 'owner', status: 'invited' }, error: null })
    const inactive = await authorizeManager(workspaceId)
    expect(inactive).toEqual({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })
  })

  it('rejects members with viewer or member role', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValueOnce({ data: { role: 'viewer', status: 'active' }, error: null })
    const viewer = await authorizeManager(workspaceId)
    expect(viewer).toEqual({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })
  })

  it('authorizes active owners', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValueOnce({ data: { role: 'owner', status: 'active' }, error: null })
    const result = await authorizeManager(workspaceId)
    expect(result).toEqual({ userId, role: 'owner' })
  })

  it('authorizes active managers', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null })
    mocks.membership.mockResolvedValueOnce({ data: { role: 'manager', status: 'active' }, error: null })
    const result = await authorizeManager(workspaceId)
    expect(result).toEqual({ userId, role: 'manager' })
  })
})
