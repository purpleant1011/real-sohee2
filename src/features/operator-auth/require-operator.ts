import 'server-only'

import type { OperatorPermission } from './permissions'
import {
  OperatorAccessError,
  requireOperatorIdentity,
  type CurrentOperatorContext,
  type OperatorAuthGateway,
} from './current-operator'
import { workspaceIdSchema } from './schemas'

type GatewayOrWorkspace = string | OperatorAuthGateway | undefined

function splitWorkspaceAndGateway(
  workspaceIdOrGateway: GatewayOrWorkspace,
  injectedGateway: OperatorAuthGateway | undefined,
): Readonly<{ workspaceId: string | undefined; gateway: OperatorAuthGateway | undefined }> {
  if (typeof workspaceIdOrGateway === 'object' && workspaceIdOrGateway !== null) {
    return { workspaceId: undefined, gateway: workspaceIdOrGateway }
  }
  return { workspaceId: workspaceIdOrGateway, gateway: injectedGateway }
}

function permissionEntries(context: CurrentOperatorContext, permission: OperatorPermission) {
  const entries = context.permissionScopes.filter((item) => item.permission === permission)
  if (entries.length === 0) throw new OperatorAccessError('PERMISSION_DENIED')
  return entries
}

/** Requires an operator permission paired with the requested workspace scope. */
export async function requireOperator(
  permission: OperatorPermission,
  workspaceIdOrGateway?: GatewayOrWorkspace,
  injectedGateway?: OperatorAuthGateway,
): Promise<CurrentOperatorContext> {
  const { workspaceId, gateway } = splitWorkspaceAndGateway(workspaceIdOrGateway, injectedGateway)
  const context = await requireOperatorIdentity(gateway)
  const entries = permissionEntries(context, permission)

  if (workspaceId !== undefined && !workspaceIdSchema.safeParse(workspaceId).success) {
    throw new OperatorAccessError('WORKSPACE_SCOPE_DENIED')
  }

  const allowed = workspaceId === undefined
    ? entries.some((item) => item.workspaceScope === 'all')
    : entries.some((item) => item.workspaceScope === 'all'
      || (Array.isArray(item.workspaceScope) && item.workspaceScope.includes(workspaceId)))
  if (!allowed) throw new OperatorAccessError('WORKSPACE_SCOPE_DENIED')

  return context
}

/**
 * Requires a permission for read-only aggregate entry points. This deliberately
 * ignores workspace selection while preserving the permission-to-scope pairing;
 * callers must constrain every resulting aggregate to the returned scopes.
 */
export async function requireOperatorAnyScope(
  permission: OperatorPermission,
  injectedGateway?: OperatorAuthGateway,
): Promise<CurrentOperatorContext> {
  const context = await requireOperatorIdentity(injectedGateway)
  const entries = permissionEntries(context, permission)

  if (!permission.endsWith('.read')) {
    throw new OperatorAccessError('PERMISSION_DENIED')
  }

  const hasScope = entries.some((item) => item.workspaceScope === 'all'
    || (Array.isArray(item.workspaceScope) && item.workspaceScope.length > 0))
  if (!hasScope) throw new OperatorAccessError('WORKSPACE_SCOPE_DENIED')

  return context
}

export type { OperatorAuthGateway }
