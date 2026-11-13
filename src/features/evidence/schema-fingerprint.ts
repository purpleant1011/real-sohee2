/**
 * Deterministic Schema Fingerprint & Runtime Schema Identity Evaluation (ANI-1015, ANI-1028)
 *
 * Computes deterministic fingerprints of required relations, columns, constraints,
 * and evaluates whether runtime and database are in complete contract alignment.
 */

import crypto from 'node:crypto'

export interface SchemaContractCheck {
  name: string
  ok: boolean
  observed: string | null
}

export type RuntimeSchemaStatus = 'READY' | 'DEPLOYMENT_DRIFT' | 'SCHEMA_INCOMPATIBLE' | 'UNKNOWN'

export interface RuntimeSchemaIdentity {
  expectedMigrationHead: string
  actualMigrationHead: string | null
  expectedSchemaFingerprint: string
  actualSchemaFingerprint: string | null
  requiredContracts: SchemaContractCheck[]
  status: RuntimeSchemaStatus
  ready: boolean
  checkedAt: string
}

/**
 * Computes a deterministic SHA-256 fingerprint for contract checks and migration head.
 */
export function computeDeterministicSchemaFingerprint(params: {
  migrationHead: string
  contractChecks: SchemaContractCheck[]
}): string {
  const payload = {
    migrationHead: params.migrationHead,
    checks: [...params.contractChecks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ name: c.name, ok: c.ok, observed: c.observed })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32)
}

/**
 * Evaluates full runtime schema identity.
 * Fails closed whenever any required contract fails, migration head drifts, or fingerprint diverges.
 */
export function evaluateRuntimeSchemaIdentity(params: {
  expectedMigrationHead: string
  actualMigrationHead: string | null
  expectedSchemaFingerprint: string
  actualSchemaFingerprint: string | null
  contractChecks: SchemaContractCheck[]
}): RuntimeSchemaIdentity {
  const {
    expectedMigrationHead,
    actualMigrationHead,
    expectedSchemaFingerprint,
    actualSchemaFingerprint,
    contractChecks,
  } = params

  const allContractsOk = contractChecks.length > 0 && contractChecks.every(c => c.ok)
  const migrationMatches = Boolean(
    actualMigrationHead &&
    expectedMigrationHead &&
    actualMigrationHead === expectedMigrationHead
  )
  const fingerprintMatches = Boolean(
    actualSchemaFingerprint &&
    expectedSchemaFingerprint &&
    actualSchemaFingerprint === expectedSchemaFingerprint
  )

  let status: RuntimeSchemaStatus = 'READY'

  if (!actualMigrationHead || !actualSchemaFingerprint) {
    status = 'UNKNOWN'
  } else if (!allContractsOk) {
    status = 'SCHEMA_INCOMPATIBLE'
  } else if (!migrationMatches) {
    status = 'DEPLOYMENT_DRIFT'
  } else if (!fingerprintMatches) {
    status = 'SCHEMA_INCOMPATIBLE'
  }

  const ready = status === 'READY'

  return {
    expectedMigrationHead,
    actualMigrationHead,
    expectedSchemaFingerprint,
    actualSchemaFingerprint,
    requiredContracts: contractChecks,
    status,
    ready,
    checkedAt: new Date().toISOString(),
  }
}
