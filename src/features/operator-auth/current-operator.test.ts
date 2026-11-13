import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const operatorId = '10000000-0000-4000-8000-000000000001'
const workspaceA = '20000000-0000-4000-8000-000000000001'
const workspaceB = '20000000-0000-4000-8000-000000000002'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

import { getCurrentOperator, requireOperatorIdentity, requireOperator as legacyRequireOperator, type OperatorAuthGateway } from './current-operator'
import { requireOperator, requireOperatorAnyScope } from './require-operator'

function gatewayFor(input: Readonly<{
  claims?: unknown
  claimsError?: unknown
  aal?: unknown
  aalError?: unknown
  context?: unknown
  contextError?: unknown
}> = {}): OperatorAuthGateway {
  return {
    getClaims: vi.fn(async () => ({
      data: input.claims === undefined
        ? { claims: { sub: operatorId } }
        : input.claims,
      error: input.claimsError ?? null,
    })),
    getAal: vi.fn(async () => ({
      data: input.aal === undefined
        ? { currentLevel: 'aal2', nextLevel: 'aal2' }
        : input.aal,
      error: input.aalError ?? null,
    })),
    getOperatorContext: vi.fn(async () => ({
      data: Object.prototype.hasOwnProperty.call(input, 'context') ? input.context : validContext(),
      error: input.contextError ?? null,
    })),
  }
}

function validContext(overrides: Record<string, unknown> = {}) {
  return {
    user_id: operatorId,
    status: 'active',
    permissions: ['dashboard.read', 'workspace.read'],
    workspace_scope: [workspaceA],
    mfa_required: true,
    permission_scopes: [
      { permission: 'dashboard.read', workspace_scope: [workspaceA] },
      { permission: 'workspace.read', workspace_scope: [workspaceA] },
    ],
    ...overrides,
  }
}

describe('operator authentication context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(),
        mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
      },
      rpc: vi.fn(),
    })
  })

  it.each([
    { context: null },
    { contextError: new Error('database unavailable') },
  ])('denies identity when the context RPC returns null or fails: %j', async (input) => {
    const gateway = gatewayFor(input)
    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperatorIdentity(gateway)).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' })
  })

  it('ignores an obsolete or forged cookie when no user session exists', async () => {
    const gateway = gatewayFor({ claims: null, context: validContext() })
    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperatorIdentity(gateway)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(gateway.getOperatorContext).not.toHaveBeenCalled()
  })

  it('rejects an authenticated customer who is not a platform admin', async () => {
    const gateway = gatewayFor({ context: null })

    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })

  it('rejects an active admin without the required MFA assurance', async () => {
    const gateway = gatewayFor({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } })

    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    })
  })

  it('allows an active administrator whose MFA requirement is temporarily disabled', async () => {
    const gateway = gatewayFor({
      aal: { currentLevel: 'aal1', nextLevel: 'aal2' },
      context: validContext({ mfa_required: false }),
    })

    await expect(getCurrentOperator(gateway)).resolves.toMatchObject({
      userId: operatorId,
      status: 'active',
      mfaRequired: false,
    })
    expect(gateway.getAal).not.toHaveBeenCalled()
  })

  it.each([
    [{ currentLevel: 'aal1', nextLevel: 'aal1' }],
    [{ currentLevel: null, nextLevel: 'aal2' }],
    [{ currentLevel: 'unknown', nextLevel: 'aal2' }],
  ])('fails closed for a non-aal2 session: %j', async (aal) => {
    const gateway = gatewayFor({ aal })

    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    })
  })

  it('allows a permission only in its own workspace scope', async () => {
    const gateway = gatewayFor()

    await expect(requireOperator('workspace.read', workspaceA, gateway)).resolves.toMatchObject({
      userId: operatorId,
    })
    await expect(requireOperator('workspace.read', workspaceB, gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
    await expect(requireOperator('workspace.read', gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('allows one permission from separate workspace assignments in both workspaces', async () => {
    const gateway = gatewayFor({
      context: validContext({
        permissions: ['workspace.read'],
        workspace_scope: [workspaceA, workspaceB],
        permission_scopes: [
          { permission: 'workspace.read', workspace_scope: [workspaceA] },
          { permission: 'workspace.read', workspace_scope: [workspaceB] },
        ],
      }),
    })

    await expect(getCurrentOperator(gateway)).resolves.toEqual({
      userId: operatorId,
      status: 'active',
      permissions: ['workspace.read'],
      workspaceScope: [workspaceA, workspaceB],
      mfaRequired: true,
      permissionScopes: [
        { permission: 'workspace.read', workspaceScope: [workspaceA] },
        { permission: 'workspace.read', workspaceScope: [workspaceB] },
      ],
    })
    await expect(requireOperator('workspace.read', workspaceA, gateway)).resolves.toBeDefined()
    await expect(requireOperator('workspace.read', workspaceB, gateway)).resolves.toBeDefined()
    await expect(requireOperator('workspace.read', gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('rejects an exact duplicate permission scope item', async () => {
    const gateway = gatewayFor({
      context: validContext({
        permissions: ['workspace.read'],
        workspace_scope: [workspaceA],
        permission_scopes: [
          { permission: 'workspace.read', workspace_scope: [workspaceA] },
          { permission: 'workspace.read', workspace_scope: [workspaceA] },
        ],
      }),
    })

    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperator('workspace.read', workspaceA, gateway)).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })

  it('allows a scoped dashboard permission through the any-scope entry point', async () => {
    const gateway = gatewayFor()

    await expect(requireOperatorAnyScope('dashboard.read', gateway)).resolves.toMatchObject({
      userId: operatorId,
    })
    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('validates the wire contract and returns only the camel-cased operator model', async () => {
    await expect(getCurrentOperator(gatewayFor())).resolves.toEqual({
      userId: operatorId,
      status: 'active',
      permissions: ['dashboard.read', 'workspace.read'],
      workspaceScope: [workspaceA],
      mfaRequired: true,
      permissionScopes: [
        { permission: 'dashboard.read', workspaceScope: [workspaceA] },
        { permission: 'workspace.read', workspaceScope: [workspaceA] },
      ],
    })
  })

  it('rejects an any-scope dashboard permission whose paired workspace scope is empty', async () => {
    const gateway = gatewayFor({
      context: validContext({
        permissions: ['dashboard.read'],
        workspace_scope: [],
        permission_scopes: [
          { permission: 'dashboard.read', workspace_scope: [] },
        ],
      }),
    })

    await expect(requireOperatorAnyScope('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('does not turn the any-scope read entry point into approval authority', async () => {
    const gateway = gatewayFor({
      context: validContext({
        permissions: ['credit.adjust.approve'],
        workspace_scope: [workspaceA],
        permission_scopes: [
          { permission: 'credit.adjust.approve', workspace_scope: [workspaceA] },
        ],
      }),
    })

    await expect(requireOperatorAnyScope('credit.adjust.approve', gateway)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })

  it('keeps the legacy current-operator export aligned with the dedicated guard', async () => {
    await expect(legacyRequireOperator('workspace.read', workspaceA, gatewayFor())).resolves.toMatchObject({
      userId: operatorId,
    })
  })

  it('does not pair aggregate all visibility with a scoped permission', async () => {
    const gateway = gatewayFor({
      context: validContext({ workspace_scope: 'all' }),
    })

    await expect(requireOperator('workspace.read', workspaceB, gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('allows a permission entry with an explicit all scope for workspace and global calls', async () => {
    const gateway = gatewayFor({
      context: validContext({
        workspace_scope: 'all',
        permission_scopes: [
          { permission: 'dashboard.read', workspace_scope: 'all' },
          { permission: 'workspace.read', workspace_scope: 'all' },
        ],
      }),
    })

    await expect(requireOperator('workspace.read', workspaceA, gateway)).resolves.toBeDefined()
    await expect(requireOperator('workspace.read', workspaceB, gateway)).resolves.toBeDefined()
    await expect(requireOperator('workspace.read', gateway)).resolves.toBeDefined()
    await expect(requireOperatorAnyScope('dashboard.read', gateway)).resolves.toBeDefined()
  })

  it('keeps any-scope dashboard entry separate from scoped approval and global write checks', async () => {
    const gateway = gatewayFor({
      context: validContext({
        permissions: ['dashboard.read', 'credit.adjust.approve'],
        workspace_scope: [workspaceA],
        permission_scopes: [
          { permission: 'dashboard.read', workspace_scope: [workspaceA] },
          { permission: 'credit.adjust.approve', workspace_scope: [workspaceA] },
        ],
      }),
    })

    await expect(requireOperatorAnyScope('dashboard.read', gateway)).resolves.toBeDefined()
    await expect(requireOperator('credit.adjust.approve', workspaceA, gateway)).resolves.toBeDefined()
    await expect(requireOperator('credit.adjust.approve', workspaceB, gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
    await expect(requireOperator('credit.adjust.approve', gateway)).rejects.toMatchObject({
      code: 'WORKSPACE_SCOPE_DENIED',
    })
  })

  it('returns distinct safe errors for inactive and missing permissions', async () => {
    await expect(requireOperator('dashboard.read', gatewayFor({ context: validContext({ status: 'invited' }) })))
      .rejects.toMatchObject({ code: 'OPERATOR_DISABLED' })
    await expect(requireOperator('incident.manage', gatewayFor()))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('rejects a context whose actor differs from the claims subject', async () => {
    const gateway = gatewayFor({ context: validContext({ user_id: workspaceA }) })

    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })

  it.each([
    undefined,
    null,
    'active',
    1,
    [],
    {},
    validContext({ permissions: ['unknown.permission'] }),
    validContext({ permissions: ['dashboard.read', 'dashboard.read'] }),
    validContext({ workspace_scope: [workspaceA, workspaceA] }),
    validContext({ permission_scopes: [{ permission: 'dashboard.read', workspace_scope: [workspaceA] }, { permission: 'dashboard.read', workspace_scope: [workspaceA] }] }),
    validContext({ extra: 'reject' }),
  ])('rejects malformed operator context: %j', async (context) => {
    const gateway = gatewayFor({ context })

    await expect(getCurrentOperator(gateway)).resolves.toBeNull()
    await expect(requireOperator('dashboard.read', gateway)).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_REQUIRED',
    })
  })

  it('maps provider details to safe designed errors', async () => {
    const gateway = gatewayFor({ claimsError: new Error('permission denied; token=secret-value') })

    const error = await requireOperator('dashboard.read', gateway).catch((value: unknown) => value)
    expect(error).toMatchObject({
      code: 'AUTH_REQUIRED',
      message: '로그인 후 다시 시도해 주세요.',
    })
    expect(JSON.stringify(error)).not.toContain('secret-value')
    expect(JSON.stringify(error)).not.toContain('permission denied')
  })

  it('calls the exact context RPC without user-controlled arguments', async () => {
    const rpc = vi.fn(async () => ({ data: validContext(), error: null }))
    const gateway = {
      getClaims: vi.fn(async () => ({ data: { claims: { sub: operatorId } }, error: null })),
      getAal: vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null })),
      getOperatorContext: async () => rpc(),
    }

    await requireOperator('dashboard.read', workspaceA, gateway)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('uses the production adapter with the exact no-argument context RPC', async () => {
    const getClaims = vi.fn(async () => ({ data: { claims: { sub: operatorId } }, error: null }))
    const getAal = vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null }))
    const rpc = vi.fn(async () => ({ data: validContext(), error: null }))
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims, mfa: { getAuthenticatorAssuranceLevel: getAal } },
      rpc,
    })

    await expect(getCurrentOperator()).resolves.toMatchObject({ userId: operatorId })
    expect(rpc).toHaveBeenCalledWith('get_current_operator_context')
  })
})
