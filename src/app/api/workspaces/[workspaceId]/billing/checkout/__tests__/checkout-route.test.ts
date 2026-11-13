import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import * as workspaceGuard from '@/lib/auth/workspace-guard'
import * as billingRepo from '@/features/billing/repository'

vi.mock('@/lib/auth/workspace-guard')
vi.mock('@/features/billing/repository')

describe('Billing Checkout Route (ANI-732)', () => {
  const mockWorkspaceId = '88000000-0000-4000-8000-000000000099'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated or unauthorized users with 401/403 (ANI-721 IDOR guard)', async () => {
    vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'WORKSPACE_ACCESS_DENIED',
      message: '해당 워크스페이스에 대한 접근 권한이 없습니다.',
    })

    const req = new NextRequest('http://localhost/api/workspaces/' + mockWorkspaceId + '/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planCode: 'GROWTH_300K' }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('WORKSPACE_ACCESS_DENIED')
  })

  it('blocks commercial plan aliases with 409 BUSINESS_DECISION_REQUIRED', async () => {
    vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
      ok: true,
      userId: 'usr-owner',
      role: 'owner',
      workspaceId: mockWorkspaceId,
    })

    const req = new NextRequest('http://localhost/api/workspaces/' + mockWorkspaceId + '/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        planCode: 'GROWTH_300K',
        idempotencyKey: '88000000-0000-4000-8000-000000000102',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('BUSINESS_DECISION_REQUIRED')
  })

  it('creates checkout intent for canonical plan code with savedIntentOnly:true', async () => {
    vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
      ok: true,
      userId: 'usr-owner',
      role: 'owner',
      workspaceId: mockWorkspaceId,
    })

    vi.spyOn(billingRepo, 'createCheckoutIntent').mockResolvedValueOnce({
      data: {
        checkoutIntentId: '88000000-0000-4000-8000-000000000101',
        state: 'provider_pending',
      },
    })

    const req = new NextRequest('http://localhost/api/workspaces/' + mockWorkspaceId + '/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        planCode: 'operations',
        idempotencyKey: '88000000-0000-4000-8000-000000000102',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.savedIntentOnly).toBe(true)
    expect(json.planCode).toBe('operations')
    expect(json.checkoutIntentId).toBe('88000000-0000-4000-8000-000000000101')
  })
})
