import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  requireOperatorMock,
  getUserMock,
  fromMock,
  rpcMock,
  adminFromMock,
  adminUpsertMock,
  adminRpcMock,
} = vi.hoisted(() => ({
  requireOperatorMock: vi.fn(),
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  adminFromMock: vi.fn(),
  adminUpsertMock: vi.fn(),
  adminRpcMock: vi.fn(),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: requireOperatorMock
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock
    },
    from: fromMock,
    rpc: rpcMock
  }))
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: adminFromMock,
    rpc: adminRpcMock,
  }))
}))

import { POST } from '../route'

describe('Admin Verify Business API Route [ANI-1334, ANI-603, P0-3]', () => {
  const workspaceId = 'ws-test-123'

  beforeEach(() => {
    vi.clearAllMocks()
    requireOperatorMock.mockResolvedValue(undefined)
    getUserMock.mockResolvedValue({
      data: { user: { id: 'operator-1', email: 'admin@example.com' } },
      error: null
    })
    adminUpsertMock.mockResolvedValue({ data: null, error: null })
    adminFromMock.mockReturnValue({
      upsert: adminUpsertMock,
    })
    // RPC is only executable as service_role after operator authorization.
    adminRpcMock.mockImplementation((...args) => rpcMock(...args))
  })

  it('rejects invalid status with 400', async () => {
    const req = new NextRequest(`http://localhost:3000/api/admin/workspaces/${workspaceId}/verify-business`, {
      method: 'POST',
      body: JSON.stringify({ status: 'INVALID_STATUS' })
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('유효한 심사 상태')
  })

  it('ANI-603: rejects VERIFIED status when business number is missing or 0000000000', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          business_number: '0000000000',
          company_name: '테스트매장'
        },
        error: null
      })
    })

    const req = new NextRequest(`http://localhost:3000/api/admin/workspaces/${workspaceId}/verify-business`, {
      method: 'POST',
      body: JSON.stringify({ status: 'VERIFIED' })
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('ANI-603')
  })

  it('[P0-3] calls atomic admin_verify_business_and_grant_taste RPC and returns 200 on success', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          business_number: '1208147521',
          company_name: '소희카페',
          representative_name: '홍길동'
        },
        error: null
      })
    })

    rpcMock.mockResolvedValueOnce({
      data: {
        success: true,
        workspace_id: workspaceId,
        status: 'VERIFIED',
        energy_granted: 0,
        credits_granted: 1000,
        already_granted: false
      },
      error: null
    })

    const req = new NextRequest(`http://localhost:3000/api/admin/workspaces/${workspaceId}/verify-business`, {
      method: 'POST',
      body: JSON.stringify({ status: 'VERIFIED', reason: '정상 승인' })
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.status).toBe('VERIFIED')
    expect(json.energyGranted).toBe(0)
    expect(json.creditsGranted).toBe(1000)
    expect(json.alreadyGranted).toBe(false)
    expect(rpcMock).toHaveBeenCalledWith('admin_verify_business_and_grant_taste', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_status: 'VERIFIED'
    }))
  })

  it('rejects invalid business number format with 400 when provided', async () => {
    const req = new NextRequest(`http://localhost:3000/api/admin/workspaces/${workspaceId}/verify-business`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'VERIFIED',
        businessNumber: '123-45' // not 10 digits
      })
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('10자리 숫자')
  })

  it('upserts business verification info and succeeds when body provides valid business info', async () => {
    // existing bv row is missing (null)
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null
      })
    })

    rpcMock.mockResolvedValueOnce({
      data: {
        success: true,
        workspace_id: workspaceId,
        status: 'VERIFIED',
        energy_granted: 0,
        credits_granted: 0,
        already_granted: true
      },
      error: null
    })

    const req = new NextRequest(`http://localhost:3000/api/admin/workspaces/${workspaceId}/verify-business`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'VERIFIED',
        businessNumber: '123-45-67890',
        companyName: '신규소희매장',
        representativeName: '김대표'
      })
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.status).toBe('VERIFIED')
    expect(json.energyGranted).toBe(0)
    expect(json.creditsGranted).toBe(0)
    expect(json.alreadyGranted).toBe(true)

    // Expect upsert to be called with normalized 10-digit number
    expect(adminUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        business_number: '1234567890',
        company_name: '신규소희매장',
        representative_name: '김대표'
      }),
      { onConflict: 'workspace_id' }
    )

    expect(rpcMock).toHaveBeenCalledWith('admin_verify_business_and_grant_taste', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_status: 'VERIFIED',
      p_reason: null
    }))
  })
})
