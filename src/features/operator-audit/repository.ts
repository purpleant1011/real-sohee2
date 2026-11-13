import 'server-only'

import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import {
  requireOperator,
  requireOperatorAnyScope,
  type OperatorAuthGateway,
} from '@/features/operator-auth/require-operator'
import { workspaceIdSchema } from '@/features/operator-auth/schemas'
import { z } from 'zod'
import {
  adminApprovalRequestWireSchema,
  auditEventWireSchema,
  normalizeApprovalRequest,
  normalizeAuditEvent,
  type OperatorAuditErrorCode,
} from './schemas'

type ReadFilter = Readonly<{
  limit: number
  workspaceIds: 'all' | readonly string[]
}>

export type OperatorAuditReadGateway = Readonly<{
  listAuditEvents(filter: ReadFilter): Promise<{ data: unknown; error: unknown }>
  listApprovalRequests(filter: ReadFilter): Promise<{ data: unknown; error: unknown }>
}>

type Dependencies = Readonly<{
  gateway: OperatorAuditReadGateway
  operatorGateway?: OperatorAuthGateway
}>

type ReadResult<T> = Readonly<
  | { data: readonly T[]; error: null }
  | { data: null; error: OperatorAuditErrorCode }
>

const readInputSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  limit: z.number().int().min(1).max(100),
  now: z.date().optional(),
}).strict()

function accessFailure(error: unknown): OperatorAuditErrorCode {
  if (!(error instanceof OperatorAccessError)) return 'AUDIT_SOURCE_UNAVAILABLE'
  return error.code === 'PLATFORM_ADMIN_REQUIRED' ? 'OPERATOR_DISABLED' : error.code
}

async function authorizedFilter(
  workspaceId: string | undefined,
  operatorGateway: OperatorAuthGateway | undefined,
): Promise<ReadFilter['workspaceIds']> {
  if (workspaceId !== undefined) {
    await requireOperator('audit.read', workspaceId, operatorGateway)
    return [workspaceId]
  }

  const context = await requireOperatorAnyScope('audit.read', operatorGateway)
  const entries = context.permissionScopes.filter((entry) => entry.permission === 'audit.read')
  if (entries.some((entry) => entry.workspaceScope === 'all')) return 'all'
  return [...new Set(entries.flatMap((entry) => Array.isArray(entry.workspaceScope) ? entry.workspaceScope : []))]
}

function rowMatchesScope(workspaceId: string | null, filter: ReadFilter['workspaceIds']): boolean {
  return filter === 'all' || (workspaceId !== null && filter.includes(workspaceId))
}

export async function readOperatorAuditEvents(
  input: unknown,
  dependencies: Dependencies,
): Promise<ReadResult<ReturnType<typeof normalizeAuditEvent>>> {
  const parsedInput = readInputSchema.safeParse(input)
  if (!parsedInput.success) return { data: null, error: 'AUDIT_INPUT_INVALID' }

  let workspaceIds: ReadFilter['workspaceIds']
  try {
    workspaceIds = await authorizedFilter(parsedInput.data.workspaceId, dependencies.operatorGateway)
  } catch (error) {
    return { data: null, error: accessFailure(error) }
  }

  try {
    const result = await dependencies.gateway.listAuditEvents({ limit: parsedInput.data.limit, workspaceIds })
    if (result.error) return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
    const rows = z.array(auditEventWireSchema).safeParse(result.data)
    if (!rows.success || rows.data.some((row) => !rowMatchesScope(row.workspace_id, workspaceIds))) {
      return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
    }
    return { data: rows.data.map(normalizeAuditEvent), error: null }
  } catch {
    return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
  }
}

export async function readOperatorApprovalRequests(
  input: unknown,
  dependencies: Dependencies,
): Promise<ReadResult<ReturnType<typeof normalizeApprovalRequest>>> {
  const parsedInput = readInputSchema.safeParse(input)
  if (!parsedInput.success) return { data: null, error: 'AUDIT_INPUT_INVALID' }

  let workspaceIds: ReadFilter['workspaceIds']
  try {
    workspaceIds = await authorizedFilter(parsedInput.data.workspaceId, dependencies.operatorGateway)
  } catch (error) {
    return { data: null, error: accessFailure(error) }
  }

  try {
    const result = await dependencies.gateway.listApprovalRequests({ limit: parsedInput.data.limit, workspaceIds })
    if (result.error) return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
    const rows = z.array(adminApprovalRequestWireSchema).safeParse(result.data)
    if (!rows.success || rows.data.some((row) => !rowMatchesScope(row.workspace_id, workspaceIds))) {
      return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
    }
    const now = parsedInput.data.now ?? new Date()
    return { data: rows.data.map((row) => normalizeApprovalRequest(row, now)), error: null }
  } catch {
    return { data: null, error: 'AUDIT_SOURCE_UNAVAILABLE' }
  }
}
