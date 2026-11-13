// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ membership: vi.fn(), control: vi.fn(), notifications: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: mocks.membership }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.client }))
vi.mock('@/features/marketing-agent/engine/runtime-control-read', () => ({ readRuntimeControl: mocks.control }))
vi.mock('@/features/notifications/repository', () => ({ getNotificationCenter: mocks.notifications }))
import { GET } from './route'
const WS = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const call = () => GET(new Request(`http://localhost/api/workspaces/${WS}/settings/status`), { params: Promise.resolve({ workspaceId: WS }) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.membership.mockResolvedValue({ ok: true, userId: USER })
  mocks.client.mockResolvedValue({})
  mocks.control.mockResolvedValue({ workspaceId: WS, actualMode: 'OFF' })
  mocks.notifications.mockResolvedValue({ data: { userId: USER, notifications: [{ readAt: null }, { readAt: '2026-11-03T00:00:00Z' }] } })
})
describe('read-only settings status', () => {
  it('reuses canonical sources without returning notification bodies or inventing delivery proof', async () => {
    const response = await call(), body = await response.json()
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body.workspaceId).toBe(WS)
    expect(body.automation.value.mode).toBe('OFF')
    expect(body.notifications.value).toMatchObject({ recentCount: 2, unreadCount: 1 })
    expect(body.notifications.value.notifications).toBeUndefined()
    expect(body.notifications.value.deliveryVerified).toBeUndefined()
    expect(mocks.control).toHaveBeenCalledWith({}, WS)
    expect(mocks.notifications).toHaveBeenCalledWith(WS)
  })
  it('does not read any source before workspace membership succeeds', async () => {
    mocks.membership.mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' })
    expect((await call()).status).toBe(403)
    expect(mocks.control).not.toHaveBeenCalled()
    expect(mocks.notifications).not.toHaveBeenCalled()
  })
  it('preserves notification success when automatic work cannot be read', async () => {
    mocks.control.mockRejectedValue(new Error('READ_FAILED'))
    const body = await (await call()).json()
    expect(body.automation).toEqual({ ok: false, value: null })
    expect(body.notifications.ok).toBe(true)
  })
  it('rejects another workspace control or another account notification source', async () => {
    mocks.control.mockResolvedValue({ workspaceId: 'other', actualMode: 'RUNNING' })
    mocks.notifications.mockResolvedValue({ data: { userId: 'other', notifications: [] } })
    const body = await (await call()).json()
    expect(body.automation).toEqual({ ok: false, value: null })
    expect(body.notifications).toEqual({ ok: false, value: null })
  })
})
