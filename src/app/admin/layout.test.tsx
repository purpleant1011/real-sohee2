import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-sohee-pathname': '/admin/system?tab=health' })),
}))

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
  requireOperatorIdentity: vi.fn(),
  getCurrentOperatorSetupContext: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/operator-onboarding/setup-context', () => ({
  getCurrentOperatorSetupContext: mocks.getCurrentOperatorSetupContext,
}))
vi.mock('@/features/operator-auth/review-mode', () => ({ isReviewPassActive: vi.fn(async () => false) }))
vi.mock('../../features/operator-auth/current-operator', async () => {
  const actual = await vi.importActual<typeof import('../../features/operator-auth/current-operator')>(
    '../../features/operator-auth/current-operator',
  )
  return { ...actual, requireOperatorIdentity: mocks.requireOperatorIdentity }
})

import OperatorLayout from './layout'
import { OperatorAccessError } from '../../features/operator-auth/current-operator'

describe('OperatorLayout', () => {
  beforeEach(() => {
    mocks.requireOperatorIdentity.mockReset()
    mocks.redirect.mockClear()
    mocks.getCurrentOperatorSetupContext.mockReset()
  })

  it('redirects unauthenticated access using the safe operator next path', async () => {
    mocks.requireOperatorIdentity.mockRejectedValue(new OperatorAccessError('AUTH_REQUIRED'))

    await expect(OperatorLayout({ children: <div>console</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/admin-login?next=%2Fadmin%2Fsystem%3Ftab%3Dhealth',
    )
  })

  it('renders a generic safe denial for a customer or restricted operator', async () => {
    mocks.requireOperatorIdentity.mockRejectedValue(new OperatorAccessError('PLATFORM_ADMIN_REQUIRED'))

    const view = await OperatorLayout({ children: <div>console</div> })

    expect(view).toMatchObject({ type: expect.any(Function) })
    expect(JSON.stringify(view)).not.toContain('PLATFORM_ADMIN_REQUIRED')
  })

  it('links a verified-factor AAL1 operator to the step-up route', async () => {
    mocks.requireOperatorIdentity.mockRejectedValue(new OperatorAccessError('MFA_REQUIRED'))
    mocks.getCurrentOperatorSetupContext.mockResolvedValue({
      hasRole: true, emailConfirmed: true, status: 'active', hasVerifiedTotp: true,
    })
    const view = await OperatorLayout({ children: <div>console</div> })
    expect(view).toMatchObject({ props: { recoveryPath: '/auth/admin-verify?next=%2Fadmin%2Fsystem%3Ftab%3Dhealth' } })
  })

  it('links an unenrolled operator to setup without granting console access', async () => {
    mocks.requireOperatorIdentity.mockRejectedValue(new OperatorAccessError('MFA_REQUIRED'))
    mocks.getCurrentOperatorSetupContext.mockResolvedValue({
      hasRole: true, emailConfirmed: true, status: 'active', hasVerifiedTotp: false,
    })
    const view = await OperatorLayout({ children: <div>console</div> })
    expect(view).toMatchObject({ props: { recoveryPath: '/auth/admin-setup' } })
  })

  it('does not require a global dashboard scope at the layout boundary', async () => {
    mocks.requireOperatorIdentity.mockResolvedValue({
      userId: '10000000-0000-4000-8000-000000000001',
      permissions: ['dashboard.read'],
    })

    const view = await OperatorLayout({ children: <div>console</div> })

    expect(view.type).toEqual(expect.any(Function))
    expect(view.props.pathname).toBe('/admin/system')
    expect(view.props.permissions).toEqual(['dashboard.read'])
    expect(view.props.children).toMatchObject({ type: 'div' })
  })
})
