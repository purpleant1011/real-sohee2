import { describe, expect, it, vi } from 'vitest'
import {
  assertAdminAal2RouteGuard,
  handleAdminGuardError,
  ADMIN_ROUTE_SECURITY_MATRIX,
  setPrivilegedCache,
  getPrivilegedCache,
  invalidatePrivilegedSessionCache,
} from '@/features/operator-auth/admin-route-guard'
import { OperatorAccessError, type OperatorAuthGateway } from '@/features/operator-auth/current-operator'

describe('Admin AAL2 Route Consistency & Privileged Boundary (ANI-1144)', () => {
  const operatorId = '10000000-0000-4000-8000-000000000001'
  const workspaceId = '20000000-0000-4000-8000-000000000001'
  const foreignWorkspaceId = '90000000-0000-4000-8000-000000000001'

  function createMockGateway(options: {
    authenticated?: boolean
    aal?: 'aal1' | 'aal2' | null
    permissions?: string[]
    workspaceScope?: 'all' | string[]
  }): OperatorAuthGateway {
    return {
      getClaims: vi.fn(async () => {
        if (options.authenticated === false) {
          return { data: null, error: new Error('No session') }
        }
        return { data: { claims: { sub: operatorId } }, error: null }
      }),
      getAal: vi.fn(async () => {
        if (!options.aal) return { data: null, error: new Error('No AAL') }
        return { data: { currentLevel: options.aal }, error: null }
      }),
      getOperatorContext: vi.fn(async () => {
        return {
          data: {
            user_id: operatorId,
            status: 'active',
            permissions: options.permissions || ['dashboard.read'],
            workspace_scope: options.workspaceScope || 'all',
            mfa_required: true,
            permission_scopes: (options.permissions || ['dashboard.read']).map((p) => ({
              permission: p,
              workspace_scope: options.workspaceScope || 'all',
            })),
          },
          error: null,
        }
      }),
    }
  }

  it('rejects unauthenticated request with 401 AUTH_REQUIRED', async () => {
    const unauthGateway = createMockGateway({ authenticated: false })

    await expect(assertAdminAal2RouteGuard('dashboard.read', undefined, unauthGateway)).rejects.toThrow(
      OperatorAccessError,
    )

    try {
      await assertAdminAal2RouteGuard('dashboard.read', undefined, unauthGateway)
    } catch (err) {
      const res = handleAdminGuardError(err)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('AUTH_REQUIRED')
    }
  })

  it('rejects AAL1 session with 403 MFA_REQUIRED (strict AAL2 enforcement)', async () => {
    const aal1Gateway = createMockGateway({
      authenticated: true,
      aal: 'aal1', // Not AAL2!
      permissions: ['dashboard.read'],
    })

    await expect(assertAdminAal2RouteGuard('dashboard.read', undefined, aal1Gateway)).rejects.toThrow(
      OperatorAccessError,
    )

    try {
      await assertAdminAal2RouteGuard('dashboard.read', undefined, aal1Gateway)
    } catch (err) {
      const res = handleAdminGuardError(err)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('MFA_REQUIRED')
      expect(data.message).toContain('AAL2')
    }
  })

  it('rejects authorized AAL2 operator lacking specific permission with 403 PERMISSION_DENIED', async () => {
    const aal2Gateway = createMockGateway({
      authenticated: true,
      aal: 'aal2',
      permissions: ['dashboard.read'], // Lacks runtime_control.change.request
    })

    await expect(
      assertAdminAal2RouteGuard('runtime_control.change.request', undefined, aal2Gateway),
    ).rejects.toThrow(OperatorAccessError)

    try {
      await assertAdminAal2RouteGuard('runtime_control.change.request', undefined, aal2Gateway)
    } catch (err) {
      const res = handleAdminGuardError(err)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('PERMISSION_DENIED')
    }
  })

  it('rejects workspace-scoped operator accessing foreign workspace with 403 WORKSPACE_SCOPE_DENIED', async () => {
    const aal2Gateway = createMockGateway({
      authenticated: true,
      aal: 'aal2',
      permissions: ['credit.adjust.request'],
      workspaceScope: [workspaceId], // Only workspaceId allowed
    })

    await expect(
      assertAdminAal2RouteGuard('credit.adjust.request', foreignWorkspaceId, aal2Gateway),
    ).rejects.toThrow(OperatorAccessError)

    try {
      await assertAdminAal2RouteGuard('credit.adjust.request', foreignWorkspaceId, aal2Gateway)
    } catch (err) {
      const res = handleAdminGuardError(err)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('WORKSPACE_SCOPE_DENIED')
    }
  })

  it('allows authorized AAL2 operator with valid permission and scope', async () => {
    const aal2Gateway = createMockGateway({
      authenticated: true,
      aal: 'aal2',
      permissions: ['credit.adjust.request', 'dashboard.read'],
      workspaceScope: 'all',
    })

    const ctx = await assertAdminAal2RouteGuard('credit.adjust.request', workspaceId, aal2Gateway)
    expect(ctx.userId).toBe(operatorId)
    expect(ctx.permissions).toContain('credit.adjust.request')
  })

  it('routes non-.read write permissions to requireOperator even when workspaceId is undefined', async () => {
    const aal2Gateway = createMockGateway({
      authenticated: true,
      aal: 'aal2',
      permissions: ['publish.reconcile.request'],
      workspaceScope: 'all',
    })

    const ctx = await assertAdminAal2RouteGuard('publish.reconcile.request', undefined, aal2Gateway)
    expect(ctx.userId).toBe(operatorId)
    expect(ctx.permissions).toContain('publish.reconcile.request')
  })

  it('verifies complete 16 admin API routes in ADMIN_ROUTE_SECURITY_MATRIX with zero unmapped endpoints', () => {
    expect(ADMIN_ROUTE_SECURITY_MATRIX.length).toBe(16)

    const expectedEndpoints = [
      '/api/admin/system/fleet-snapshot',
      '/api/admin/runtime/snapshot',
      '/api/admin/system/kill-switches',
      '/api/admin/system/wing-stack',
      '/api/admin/governance/approvals',
      '/api/admin/channels/reconcile',
      '/api/admin/credits/bulk-grant/preview',
      '/api/admin/credits/bulk-grant',
      '/api/admin/privacy/requests',
      '/api/admin/agents/eval',
      '/api/admin/safety/risk-reviews',
      '/api/admin/refine/workspaces',
      '/api/admin/refine/workspaces/[workspaceId]',
      '/api/admin/workspaces/[workspaceId]/adjust-credits',
      '/api/admin/workspaces/[workspaceId]/verify-business',
      '/api/admin/engagement/killswitch',
    ]

    for (const ep of expectedEndpoints) {
      const found = ADMIN_ROUTE_SECURITY_MATRIX.find((entry) => entry.route === ep)
      expect(found).toBeDefined()
      expect(found?.aalLevel).toBe('aal2')
      expect(found?.permission).toBeDefined()
    }
  })

  it('invalidates privileged cache on session downgrade or workspace switch', () => {
    const cacheKey1 = `priv:${operatorId}:${workspaceId}:truth`
    const cacheKey2 = `priv:${operatorId}:${foreignWorkspaceId}:truth`

    setPrivilegedCache(cacheKey1, { sensitive: 'data1' })
    setPrivilegedCache(cacheKey2, { sensitive: 'data2' })

    expect(getPrivilegedCache(cacheKey1)).toEqual({ sensitive: 'data1' })
    expect(getPrivilegedCache(cacheKey2)).toEqual({ sensitive: 'data2' })

    // Invalidate workspaceId cache
    const count = invalidatePrivilegedSessionCache(undefined, workspaceId)
    expect(count).toBe(1)
    expect(getPrivilegedCache(cacheKey1)).toBeNull()
    expect(getPrivilegedCache(cacheKey2)).toEqual({ sensitive: 'data2' })

    // Invalidate all operator caches on logout
    invalidatePrivilegedSessionCache(operatorId)
    expect(getPrivilegedCache(cacheKey2)).toBeNull()
  })
})
