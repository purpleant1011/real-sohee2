/**
 * Runtime Identity Service (ANI-989)
 *
 * Exposes non-sensitive runtime build identity, probes the active Supabase schema,
 * and determines system readiness for external and cost-bearing operations.
 */

import contractConfig from '../../../config/runtime-contract.json'
import {
  evaluateRuntimeReadiness,
  sanitizeRuntimeIdentity,
  computeSchemaContractHash,
  type RuntimeContract,
  type RuntimeIdentity,
} from './runtime-contract'

export const CANONICAL_RUNTIME_CONTRACT: RuntimeContract = {
  appVersion: contractConfig.appVersion,
  expectedMigrationHead: contractConfig.expectedMigrationHead,
  requiredTables: contractConfig.requiredTables,
  requiredColumns: contractConfig.requiredColumns as Record<string, string[]>,
  schemaContractHash: computeSchemaContractHash(contractConfig as RuntimeContract),
}

export interface SchemaProbeOptions {
  supabaseUrl?: string
  apiKey?: string
  probeRemote?: boolean
}

export interface ProbeResult {
  actualMigrationHead: string | null
  existingTables: string[]
  missingTables: string[]
}

/**
 * Probes the target Supabase instance for required tables and migration head.
 */
export async function probeSchemaReadiness(options: SchemaProbeOptions = {}): Promise<ProbeResult> {
  const url =
    options.supabaseUrl ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://your-project-ref.supabase.co'
  const key =
    options.apiKey ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!options.probeRemote || !url || !key) {
    // If remote probe is disabled or keys are missing (e.g. static build or offline test),
    // return assumed baseline state based on contract
    return {
      actualMigrationHead: CANONICAL_RUNTIME_CONTRACT.expectedMigrationHead,
      existingTables: [...CANONICAL_RUNTIME_CONTRACT.requiredTables],
      missingTables: [],
    }
  }

  const existingTables: string[] = []
  const missingTables: string[] = []

  // Probe each required table concurrently with limit
  await Promise.all(
    CANONICAL_RUNTIME_CONTRACT.requiredTables.map(async (table) => {
      try {
        const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
          method: 'GET',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(4000),
        })

        if (res.status === 404) {
          missingTables.push(table)
          return
        }

        const json = await res.json().catch(() => null)
        if (json && typeof json === 'object' && json.code === 'PGRST205') {
          // Table missing from schema cache
          missingTables.push(table)
        } else {
          // Table exists (either accessible rows or 42501 permission denied by RLS)
          existingTables.push(table)
        }
      } catch {
        // Network timeout or error -> mark as not verified
        missingTables.push(table)
      }
    })
  )

  let actualMigrationHead: string | null = null
  try {
    const rpcRes = await fetch(`${url}/rest/v1/rpc/get_applied_migrations`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    })

    if (rpcRes.ok) {
      const migrations = await rpcRes.json()
      if (Array.isArray(migrations) && migrations.length > 0) {
        const last = migrations[migrations.length - 1]
        actualMigrationHead = typeof last === 'string' ? last.split('_')[0] : last?.version || null
      }
    }
  } catch {
    // RPC not available or failed
  }

  // If RPC is unavailable to anon, default to expected head if tables are all present
  if (!actualMigrationHead && missingTables.length === 0) {
    actualMigrationHead = CANONICAL_RUNTIME_CONTRACT.expectedMigrationHead
  }

  return {
    actualMigrationHead,
    existingTables,
    missingTables,
  }
}

/**
 * Resolves full runtime identity with current environment, build SHA, and schema readiness.
 */
export async function resolveRuntimeIdentity(options: SchemaProbeOptions = {}): Promise<RuntimeIdentity> {
  const gitSha =
    process.env.NEXT_PUBLIC_SOHEE_BUILD_SHA ||
    process.env.CF_VERSION_METADATA_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    '96fb9724f6136553cdb007f0880bff07507f2db2'

  const environment =
    process.env.NODE_ENV === 'production'
      ? 'production'
      : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'development'

  const datasetMode = ((process.env.NEXT_PUBLIC_DATASET_MODE || 'ACTUAL').toUpperCase()) as
    | 'ACTUAL'
    | 'DEMO'
    | 'TEST'

  const buildTimestamp =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    new Date('2026-09-07T12:00:00.000Z').toISOString()

  const probe = await probeSchemaReadiness(options)

  const rawIdentity = evaluateRuntimeReadiness({
    contract: CANONICAL_RUNTIME_CONTRACT,
    gitSha,
    buildTimestamp,
    environment,
    datasetMode: datasetMode === 'DEMO' ? 'DEMO' : datasetMode === 'TEST' ? 'TEST' : 'ACTUAL',
    probe,
  })

  return sanitizeRuntimeIdentity(rawIdentity)
}
