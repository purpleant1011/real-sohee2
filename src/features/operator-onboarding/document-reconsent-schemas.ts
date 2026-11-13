import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const documentType = z.enum(['service_agreement', 'privacy_consent', 'publishing_delegation'])
const reason = z.enum(['missing_acceptance', 'document_version_outdated', 'withdrawn', 'expired'])

export const documentReconsentOverviewSchema = z.object({
  document_type: documentType,
  active_document: z.object({ id: uuid, version: z.string().min(1).max(80), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), review_status: z.literal('approved'), effective_at: timestamp, expires_at: timestamp.nullable() }).strict().nullable(),
  state: z.enum(['fresh', 'empty', 'unknown', 'error']),
  items: z.array(z.object({
    workspace_id: uuid,
    workspace_name: z.string().min(1).max(200),
    document_type: documentType,
    channel: z.string().min(1).max(80).nullable(),
    active_version: z.string().min(1).max(80),
    active_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    prior_accepted_at: timestamp.nullable(),
    reason,
  }).strict()),
}).strict()

export type DocumentReconsentOverviewWire = z.infer<typeof documentReconsentOverviewSchema>
export type DocumentReconsentOverview = Readonly<{
  documentType: DocumentReconsentOverviewWire['document_type']
  activeDocument: DocumentReconsentOverviewWire['active_document']
  state: DocumentReconsentOverviewWire['state']
  items: readonly DocumentReconsentOverviewWire['items'][number][]
}>
export type DocumentReconsentErrorCode = 'DOCUMENT_INPUT_INVALID' | 'DOCUMENT_READ_UNAVAILABLE' | 'OPERATOR_UNAUTHENTICATED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'OPERATOR_PERMISSION_DENIED' | 'OPERATOR_SCOPE_DENIED'
