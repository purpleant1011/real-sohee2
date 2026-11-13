import { z } from 'zod'
import { operatorPermissions } from './permissions'

export const workspaceIdSchema = z.string().uuid()
const uuidSchema = workspaceIdSchema
const permissionSchema = z.enum(operatorPermissions)
const workspaceScopeSchema = z.union([
  z.literal('all'),
  z.array(uuidSchema).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'duplicate workspace scope' })
    }
  }),
])

const permissionScopeWireSchema = z.object({
  permission: permissionSchema,
  workspace_scope: workspaceScopeSchema,
}).strict()

export const operatorContextWireSchema = z.object({
  user_id: uuidSchema,
  status: z.enum(['invited', 'active', 'disabled']),
  permissions: z.array(permissionSchema).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'duplicate permission' })
    }
  }),
  workspace_scope: workspaceScopeSchema,
  mfa_required: z.boolean(),
  permission_scopes: z.array(permissionScopeWireSchema).superRefine((values, context) => {
    const entries = values.map((value) => JSON.stringify([
      value.permission,
      value.workspace_scope,
    ]))
    if (new Set(entries).size !== entries.length) {
      context.addIssue({ code: 'custom', message: 'duplicate permission scope' })
    }
  }),
}).strict().superRefine((value, context) => {
  const aggregate = new Set(value.permissions)
  const scoped = new Set(value.permission_scopes.map((item) => item.permission))
  if (aggregate.size !== scoped.size || [...aggregate].some((permission) => !scoped.has(permission))) {
    context.addIssue({ code: 'custom', message: 'permission aggregate mismatch' })
  }
})

const permissionScopeSchema = z.object({
  permission: permissionSchema,
  workspaceScope: workspaceScopeSchema,
}).strict()

export const currentOperatorContextSchema = z.object({
  userId: uuidSchema,
  status: z.enum(['invited', 'active', 'disabled']),
  permissions: z.array(permissionSchema),
  workspaceScope: workspaceScopeSchema,
  mfaRequired: z.boolean(),
  permissionScopes: z.array(permissionScopeSchema),
}).strict()

export type OperatorContextWire = z.infer<typeof operatorContextWireSchema>
export type CurrentOperatorContext = Readonly<{
  userId: string
  status: 'invited' | 'active' | 'disabled'
  permissions: readonly z.infer<typeof permissionSchema>[]
  workspaceScope: 'all' | readonly string[]
  mfaRequired: boolean
  permissionScopes: readonly Readonly<{
    permission: z.infer<typeof permissionSchema>
    workspaceScope: 'all' | readonly string[]
  }>[]
}>

export function normalizeOperatorContext(wire: OperatorContextWire): CurrentOperatorContext {
  return currentOperatorContextSchema.parse({
    userId: wire.user_id,
    status: wire.status,
    permissions: wire.permissions,
    workspaceScope: wire.workspace_scope,
    mfaRequired: wire.mfa_required,
    permissionScopes: wire.permission_scopes.map((item) => ({
      permission: item.permission,
      workspaceScope: item.workspace_scope,
    })),
  })
}
