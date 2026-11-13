import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

export type DataDeletionScope = 'member' | 'workspace' | 'provider'
export type DataDeletionProvider = 'instagram' | 'threads'
export type DataDeletionStatus = 'pending' | 'in_progress' | 'completed' | 'rejected'

export type DataDeletionRequestStatus = Readonly<{
  status: DataDeletionStatus
  origin: 'authenticated' | 'meta'
  scope: DataDeletionScope
  provider: DataDeletionProvider | null
  requestedAt: string
  updatedAt: string
  completedAt: string | null
}>

type Gateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

const uuidSchema = z.string().uuid()
const confirmationCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{24,128}$/u)
const statusRowSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'rejected']),
  request_origin: z.enum(['authenticated', 'meta']),
  scope: z.enum(['member', 'workspace', 'provider']),
  provider: z.enum(['instagram', 'threads']).nullable(),
  requested_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

async function productionGateway(): Promise<Gateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as Gateway
}

export function hashDataDeletionConfirmationCode(value: string) {
  return createHash('sha256').update(confirmationCodeSchema.parse(value)).digest('hex')
}

function generateConfirmationCode() {
  return randomBytes(24).toString('base64url')
}

export async function createWorkspaceDataDeletionRequest(
  input: Readonly<{
    workspaceId: string
    actorUserId: string
    scope: Exclude<DataDeletionScope, 'provider'>
  }>,
  providedGateway?: Gateway,
  codeGenerator: () => string = generateConfirmationCode,
) {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const actorUserId = uuidSchema.parse(input.actorUserId)
  const scope = z.enum(['member', 'workspace']).parse(input.scope)
  const confirmationCode = confirmationCodeSchema.parse(codeGenerator())
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('create_data_deletion_request', {
    p_workspace_id: workspaceId,
    p_actor_user_id: actorUserId,
    p_scope: scope,
    p_confirmation_code_sha256: hashDataDeletionConfirmationCode(confirmationCode),
  })
  const requestId = uuidSchema.safeParse(result.data)
  if (result.error || !requestId.success) throw new Error('DATA_DELETION_REQUEST_CREATE_FAILED')
  return Object.freeze({ requestId: requestId.data, confirmationCode })
}

export async function createMetaDataDeletionRequest(
  input: Readonly<{
    provider: DataDeletionProvider
    externalAccountId: string
    confirmationCode: string
  }>,
  providedGateway?: Gateway,
) {
  const provider = z.enum(['instagram', 'threads']).parse(input.provider)
  const externalAccountId = z.string().min(1).max(255).parse(input.externalAccountId)
  const confirmationCode = confirmationCodeSchema.parse(input.confirmationCode)
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('request_meta_data_deletion', {
    p_provider: provider,
    p_external_account_id: externalAccountId,
    p_confirmation_code_sha256: hashDataDeletionConfirmationCode(confirmationCode),
  })
  const requestId = uuidSchema.safeParse(result.data)
  if (result.error || !requestId.success) throw new Error('META_DATA_DELETION_REQUEST_CREATE_FAILED')
  return Object.freeze({ requestId: requestId.data })
}

export async function getDataDeletionRequestStatus(
  input: Readonly<{
    confirmationCode: string
    provider?: DataDeletionProvider
  }>,
  providedGateway?: Gateway,
): Promise<DataDeletionRequestStatus | null> {
  const confirmationCode = confirmationCodeSchema.safeParse(input.confirmationCode)
  const provider = input.provider === undefined
    ? undefined
    : z.enum(['instagram', 'threads']).safeParse(input.provider)
  if (!confirmationCode.success || (provider && !provider.success)) return null

  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('get_data_deletion_request_status', {
    p_confirmation_code_sha256: hashDataDeletionConfirmationCode(confirmationCode.data),
  })
  const rows = z.array(statusRowSchema).max(1).safeParse(result.data)
  if (result.error || !rows.success) throw new Error('DATA_DELETION_STATUS_UNAVAILABLE')
  const row = rows.data[0]
  if (!row || (provider?.success && row.provider !== provider.data)) return null
  return Object.freeze({
    status: row.status,
    origin: row.request_origin,
    scope: row.scope,
    provider: row.provider,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  })
}
