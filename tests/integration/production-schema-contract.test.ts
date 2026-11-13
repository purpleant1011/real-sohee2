import { describe, it, expect } from 'vitest'
import {
  evaluateRuntimeSchemaIdentity,
  type RuntimeSchemaIdentity,
  type SchemaContractCheck,
} from '@/features/evidence/schema-fingerprint'
import {
  createEvidenceEnvelope,
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
} from '@/features/evidence/evidence-envelope'

describe('Production Schema Contract & Runtime Identity (ANI-1015, ANI-1028)', () => {
  const baseContractChecks: SchemaContractCheck[] = [
    { name: 'relation:agent_sessions', ok: true, observed: 'table' },
    { name: 'relation:conversation_threads', ok: true, observed: 'table' },
    { name: 'column:conversation_threads.model_profile', ok: true, observed: 'text' },
    { name: 'relation:external_action_requests', ok: true, observed: 'table' },
    { name: 'constraint:external_action_requests.channel:instagram,threads', ok: true, observed: 'instagram,threads,meta' },
    { name: 'constraint:external_action_requests.action_kind:feed_publish,thread_publish', ok: true, observed: 'feed_publish,thread_publish' },
  ]

  it('fails closed with SCHEMA_INCOMPATIBLE when required relations/columns/constraints fail', () => {
    const checksWithMissingSession: SchemaContractCheck[] = [
      { name: 'relation:agent_sessions', ok: false, observed: null },
      ...baseContractChecks.slice(1),
    ]

    const identity = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: '20260907060000',
      actualMigrationHead: '20260907060000',
      expectedSchemaFingerprint: 'expected_fingerprint_hash',
      actualSchemaFingerprint: 'actual_fingerprint_hash',
      contractChecks: checksWithMissingSession,
    })

    expect(identity.status).toBe('SCHEMA_INCOMPATIBLE')
    expect(identity.ready).toBe(false)
    expect(identity.requiredContracts.find(c => c.name === 'relation:agent_sessions')?.ok).toBe(false)
  })

  it('fails closed with SCHEMA_INCOMPATIBLE when Meta channel constraint excludes instagram or threads', () => {
    const checksWithLegacyChannel: SchemaContractCheck[] = [
      ...baseContractChecks.filter(c => !c.name.startsWith('constraint:external_action_requests.channel')),
      { name: 'constraint:external_action_requests.channel:instagram,threads', ok: false, observed: 'meta' },
    ]

    const identity = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: '20260907060000',
      actualMigrationHead: '20260907060000',
      expectedSchemaFingerprint: 'expected_fingerprint_hash',
      actualSchemaFingerprint: 'actual_fingerprint_hash',
      contractChecks: checksWithLegacyChannel,
    })

    expect(identity.status).toBe('SCHEMA_INCOMPATIBLE')
    expect(identity.ready).toBe(false)
  })

  it('fails closed with DEPLOYMENT_DRIFT when migration head is behind expected head', () => {
    const identity = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: '20260907060000',
      actualMigrationHead: '20260903060000', // Current production head!
      expectedSchemaFingerprint: 'hash_123',
      actualSchemaFingerprint: 'hash_123',
      contractChecks: baseContractChecks,
    })

    expect(identity.status).toBe('DEPLOYMENT_DRIFT')
    expect(identity.ready).toBe(false)
    expect(identity.actualMigrationHead).toBe('20260903060000')
    expect(identity.expectedMigrationHead).toBe('20260907060000')
  })

  it('fails closed with SCHEMA_INCOMPATIBLE when schema fingerprints diverge even if migration head matches', () => {
    const identity = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: '20260907060000',
      actualMigrationHead: '20260907060000',
      expectedSchemaFingerprint: 'hash_expected',
      actualSchemaFingerprint: 'hash_diverged',
      contractChecks: baseContractChecks,
    })

    expect(identity.status).toBe('SCHEMA_INCOMPATIBLE')
    expect(identity.ready).toBe(false)
  })

  it('evaluates to READY only when all contracts, migration head, and fingerprint match', () => {
    const identity = evaluateRuntimeSchemaIdentity({
      expectedMigrationHead: '20260907060000',
      actualMigrationHead: '20260907060000',
      expectedSchemaFingerprint: 'valid_fingerprint',
      actualSchemaFingerprint: 'valid_fingerprint',
      contractChecks: baseContractChecks,
    })

    expect(identity.status).toBe('READY')
    expect(identity.ready).toBe(true)
  })
})

describe('Evidence Identity Envelope Scope Contract (ANI-1028)', () => {
  it('creates valid EvidenceEnvelope with all required canonical identity attributes', () => {
    const envelope = createEvidenceEnvelope({
      testRunId: 'RUN_20260907_TEST',
      environment: 'production',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      actorRef: 'user-sohee-tester',
      commitSha: 'f38db21eacc4fa991977beb8e56283d5f771b4cf',
      deployId: 'cf-deploy-12345',
      actualMigrationHead: '20260907060000',
      schemaFingerprint: 'fp_abc123',
      browser: 'ego-browser 1.3.0',
    })

    const validation = validateEvidenceEnvelope(envelope)
    expect(validation.valid).toBe(true)
    expect(validation.classification).toBe('SCOPED')
  })

  it('marks evidence as UNSCOPED when workspaceId, commitSha, or schemaFingerprint is missing or invalid', () => {
    const unScopedEnvelope = createEvidenceEnvelope({
      testRunId: 'RUN_TEST_INVALID',
      environment: 'production',
      workspaceId: '', // missing
      actorRef: 'user-tester',
      commitSha: 'unknown',
      deployId: 'local',
      actualMigrationHead: '20260903060000',
      schemaFingerprint: '', // missing
    })

    const validation = validateEvidenceEnvelope(unScopedEnvelope)
    expect(validation.valid).toBe(false)
    expect(validation.classification).toBe('UNSCOPED')
    expect(validation.errors.length).toBeGreaterThan(0)
  })
})
