import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/engagement/killswitch/route'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(),
}))

vi.mock('@/features/operator-engagement/engagement-repository', () => ({
  executeEngagementKillSwitch: vi.fn(),
}))

import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { executeEngagementKillSwitch } from '@/features/operator-engagement/engagement-repository'

describe('POST /api/admin/engagement/killswitch', () => {
  it('returns 403 when operator auth fails', async () => {
    vi.mocked(requireOperatorAnyScope).mockRejectedValueOnce(
      new OperatorAccessError('PERMISSION_DENIED'),
    )

    const req = new NextRequest('http://localhost/api/admin/engagement/killswitch', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'all',
        action: 'downgrade_to_l1',
        reason: '테스트 사유',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('PERMISSION_DENIED')
  })

  it('returns 400 on invalid json or validation failure', async () => {
    vi.mocked(requireOperatorAnyScope).mockResolvedValueOnce({
      userId: 'op-1',
      role: 'super_admin',
      permissions: ['system.read'],
      workspaces: [],
    } as any)

    const req = new NextRequest('http://localhost/api/admin/engagement/killswitch', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'workspace', // workspaceId missing
        action: 'downgrade_to_l1',
        reason: '사유',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('VALIDATION_FAILED')
  })

  it('returns 200 on successful killswitch execution', async () => {
    vi.mocked(requireOperatorAnyScope).mockResolvedValueOnce({
      userId: 'op-1',
      role: 'super_admin',
      permissions: ['system.read'],
      workspaces: [],
    } as any)

    vi.mocked(executeEngagementKillSwitch).mockResolvedValueOnce({
      success: true,
      scope: 'all',
      action: 'downgrade_to_l1',
      affectedWorkspaces: 5,
      updatedPolicies: 5,
      timestamp: '2026-10-14T12:00:00.000Z',
    })

    const req = new NextRequest('http://localhost/api/admin/engagement/killswitch', {
      method: 'POST',
      body: JSON.stringify({
        scope: 'all',
        action: 'downgrade_to_l1',
        reason: '인스타그램 환각 답글 의심 발생으로 인한 L3 긴급 중단',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.affectedWorkspaces).toBe(5)
    expect(executeEngagementKillSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'all',
        action: 'downgrade_to_l1',
      }),
      'op-1',
    )
  })
})
