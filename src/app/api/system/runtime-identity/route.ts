import { NextResponse } from 'next/server'
import { resolveRuntimeIdentity, CANONICAL_RUNTIME_CONTRACT } from '@/lib/runtime/runtime-identity'
import {
  evaluateRuntimeSchemaIdentity,
  computeDeterministicSchemaFingerprint,
  type SchemaContractCheck,
} from '@/features/evidence/schema-fingerprint'

export const dynamic = 'force-dynamic'

export async function GET(req?: Request) {
  try {
    const probeRemote = req ? new URL(req.url).searchParams.get('probe') !== 'false' : true

    const identity = await resolveRuntimeIdentity({ probeRemote })
    const missingTablesSet = new Set(identity.missingTables || [])

    // Compute canonical schema contract checks
    const contractChecks: SchemaContractCheck[] = CANONICAL_RUNTIME_CONTRACT.requiredTables.map((table: string) => ({
      name: `relation:${table}`,
      ok: !missingTablesSet.has(table),
      observed: missingTablesSet.has(table) ? null : 'table',
    }))

    const expectedFingerprint = computeDeterministicSchemaFingerprint({
      migrationHead: CANONICAL_RUNTIME_CONTRACT.expectedMigrationHead,
      contractChecks: CANONICAL_RUNTIME_CONTRACT.requiredTables.map((table: string) => ({
        name: `relation:${table}`,
        ok: true,
        observed: 'table',
      })),
    })

    const actualFingerprint = identity.actualMigrationHead
      ? computeDeterministicSchemaFingerprint({
          migrationHead: identity.actualMigrationHead,
          contractChecks,
        })
      : null

    const schemaEvaluation = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: CANONICAL_RUNTIME_CONTRACT.expectedMigrationHead,
      actualMigrationHead: identity.actualMigrationHead,
      expectedSchemaFingerprint: expectedFingerprint,
      actualSchemaFingerprint: actualFingerprint,
      contractChecks,
    })

    const enrichedIdentity = {
      ...identity,
      schemaFingerprint: actualFingerprint,
      schemaEvaluation: {
        status: schemaEvaluation.status,
        ready: schemaEvaluation.ready,
        expectedMigrationHead: schemaEvaluation.expectedMigrationHead,
        actualMigrationHead: schemaEvaluation.actualMigrationHead,
        checkedAt: schemaEvaluation.checkedAt,
      },
    }

    return NextResponse.json(enrichedIdentity, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'FAILED_TO_RESOLVE_IDENTITY',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
