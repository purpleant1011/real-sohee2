import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import type { OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import {
  adminApprovalRequestWireSchema,
  auditEventWireSchema,
  effectiveApprovalStatus,
} from './schemas'
import {
  readOperatorApprovalRequests,
  readOperatorAuditEvents,
  type OperatorAuditReadGateway,
} from './repository'

const userId = '93000000-0000-4000-8000-000000000001'
const workspaceId = '93000000-0000-4000-8000-000000000101'
const foreignWorkspaceId = '93000000-0000-4000-8000-000000000102'
const approvalId = '93000000-0000-4000-8000-000000000201'

function operatorGateway(
  scope: 'all' | readonly string[] = [workspaceId],
  options: Readonly<{ status?: 'invited' | 'active' | 'disabled'; aal?: string; permissions?: readonly string[] }> = {},
): OperatorAuthGateway {
  const permissions = options.permissions ?? ['audit.read']
  return {
    getClaims: vi.fn(async () => ({ data: { claims: { sub: userId } }, error: null })),
    getAal: vi.fn(async () => ({ data: { currentLevel: options.aal ?? 'aal2', nextLevel: 'aal2' }, error: null })),
    getOperatorContext: vi.fn(async () => ({
      data: {
        user_id: userId,
        status: options.status ?? 'active',
        permissions,
        workspace_scope: scope,
        mfa_required: true,
        permission_scopes: permissions.map((permission) => ({ permission, workspace_scope: scope })),
      },
      error: null,
    })),
  }
}

const auditWire = {
  id: '93000000-0000-4000-8000-000000000301',
  actor_user_id: userId,
  workspace_id: workspaceId,
  action: 'agreement.verify.requested',
  target_type: 'agreement',
  target_id: '93000000-0000-4000-8000-000000000401',
  reason: '계약 확인',
  request_id: approvalId,
  result: 'succeeded',
  fact_kind: 'observed',
  before: {},
  after: { status: 'pending', token: 'must-not-leak' },
  idempotency_key: 'a'.repeat(64),
  approval_request_id: approvalId,
  actor_role_snapshot: { roles: ['operations_admin'] },
  created_at: '2026-08-23T00:00:00.000Z',
}

const approvalWire = {
  id: approvalId,
  workspace_id: workspaceId,
  action_type: 'agreement.verify',
  target_type: 'agreement',
  target_id: '93000000-0000-4000-8000-000000000401',
  reason: '계약 확인',
  requested_by: userId,
  approved_by: null,
  status: 'pending',
  expected_version: 1,
  request_payload: {},
  result_summary: {},
  semantic_fingerprint: 'b'.repeat(64),
  idempotency_key: 'a'.repeat(64),
  requested_at: '2026-08-23T00:00:00.000Z',
  expires_at: '2026-08-24T00:00:00.000Z',
  approved_at: null,
  applied_at: null,
  rejected_at: null,
  cancelled_at: null,
} as const

function readGateway(overrides: Partial<OperatorAuditReadGateway> = {}): OperatorAuditReadGateway {
  return {
    listAuditEvents: vi.fn(async () => ({ data: [auditWire], error: null })),
    listApprovalRequests: vi.fn(async () => ({ data: [approvalWire], error: null })),
    ...overrides,
  }
}

describe('operator audit schemas', () => {
  it('accepts strict snake_case wire rows and rejects foreign fields', () => {
    expect(auditEventWireSchema.safeParse(auditWire).success).toBe(true)
    expect(auditEventWireSchema.safeParse({ ...auditWire, raw_error: 'leak' }).success).toBe(false)
    expect(adminApprovalRequestWireSchema.safeParse(approvalWire).success).toBe(true)
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, provider_body: 'leak' }).success).toBe(false)
  })

  it('accepts only the eight actions and their requested or approved audit events', () => {
    const actions = [
      'agreement.verify',
      'channel.disconnect',
      'publish.retry',
      'credit.adjust',
      'admin.role.change.workspace',
      'admin.role.change.global',
      'audit.export.workspace',
      'audit.export.global',
    ]
    for (const action of actions) {
      expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, action_type: action }).success).toBe(true)
      expect(auditEventWireSchema.safeParse({ ...auditWire, action: `${action}.requested` }).success).toBe(true)
      expect(auditEventWireSchema.safeParse({ ...auditWire, action: `${action}.approved` }).success).toBe(true)
    }

    for (const action of ['unknown.action', 'apply_admin_approval', 'agreement.verify.applied']) {
      expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, action_type: action }).success).toBe(false)
      expect(auditEventWireSchema.safeParse({ ...auditWire, action }).success).toBe(false)
    }
  })

  it('rejects non-Task-3 stored transitions, result summaries, and broken 24 hour invariants', () => {
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, status: 'applied' }).success).toBe(false)
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, result_summary: { provider_id: 'raw' } }).success).toBe(false)
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, applied_at: '2026-08-23T01:00:00.000Z' }).success).toBe(false)
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, expires_at: '2026-08-24T00:00:00.001Z' }).success).toBe(false)
    expect(adminApprovalRequestWireSchema.safeParse({ ...approvalWire, expires_at: '2026-08-22T00:00:00.000Z' }).success).toBe(false)
  })

  it('computes expiry at the exact boundary without changing stored status', () => {
    expect(effectiveApprovalStatus(approvalWire, new Date('2026-08-23T23:59:59.999Z'))).toBe('pending')
    expect(effectiveApprovalStatus(approvalWire, new Date('2026-08-24T00:00:00.000Z'))).toBe('expired')
    expect(approvalWire.status).toBe('pending')
  })
})

describe('operator audit repository', () => {
  it('normalizes safe audit rows, redacts defense-in-depth values, and constrains scoped aggregate reads', async () => {
    const gateway = readGateway()
    const result = await readOperatorAuditEvents(
      { limit: 20 },
      { gateway, operatorGateway: operatorGateway() },
    )

    expect(gateway.listAuditEvents).toHaveBeenCalledWith({ limit: 20, workspaceIds: [workspaceId] })
    expect(result).toEqual({
      data: [{
        id: auditWire.id,
        actorUserId: userId,
        workspaceId,
        action: auditWire.action,
        targetType: 'agreement',
        targetId: auditWire.target_id,
        reason: '계약 확인',
        requestId: approvalId,
        result: 'succeeded',
        factKind: 'observed',
        before: {},
        after: { status: 'pending', token: '[REDACTED]' },
        idempotencyKey: 'a'.repeat(64),
        approvalRequestId: approvalId,
        actorRoleSnapshot: { roles: ['operations_admin'] },
        createdAt: '2026-08-23T00:00:00.000Z',
      }],
      error: null,
    })
  })

  it('rechecks an explicit workspace and rejects a malicious foreign row', async () => {
    const gateway = readGateway({
      listAuditEvents: vi.fn(async () => ({
        data: [{ ...auditWire, workspace_id: foreignWorkspaceId }],
        error: null,
      })),
    })

    await expect(readOperatorAuditEvents(
      { workspaceId, limit: 10 },
      { gateway, operatorGateway: operatorGateway() },
    )).resolves.toEqual({ data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' })
  })

  it('returns effective approval status and never exposes raw gateway errors', async () => {
    const result = await readOperatorApprovalRequests(
      { workspaceId, limit: 10, now: new Date('2026-08-24T00:00:00.000Z') },
      { gateway: readGateway(), operatorGateway: operatorGateway('all') },
    )
    expect(result.data?.[0]).toMatchObject({ status: 'pending', effectiveStatus: 'expired' })

    const raw = new Error('provider token sql detail')
    await expect(readOperatorApprovalRequests(
      { workspaceId, limit: 10 },
      { gateway: readGateway({ listApprovalRequests: vi.fn(async () => ({ data: null, error: raw })) }), operatorGateway: operatorGateway('all') },
    )).resolves.toEqual({ data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' })
  })

  it.each([
    ['MFA_REQUIRED', operatorGateway([workspaceId], { aal: 'aal1' })],
    ['OPERATOR_DISABLED', operatorGateway([workspaceId], { status: 'disabled' })],
    ['PERMISSION_DENIED', operatorGateway([workspaceId], { permissions: ['dashboard.read'] })],
    ['WORKSPACE_SCOPE_DENIED', operatorGateway([])],
  ] as const)('stops at the %s guard before calling the read gateway', async (error, authGateway) => {
    const listAuditEvents = vi.fn(async () => ({ data: [auditWire], error: null }))
    const gateway = readGateway({ listAuditEvents })

    await expect(readOperatorAuditEvents(
      { limit: 10 },
      { gateway, operatorGateway: authGateway },
    )).resolves.toEqual({ data: null, error })
    expect(listAuditEvents).not.toHaveBeenCalled()
  })

  it('rejects an explicit out-of-scope workspace before calling the read gateway', async () => {
    const listAuditEvents = vi.fn(async () => ({ data: [auditWire], error: null }))

    await expect(readOperatorAuditEvents(
      { workspaceId: foreignWorkspaceId, limit: 10 },
      { gateway: readGateway({ listAuditEvents }), operatorGateway: operatorGateway([workspaceId]) },
    )).resolves.toEqual({ data: null, error: 'WORKSPACE_SCOPE_DENIED' })
    expect(listAuditEvents).not.toHaveBeenCalled()
  })
})
