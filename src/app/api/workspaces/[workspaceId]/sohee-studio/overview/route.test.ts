import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const guard = vi.hoisted(() => vi.fn())
const overview = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: guard }))
vi.mock('@/features/sohee-studio/services/sohee-studio-service', () => ({ getStudioOverview: overview }))

const workspaceId = '15150516-b411-4c91-9c58-2dbf657356a6'
const request = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/sohee-studio/overview`)
const params = { params: Promise.resolve({ workspaceId }) }

beforeEach(() => { guard.mockReset(); overview.mockReset() })

describe('Studio overview authorization', () => {
  it('returns 401 without authentication and never reads another workspace', async () => {
    guard.mockResolvedValue({ ok: false, status: 401, error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' })
    const response = await GET(request, params)
    expect(response.status).toBe(401)
    expect(overview).not.toHaveBeenCalled()
  })

  it('returns 403 when a caller is not a workspace member', async () => {
    guard.mockResolvedValue({ ok: false, status: 403, error: 'WORKSPACE_FORBIDDEN', message: '접근할 수 없습니다.' })
    const response = await GET(request, params)
    expect(response.status).toBe(403)
    expect(overview).not.toHaveBeenCalled()
  })

  it('does not turn a database failure into an empty success response', async () => {
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    overview.mockRejectedValue(new Error('database unavailable'))
    const response = await GET(request, params)
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect((await response.json()).success).toBe(false)
  })
})
