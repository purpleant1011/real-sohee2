import { z } from 'zod'

export type PublishProviderMode = 'mock' | 'live'
export type PublishChannel = 'instagram' | 'threads'
export type PublishSimulation =
  | 'success'
  | 'temporary_network'
  | 'rate_limited'
  | 'token_expired'
  | 'reapproval_required'
  | 'provider_rejected'
export type MetaProviderDiagnosticCategory = 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'VALIDATION' | 'CLIENT'
export type MetaProviderDiagnosticCode = `META_C${number}_S${number}_${MetaProviderDiagnosticCategory}`
export type PublishProviderErrorCode =
  | 'TEMPORARY_NETWORK'
  | 'RATE_LIMITED'
  | 'TOKEN_EXPIRED'
  | 'APPROVAL_STALE'
  | 'RESULT_UNKNOWN'
  | 'RECONCILED_NO_POST'
  | 'PROVIDER_REJECTED'
  | MetaProviderDiagnosticCode

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const publishProviderInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    scheduleId: z.string().uuid(),
    versionId: z.string().uuid(),
    channelConnectionId: z.string().uuid(),
    channel: z.enum(['instagram', 'threads']),
    idempotencyKey: sha256HexSchema,
    contentFingerprint: sha256HexSchema,
    simulation: z.enum([
      'success',
      'temporary_network',
      'rate_limited',
      'token_expired',
      'reapproval_required',
      'provider_rejected',
    ]),
  })
  .strict()

export type PublishProviderInput = z.infer<typeof publishProviderInputSchema>

export type PublishProviderResult =
  | Readonly<{
      ok: true
      providerPostId: string
      errorCode: null
    }>
  | Readonly<{
      ok: false
      providerPostId: null
      errorCode: PublishProviderErrorCode
    }>

export interface PublishProvider {
  readonly mode: PublishProviderMode
  publish(input: PublishProviderInput): Promise<PublishProviderResult>
}
