/**
 * Runtime Contract & Schema Identity Types and Helpers (ANI-989)
 *
 * Defines the canonical contract between application code and deployed Supabase schema.
 * Enforces fail-closed readiness so that schema drift blocks external writes and side effects.
 */

import crypto from 'node:crypto'

export interface RuntimeContract {
  appVersion: string
  expectedMigrationHead: string
  requiredTables: string[]
  requiredColumns?: Record<string, string[]>
  schemaContractHash?: string
}

export type ReadinessStatus = 'READY' | 'SCHEMA_DRIFT' | 'MIGRATION_MISMATCH' | 'NOT_CHECKED'

export interface RuntimeIdentity {
  appVersion: string
  gitSha: string
  buildTimestamp: string
  environment: 'production' | 'staging' | 'development' | 'test'
  datasetMode: 'ACTUAL' | 'DEMO' | 'TEST'
  expectedMigrationHead: string
  actualMigrationHead: string | null
  schemaContractHash: string
  ready: boolean
  readinessStatus: ReadinessStatus
  missingTables: string[]
  checkedAt: string
}

export class RuntimeSchemaDriftError extends Error {
  public readonly code: 'SCHEMA_DRIFT' | 'MIGRATION_MISMATCH'
  public readonly missingTables: string[]

  constructor(
    code: 'SCHEMA_DRIFT' | 'MIGRATION_MISMATCH',
    message: string,
    missingTables: string[] = []
  ) {
    super(`[RuntimeSchemaDrift] ${message}`)
    this.name = 'RuntimeSchemaDriftError'
    this.code = code
    this.missingTables = missingTables
  }
}

/**
 * Computes a deterministic SHA-256 hash for a runtime contract.
 */
export function computeSchemaContractHash(
  contract: Omit<RuntimeContract, 'schemaContractHash'> | RuntimeContract
): string {
  const normalized = {
    appVersion: contract.appVersion,
    expectedMigrationHead: contract.expectedMigrationHead,
    requiredTables: [...contract.requiredTables].sort(),
    requiredColumns: contract.requiredColumns
      ? Object.keys(contract.requiredColumns)
          .sort()
          .reduce<Record<string, string[]>>((acc, key) => {
            acc[key] = [...(contract.requiredColumns?.[key] || [])].sort()
            return acc
          }, {})
      : {},
  }

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 32)
}

/**
 * Evaluates runtime readiness based on probe results and contract expectations.
 */
export function evaluateRuntimeReadiness(params: {
  contract: RuntimeContract
  gitSha: string
  buildTimestamp: string
  environment: 'production' | 'staging' | 'development' | 'test'
  datasetMode: 'ACTUAL' | 'DEMO' | 'TEST'
  probe: {
    actualMigrationHead: string | null
    existingTables: string[]
    missingTables: string[]
  }
}): RuntimeIdentity {
  const { contract, gitSha, buildTimestamp, environment, datasetMode, probe } = params
  const schemaContractHash = contract.schemaContractHash || computeSchemaContractHash(contract)

  let ready = true
  let readinessStatus: ReadinessStatus = 'READY'

  if (probe.missingTables && probe.missingTables.length > 0) {
    ready = false
    readinessStatus = 'SCHEMA_DRIFT'
  } else if (
    probe.actualMigrationHead &&
    contract.expectedMigrationHead &&
    probe.actualMigrationHead !== contract.expectedMigrationHead
  ) {
    ready = false
    readinessStatus = 'MIGRATION_MISMATCH'
  }

  return {
    appVersion: contract.appVersion,
    gitSha,
    buildTimestamp,
    environment,
    datasetMode,
    expectedMigrationHead: contract.expectedMigrationHead,
    actualMigrationHead: probe.actualMigrationHead,
    schemaContractHash,
    ready,
    readinessStatus,
    missingTables: probe.missingTables || [],
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Fail-closed assertion: throws RuntimeSchemaDriftError if runtime is not READY.
 * Must be checked before performing cost-bearing or external write operations.
 */
export function assertRuntimeReadyForExternalWrite(identity: RuntimeIdentity): void {
  if (!identity.ready) {
    if (identity.readinessStatus === 'SCHEMA_DRIFT') {
      throw new RuntimeSchemaDriftError(
        'SCHEMA_DRIFT',
        `Runtime schema drift detected. Missing required tables: ${identity.missingTables.join(
          ', '
        )}. External side-effects are blocked.`,
        identity.missingTables
      )
    }

    if (identity.readinessStatus === 'MIGRATION_MISMATCH') {
      throw new RuntimeSchemaDriftError(
        'MIGRATION_MISMATCH',
        `Migration head mismatch: expected "${identity.expectedMigrationHead}", but found "${identity.actualMigrationHead}". External side-effects are blocked.`
      )
    }

    throw new RuntimeSchemaDriftError(
      'SCHEMA_DRIFT',
      `Runtime is not in READY state (status: ${identity.readinessStatus}). External side-effects are blocked.`
    )
  }
}

/**
 * Strips all sensitive fields and returns only public-safe runtime identity.
 */
export function sanitizeRuntimeIdentity(raw: Record<string, any>): RuntimeIdentity {
  return {
    appVersion: String(raw.appVersion || '1.0.0'),
    gitSha: String(raw.gitSha || 'unknown'),
    buildTimestamp: String(raw.buildTimestamp || new Date().toISOString()),
    environment: (raw.environment as RuntimeIdentity['environment']) || 'production',
    datasetMode: (raw.datasetMode as RuntimeIdentity['datasetMode']) || 'ACTUAL',
    expectedMigrationHead: String(raw.expectedMigrationHead || ''),
    actualMigrationHead: raw.actualMigrationHead ? String(raw.actualMigrationHead) : null,
    schemaContractHash: String(raw.schemaContractHash || ''),
    ready: Boolean(raw.ready),
    readinessStatus: (raw.readinessStatus as ReadinessStatus) || 'NOT_CHECKED',
    missingTables: Array.isArray(raw.missingTables) ? raw.missingTables.map(String) : [],
    checkedAt: String(raw.checkedAt || new Date().toISOString()),
  }
}
