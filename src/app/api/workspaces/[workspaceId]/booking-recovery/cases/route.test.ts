import { expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), enabled: vi.fn(() => true), writable: vi.fn(() => false), list: vi.fn(async () => []),
}))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/booking-recovery/production', () => ({
  isRecoveryEnabled: mocks.enabled, isRecoveryWriteEnabled: mocks.writable,
  createProductionBookingRecoveryService: () => ({ listCaseViews: mocks.list }),
  toSafeErrorResponse: () => ({ error: '예약 문의 상태 확인 필요' }),
}))

it.each([false, true])('reports workspace-bound open permission without creating a case: %s', async writable => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  mocks.authorize.mockResolvedValueOnce({ workspaceId, role: 'owner', userId: 'owner', admin: {} })
  mocks.writable.mockReturnValueOnce(writable)
  const response = await GET(new Request('https://example.test/cases'), { params: Promise.resolve({ workspaceId }) })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ workspaceId, cases: [], openAllowed: writable })
})
