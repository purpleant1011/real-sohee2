import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendar: vi.fn(),
}))

vi.mock('@/features/vault/query/auth', () => ({
  authenticateWorkspaceMember: mocks.auth,
}))

vi.mock('@/features/vault/query/vault-query-service', () => ({
  SupabaseVaultQueryRepository: class {},
  VaultQueryService: class {
    getCalendar = mocks.getCalendar
  },
}))

import { GET } from './route'

describe('GET /api/workspaces/[workspaceId]/vault/calendar error leak protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('masks raw database error messages with fixed korean fallback', async () => {
    mocks.auth.mockResolvedValue({
      success: true,
      context: { supabase: {} },
    })
    mocks.getCalendar.mockRejectedValue(
      new Error('Database query failed: connection closed abnormally (code: 57P01)'),
    )

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/vault/calendar?ym=2026-10')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('FETCH_VAULT_CALENDAR_FAILED')
    expect(json.error.message).toBe('보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(JSON.stringify(json)).not.toContain('Database query failed')
    expect(JSON.stringify(json)).not.toContain('57P01')
  })
})
