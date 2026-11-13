import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('../../../features/operator-admin/repository', () => ({
  listOperatorAdmins: vi.fn(async () => ({
    data: {
      items: [
        {
          userId: '30000000-0000-4000-8000-000000000001',
          email: 'o***@example.com',
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

vi.mock('../../../features/operator-admin/approval-repository', () => ({
  listOperatorAdminApprovals: vi.fn(async () => ({ data: [], error: null })),
}))
vi.mock('../../../features/operator-admin/selector-repository', () => ({
  listOperatorAdminSelectors: vi.fn(async () => ({ data: [], error: null })),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorAdmins } from '../../../features/operator-admin/repository'
import { listOperatorAdminApprovals } from '../../../features/operator-admin/approval-repository'
import { listOperatorAdminSelectors } from '../../../features/operator-admin/selector-repository'
import Page from './page'

describe('OperatorAdminsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('guards admins directly and renders the account operations view', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('admin.read')
    expect(listOperatorAdmins).toHaveBeenCalledWith()
    expect(listOperatorAdminApprovals).toHaveBeenCalledWith()
    expect(listOperatorAdminSelectors).toHaveBeenCalledWith()
    expect(view.props.result).toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            email: 'o***@example.com',
            roleDisplayNames: ['운영 관리자'],
            sessionState: 'unknown',
            lastLoginAt: null,
          }),
        ],
        nextCursor: null,
      },
      error: null,
    })
  })

  it('surfaces LoadErrorNotice when admin list fetch fails', async () => {
    vi.mocked(listOperatorAdmins).mockResolvedValueOnce({ data: null, error: 'ADMIN_LIST_UNAVAILABLE' as any })
    const view = await Page()
    render(view)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/운영 관리자 계정 목록을\(를\) 불러오지 못했어요/)).toBeVisible()
  })
})

