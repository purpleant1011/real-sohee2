import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })), rpc: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperatorAnyScope: mocks.requireOperatorAnyScope }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({ rpc: mocks.rpc })) }))

import { listOperatorAdminSelectors } from './selector-repository'

describe('listOperatorAdminSelectors', () => {
  beforeEach(() => vi.clearAllMocks())
  it('accepts the safe selector wire used by an effective MFA grace read', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: '30000000-0000-4000-8000-000000000001', email_label: 'o***@example.com', status: 'active', version: 2, assignments: [{ assignment_id: '40000000-0000-4000-8000-000000000001', role_key: 'operations_admin', role_label: '운영 관리자', scope_label: '전체 고객사', version: 3 }] }], error: null })
    await expect(listOperatorAdminSelectors()).resolves.toMatchObject({ data: [{ emailLabel: 'o***@example.com', version: 2, assignments: [{ version: 3, roleLabel: '운영 관리자' }] }], error: null })
  })
  it('fails closed when an expired-grace read is denied by the safe RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'MFA_REQUIRED' } })
    await expect(listOperatorAdminSelectors()).resolves.toEqual({ data: null, error: '관리자 선택 자료를 불러오지 못했습니다.' })
  })
})
