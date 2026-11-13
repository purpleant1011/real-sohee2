import type { ExternalFailureCode } from './types'

/**
 * Program D depends on this narrow port instead of a Program B implementation.
 * The caller owns the ledger transaction and must make releases idempotent.
 */
export interface ExternalActionCreditPort {
  releaseExternalActionCredit(input: Readonly<{
    workspaceId: string
    approvalFingerprint: string
    reason: Extract<ExternalFailureCode, 'BROKER_UNAVAILABLE'>
  }>): Promise<void>
}
