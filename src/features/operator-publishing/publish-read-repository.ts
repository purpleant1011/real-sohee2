import 'server-only'

import { z } from 'zod'
import { requireOperatorAnyScope, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import { publishReadResponseSchema, normalizePublishOperation, type PublishOperation } from './publish-read-schemas'

const uuid = z.string().uuid()
const filterSchema = z.object({
  workspaceId: uuid.optional(),
  status: z.enum(['pending', 'publishing', 'success', 'failure', 'unknown']).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict()

type Gateway = Readonly<{ rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }>
type Dependencies = Readonly<{ gateway?: Gateway; operatorGateway?: OperatorAuthGateway }>
export type OperatorPublishError = 'PUBLISH_INPUT_INVALID' | 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'PERMISSION_DENIED' | 'OPERATOR_SCOPE_DENIED' | 'PUBLISH_CURSOR_INVALID' | 'PUBLISH_READ_UNAVAILABLE'
export type OperatorPublishPage = Readonly<{ items: readonly PublishOperation[]; nextCursor: string | null }>
export type OperatorPublishFilters = Readonly<z.input<typeof filterSchema>>
type Result = Readonly<{ data: OperatorPublishPage | null; error: OperatorPublishError | null }>

function encodeCursor(value: Readonly<{ created_at: string; id: string; cursor_fingerprint: string }>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string): Readonly<{ created_at: string; id: string; cursor_fingerprint: string }> {
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { throw new Error('PUBLISH_CURSOR_INVALID') }
  const result = z.object({ created_at: z.string().datetime({ offset: true }), id: uuid, cursor_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).safeParse(parsed)
  if (!result.success) throw new Error('PUBLISH_CURSOR_INVALID')
  return result.data
}

async function productionGateway(): Promise<Gateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as never }
}

function mapError(error: unknown): OperatorPublishError {
  const message = error instanceof Error ? error.message : ''
  if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED', 'PUBLISH_CURSOR_INVALID', 'PUBLISH_INPUT_INVALID'].includes(message)) return message as OperatorPublishError
  return 'PUBLISH_READ_UNAVAILABLE'
}

export async function listOperatorPublishOperations(filters: OperatorPublishFilters = {}, dependencies: Dependencies = {}): Promise<Result> {
  const parsed = filterSchema.safeParse(filters)
  if (!parsed.success) return { data: null, error: 'PUBLISH_INPUT_INVALID' }
  try {
    await requireOperatorAnyScope('publish.read', dependencies.operatorGateway)
    const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null
    const gateway = dependencies.gateway ?? await productionGateway()
    const result = await gateway.rpc('list_operator_publish_operations', {
      p_cursor_created_at: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_cursor_fingerprint: cursor?.cursor_fingerprint ?? null,
      p_workspace_id: parsed.data.workspaceId ?? null,
      p_status: parsed.data.status ?? null,
      p_limit: parsed.data.limit,
    })
    if (result.error) return { data: null, error: mapError(result.error) }
    const wire = publishReadResponseSchema.safeParse(result.data)
    if (!wire.success || wire.data.items.some((item) => parsed.data.workspaceId !== undefined && item.workspace_id !== parsed.data.workspaceId)) {
      return { data: null, error: 'PUBLISH_READ_UNAVAILABLE' }
    }
    return { data: { items: wire.data.items.map(normalizePublishOperation), nextCursor: wire.data.next_cursor ? encodeCursor(wire.data.next_cursor) : null }, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}
