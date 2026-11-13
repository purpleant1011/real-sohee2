import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { documentReconsentOverviewSchema, type DocumentReconsentErrorCode, type DocumentReconsentOverview } from './document-reconsent-schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
export type OperatorDocumentReconsentGateway = Readonly<{
  rpc(name: 'list_operator_document_reconsent_targets', args: Readonly<{ p_document_type: string; p_workspace_id: string | null; p_limit: number }>): Promise<RpcResult>
}>
type Dependencies = Readonly<{ gateway: OperatorDocumentReconsentGateway }>
type Result = Readonly<{ data: DocumentReconsentOverview | null; error: DocumentReconsentErrorCode | null }>

const inputSchema = z.object({ documentType: z.enum(['service_agreement', 'privacy_consent', 'publishing_delegation']), workspaceId: z.string().uuid().nullable(), limit: z.number().int().min(1).max(500) }).strict()
const safeErrors = new Set<DocumentReconsentErrorCode>(['DOCUMENT_INPUT_INVALID', 'DOCUMENT_READ_UNAVAILABLE', 'OPERATOR_UNAUTHENTICATED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'OPERATOR_PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED'])

function safeError(error: unknown): DocumentReconsentErrorCode {
  const value = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return safeErrors.has(value as DocumentReconsentErrorCode) ? value as DocumentReconsentErrorCode : 'DOCUMENT_READ_UNAVAILABLE'
}

async function productionGateway(): Promise<OperatorDocumentReconsentGateway> {
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as Promise<RpcResult> }
}

export async function listOperatorDocumentReconsentTargets(
  documentType: 'service_agreement' | 'privacy_consent' | 'publishing_delegation',
  workspaceId?: string,
  dependencies?: Dependencies,
): Promise<Result> {
  const parsed = inputSchema.safeParse({ documentType, workspaceId: workspaceId ?? null, limit: 100 })
  if (!parsed.success) return { data: null, error: 'DOCUMENT_INPUT_INVALID' }
  let result: RpcResult
  try {
    result = await (dependencies?.gateway ?? await productionGateway()).rpc('list_operator_document_reconsent_targets', { p_document_type: parsed.data.documentType, p_workspace_id: parsed.data.workspaceId, p_limit: parsed.data.limit })
  } catch (error) {
    return { data: null, error: safeError(error) }
  }
  if (result.error) return { data: null, error: safeError(result.error) }
  const wire = documentReconsentOverviewSchema.safeParse(result.data)
  if (!wire.success || wire.data.document_type !== parsed.data.documentType || (parsed.data.workspaceId !== null && wire.data.items.some((item) => item.workspace_id !== parsed.data.workspaceId))) return { data: null, error: 'DOCUMENT_READ_UNAVAILABLE' }
  return { data: { documentType: wire.data.document_type, activeDocument: wire.data.active_document, state: wire.data.state, items: wire.data.items }, error: null }
}
