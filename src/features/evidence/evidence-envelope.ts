/**
 * Evidence Identity Envelope Contract (ANI-1028)
 *
 * Binds every execution, test run, or validation evidence to a concrete release,
 * workspace, actor, and schema identity. Missing attributes invalidate evidence as UNSCOPED.
 */

export type EvidenceEnvironment = 'production' | 'staging' | 'integration' | 'development' | 'test'

export interface EvidenceEnvelope {
  testRunId: string
  environment: EvidenceEnvironment
  workspaceId: string
  actorRef: string
  commitSha: string
  deployId: string
  actualMigrationHead: string
  schemaFingerprint: string
  browser?: string
  channelConnectionId?: string
  providerAccountId?: string
  appMode?: string
  startedAt: string
  endedAt?: string
}

export interface EvidenceEnvelopeValidation {
  valid: boolean
  classification: 'SCOPED' | 'UNSCOPED'
  errors: string[]
}

export function createEvidenceEnvelope(params: {
  testRunId: string
  environment?: EvidenceEnvironment
  workspaceId: string
  actorRef: string
  commitSha: string
  deployId: string
  actualMigrationHead: string
  schemaFingerprint: string
  browser?: string
  channelConnectionId?: string
  providerAccountId?: string
  appMode?: string
  startedAt?: string
  endedAt?: string
}): EvidenceEnvelope {
  return {
    testRunId: params.testRunId,
    environment: params.environment || 'production',
    workspaceId: params.workspaceId,
    actorRef: params.actorRef,
    commitSha: params.commitSha,
    deployId: params.deployId,
    actualMigrationHead: params.actualMigrationHead,
    schemaFingerprint: params.schemaFingerprint,
    browser: params.browser,
    channelConnectionId: params.channelConnectionId,
    providerAccountId: params.providerAccountId,
    appMode: params.appMode,
    startedAt: params.startedAt || new Date().toISOString(),
    endedAt: params.endedAt,
  }
}

export function validateEvidenceEnvelope(envelope: EvidenceEnvelope): EvidenceEnvelopeValidation {
  const errors: string[] = []

  if (!envelope.testRunId || envelope.testRunId.trim() === '') {
    errors.push('Missing required testRunId')
  }

  if (!envelope.workspaceId || envelope.workspaceId.trim() === '') {
    errors.push('Missing required canonical workspaceId')
  }

  if (!envelope.actorRef || envelope.actorRef.trim() === '') {
    errors.push('Missing required actorRef')
  }

  if (!envelope.commitSha || envelope.commitSha === 'unknown' || envelope.commitSha.trim() === '') {
    errors.push('Invalid or missing commitSha (must not be unknown)')
  }

  if (!envelope.deployId || envelope.deployId.trim() === '') {
    errors.push('Missing required deployId')
  }

  if (!envelope.actualMigrationHead || envelope.actualMigrationHead.trim() === '') {
    errors.push('Missing required actualMigrationHead')
  }

  if (!envelope.schemaFingerprint || envelope.schemaFingerprint.trim() === '') {
    errors.push('Missing required schemaFingerprint')
  }

  const valid = errors.length === 0
  return {
    valid,
    classification: valid ? 'SCOPED' : 'UNSCOPED',
    errors,
  }
}
