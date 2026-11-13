import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const guard = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: guard }))
vi.mock('@/features/sohee-studio/services/sohee-studio-service', () => ({ updateStudioGoal: update }))
import { PATCH } from './route'

const workspaceId = 'abce8912-4423-4f09-acdf-ab38324a43f9'
const userId = '8ef19569-3bce-4cdd-900d-9d9ce3bc8cb4'
const id = '82f0429a-45cb-4431-8d39-e00239ea48e2'
const params = { params: Promise.resolve({ workspaceId, id }) }
const request = (body: object) => new NextRequest('http://localhost/goals', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ ok: true, workspaceId, userId, role: 'owner' }) })

describe('Studio goal update', () => {
  it('requires membership before mutating a goal', async () => {
    guard.mockResolvedValue({ ok: false, status: 401, error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' })
    expect((await PATCH(request({ expectedVersion: 1, status: 'paused' }), params)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects a viewer', async () => {
    guard.mockResolvedValue({ ok: true, workspaceId, userId, role: 'viewer' })
    expect((await PATCH(request({ expectedVersion: 1, status: 'paused' }), params)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
  it('requires expected version to avoid overwriting concurrent edits', async () => {
    expect((await PATCH(request({ status: 'paused' }), params)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
  it('uses server actor and workspace and allows pausing', async () => {
    update.mockResolvedValue({ id, status: 'paused', version: 2 })
    const response = await PATCH(request({ expectedVersion: 1, status: 'paused' }), params)
    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ workspaceId, userId, goalId: id, expectedVersion: 1, status: 'paused' })
  })
  it('rejects client-asserted achievement without measured evidence', async () => {
    expect((await PATCH(request({ expectedVersion: 1, status: 'achieved' }), params)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
  it('returns a stale goal conflict as 409', async () => {
    update.mockRejectedValue(new Error('STUDIO_GOAL_CONFLICT'))
    expect((await PATCH(request({ expectedVersion: 1, title: '수정 목표' }), params)).status).toBe(409)
  })
})
