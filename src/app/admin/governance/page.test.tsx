import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/operator-admin/repository', () => ({
  listOperatorAdmins: vi.fn(async () => ({
    data: {
      items: [
        {
          userId: '30000000-0000-4000-8000-000000000001',
          email: 'admin@example.com',
          status: 'active',
          roleKeys: ['operations_admin'],
          roleDisplayNames: ['운영 관리자'],
          scopeSummary: { kind: 'global', workspaceCount: 0 },
          mfaRequired: true,
          mfaEnrolled: true,
          passwordSetAt: '2026-08-23T10:00:00.000Z',
          activatedAt: '2026-08-23T10:05:00.000Z',
          lastReviewedAt: '2026-08-23T11:00:00.000Z',
          createdAt: '2026-08-23T09:00:00.000Z',
          updatedAt: '2026-08-23T11:00:00.000Z',
          dataFreshness: 'fresh',
          sessionState: 'unknown',
          lastLoginAt: null,
        },
      ],
      nextCursor: null,
    },
    error: null,
  })),
}))

import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { listOperatorAdmins } from '@/features/operator-admin/repository'
import Page from './page'

describe('GovernancePage', () => {
  it('checks admin.read permission and queries listOperatorAdmins', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('admin.read')
    expect(listOperatorAdmins).toHaveBeenCalled()
    expect(view.props.adminSummary).toBeDefined()
    expect(view.props.adminSummary.data.items).toHaveLength(1)
  })
})
