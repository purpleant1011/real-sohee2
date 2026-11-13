import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const operatorId = '10000000-0000-4000-8000-000000000001'

const mocks = vi.hoisted(() => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: operatorId })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: mocks.requireOperatorAnyScope,
}))

import { listOperatorAdmins } from './repository'

const adminRow = {
  user_id: '30000000-0000-4000-8000-000000000001',
  email: 'o***@example.com',
  status: 'active',
  role_keys: ['operations_admin'],
  role_display_names: ['운영 관리자'],
  scope_summary: { kind: 'global', workspace_count: 0 },
  mfa_required: true,
  mfa_enrolled: true,
  mfa_exception_state: 'none',
  mfa_exception_until: null,
  password_set_at: '2026-08-23T10:00:00.000Z',
  activated_at: '2026-08-23T10:05:00.000Z',
  last_reviewed_at: '2026-08-23T11:00:00.000Z',
  created_at: '2026-08-23T09:00:00.000Z',
  updated_at: '2026-08-23T11:00:00.000Z',
  data_freshness: 'fresh',
  session_state: 'unknown',
  last_login_at: null,
}

describe('listOperatorAdmins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires admin.read and returns only the safe administrator projection', async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [adminRow], next_cursor: null },
      error: null,
    }))

    const result = await listOperatorAdmins({}, { gateway: { rpc } })

    expect(mocks.requireOperatorAnyScope).toHaveBeenCalledWith('admin.read', undefined)
    expect(rpc).toHaveBeenCalledWith('list_operator_admins', {
      p_status: null,
      p_role_key: null,
      p_mfa_state: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_limit: 50,
    })
    expect(result).toEqual({
      data: {
        items: [{
          userId: adminRow.user_id,
          email: adminRow.email,
          status: 'active',
          roleKeys: ['operations_admin'],
          roleDisplayNames: ['운영 관리자'],
          scopeSummary: { kind: 'global', workspaceCount: 0 },
          mfaRequired: true,
          mfaEnrolled: true,
          mfaExceptionState: 'none',
          mfaExceptionUntil: null,
          passwordSetAt: adminRow.password_set_at,
          activatedAt: adminRow.activated_at,
          lastReviewedAt: adminRow.last_reviewed_at,
          createdAt: adminRow.created_at,
          updatedAt: adminRow.updated_at,
          dataFreshness: 'fresh',
          sessionState: 'unknown',
          lastLoginAt: null,
        }],
        nextCursor: null,
      },
      error: null,
    })
  })

  it('fails closed when the RPC response contains an unsafe or malformed row', async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [{ ...adminRow, mfa_secret: 'never-return-this' }], next_cursor: null },
      error: null,
    }))

    await expect(listOperatorAdmins({}, { gateway: { rpc } })).resolves.toEqual({
      data: null,
      error: 'ADMIN_LIST_UNAVAILABLE',
    })
  })

  it('keeps sessions and recent login unknown when no source-backed data exists', async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [adminRow], next_cursor: null },
      error: null,
    }))

    const result = await listOperatorAdmins({}, { gateway: { rpc } })

    expect(result.data?.items[0]).toMatchObject({ sessionState: 'unknown', lastLoginAt: null })
  })
})
