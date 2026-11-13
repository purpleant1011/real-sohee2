import { describe, it, expect, vi } from 'vitest'
import {
  evaluateRuntimeReadiness,
  assertRuntimeReadyForExternalWrite,
  RuntimeSchemaDriftError,
  computeSchemaContractHash,
  sanitizeRuntimeIdentity,
  type RuntimeContract,
  type RuntimeIdentity,
} from '../runtime-contract'

describe('Runtime Schema Contract & Identity Gate (ANI-989)', () => {
  const sampleContract: RuntimeContract = {
    appVersion: '1.0.0',
    expectedMigrationHead: '20260903060000',
    requiredTables: [
      'business_profiles',
      'brand_profiles',
      'conversation_jobs',
      'conversation_job_steps',
      'external_action_requests',
      'external_action_attempts',
      'external_action_receipts',
      'channel_consents',
      'provider_webhook_events',
      'channel_response_jobs',
      'channel_delivery_attempts',
    ],
    requiredColumns: {
      business_profiles: ['workspace_id', 'business_name', 'industry', 'location', 'summary'],
      brand_profiles: ['workspace_id', 'voice', 'keywords', 'prohibited_terms'],
    },
    schemaContractHash: 'hash_test_12345',
  }

  it('evaluates readiness as READY when all tables and migration head match', () => {
    const probeResult = {
      actualMigrationHead: '20260903060000',
      existingTables: sampleContract.requiredTables,
      missingTables: [],
    }

    const identity = evaluateRuntimeReadiness({
      contract: sampleContract,
      gitSha: '96fb9724f6136553cdb007f0880bff07507f2db2',
      buildTimestamp: '2026-09-07T12:00:00Z',
      environment: 'production',
      datasetMode: 'ACTUAL',
      probe: probeResult,
    })

    expect(identity.ready).toBe(true)
    expect(identity.readinessStatus).toBe('READY')
    expect(identity.missingTables).toEqual([])
    expect(identity.expectedMigrationHead).toBe('20260903060000')
    expect(identity.actualMigrationHead).toBe('20260903060000')
  })

  it('marks readiness=false with SCHEMA_DRIFT when required tables are missing', () => {
    const probeResult = {
      actualMigrationHead: '20260903060000',
      existingTables: ['business_profiles', 'brand_profiles'],
      missingTables: ['conversation_job_steps', 'provider_webhook_events'],
    }

    const identity = evaluateRuntimeReadiness({
      contract: sampleContract,
      gitSha: '96fb9724f6136553cdb007f0880bff07507f2db2',
      buildTimestamp: '2026-09-07T12:00:00Z',
      environment: 'production',
      datasetMode: 'ACTUAL',
      probe: probeResult,
    })

    expect(identity.ready).toBe(false)
    expect(identity.readinessStatus).toBe('SCHEMA_DRIFT')
    expect(identity.missingTables).toContain('conversation_job_steps')
    expect(identity.missingTables).toContain('provider_webhook_events')
  })

  it('marks readiness=false with MIGRATION_MISMATCH when migration heads do not match', () => {
    const probeResult = {
      actualMigrationHead: '20260901000000', // Older migration
      existingTables: sampleContract.requiredTables,
      missingTables: [],
    }

    const identity = evaluateRuntimeReadiness({
      contract: sampleContract,
      gitSha: '96fb9724f6136553cdb007f0880bff07507f2db2',
      buildTimestamp: '2026-09-07T12:00:00Z',
      environment: 'production',
      datasetMode: 'ACTUAL',
      probe: probeResult,
    })

    expect(identity.ready).toBe(false)
    expect(identity.readinessStatus).toBe('MIGRATION_MISMATCH')
  })

  it('assertRuntimeReadyForExternalWrite throws RuntimeSchemaDriftError when ready is false', () => {
    const notReadyIdentity: RuntimeIdentity = {
      appVersion: '1.0.0',
      gitSha: '96fb9724',
      buildTimestamp: '2026-09-07T12:00:00Z',
      environment: 'production',
      datasetMode: 'ACTUAL',
      expectedMigrationHead: '20260903060000',
      actualMigrationHead: null,
      schemaContractHash: 'hash_test',
      ready: false,
      readinessStatus: 'SCHEMA_DRIFT',
      missingTables: ['external_action_receipts'],
      checkedAt: new Date().toISOString(),
    }

    expect(() => assertRuntimeReadyForExternalWrite(notReadyIdentity)).toThrow(
      RuntimeSchemaDriftError
    )

    try {
      assertRuntimeReadyForExternalWrite(notReadyIdentity)
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeSchemaDriftError)
      const driftErr = err as RuntimeSchemaDriftError
      expect(driftErr.code).toBe('SCHEMA_DRIFT')
      expect(driftErr.message).toContain('external_action_receipts')
    }
  })

  it('sanitizeRuntimeIdentity guarantees zero secrets or tokens are exposed', () => {
    const rawDataWithSecrets = {
      appVersion: '1.0.0',
      gitSha: '96fb9724',
      buildTimestamp: '2026-09-07T12:00:00Z',
      environment: 'production' as const,
      datasetMode: 'ACTUAL' as const,
      expectedMigrationHead: '20260903060000',
      actualMigrationHead: '20260903060000',
      schemaContractHash: 'hash_123',
      ready: true,
      readinessStatus: 'READY' as const,
      missingTables: [],
      checkedAt: '2026-09-07T12:00:00Z',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_very_secret_token_123',
      OPENAI_API_KEY: 'sk-proj-test-dummy-super-secret-456',
      META_APP_SECRET: 'meta-secret-789',
    }

    const sanitized = sanitizeRuntimeIdentity(rawDataWithSecrets)
    const jsonStr = JSON.stringify(sanitized)

    expect(jsonStr).not.toContain('sb_secret')
    expect(jsonStr).not.toContain('sk-proj')
    expect(jsonStr).not.toContain('meta-secret')
    expect((sanitized as any).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect((sanitized as any).OPENAI_API_KEY).toBeUndefined()
    expect((sanitized as any).META_APP_SECRET).toBeUndefined()
    expect(sanitized.ready).toBe(true)
    expect(sanitized.readinessStatus).toBe('READY')
  })

  it('computes deterministic schema contract hash', () => {
    const hash1 = computeSchemaContractHash(sampleContract)
    const hash2 = computeSchemaContractHash({ ...sampleContract })
    expect(hash1).toBe(hash2)
    expect(typeof hash1).toBe('string')
    expect(hash1.length).toBeGreaterThan(10)
  })
})
