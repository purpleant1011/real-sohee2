import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEvidenceEnvelope, validateEvidenceEnvelope } from '@/features/evidence/evidence-envelope'
import { CanonicalInvariantMonitor } from '@/features/canonical-monitor/canonical-invariant-monitor'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { filteredTableUpdate } from '../helpers/filtered-table-update'

const WORKSPACE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const ACTOR_USER_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

let mockDb: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn((_cols?: string) => ({
          eq: vi.fn((col1: string, val1: any) => ({
            eq: vi.fn((col2: string, val2: any) => ({
              eq: vi.fn((col3: string, val3: any) => ({
                maybeSingle: vi.fn(async () => {
                  const row = mockDb[tableName]?.find(
                    r => r[col1] === val1 && r[col2] === val2 && r[col3] === val3
                  )
                  return { data: row || null, error: null }
                }),
              })),
              maybeSingle: vi.fn(async () => {
                const row = mockDb[tableName]?.find(
                  r => r[col1] === val1 && r[col2] === val2
                )
                return { data: row || null, error: null }
              }),
            })),
            maybeSingle: vi.fn(async () => {
              const row = mockDb[tableName]?.find(r => r[col1] === val1)
              return { data: row || null, error: null }
            }),
            limit: vi.fn(async () => ({ data: mockDb[tableName] || [], error: null })),
          })),
        })),
        insert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          mockDb[tableName].push(row)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null })),
            })),
            then: (resolve: any) => resolve({ data: row, error: null }),
          }
        }),
        upsert: vi.fn((record: any) => {
          const row = { id: record.id || crypto.randomUUID(), ...record }
          mockDb[tableName].push(row)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null })),
            })),
            then: (resolve: any) => resolve({ data: row, error: null }),
          }
        }),
        update: vi.fn((patch: any) => filteredTableUpdate(mockDb[tableName], patch)),
      }
    }),
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({
    blocked: false,
    reason: null,
  })),
}))

describe('Wave 6: 12-Gate Canonical Release Gate & Evidence Contract (ANI-1026)', () => {
  beforeEach(() => {
    vi.stubEnv('META_DATA_DELETION_CALLBACK_ENABLED', 'true')
    vi.stubEnv('META_APP_MODE', 'development')
    vi.stubEnv('META_APP_REVIEW_STATUS', 'unsubmitted')
    vi.stubEnv('META_ACCESS_TIER', 'standard')
    mockDb = {
      workspaces: [{ id: WORKSPACE_ID, name: '바이름 뷰티샵' }],
      content_items: [],
      content_versions: [],
      approvals: [],
      content_drafts: [],
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
      channel_connections: [
        {
          workspace_id: WORKSPACE_ID,
          channel: 'instagram',
          status: 'connected',
          webhook_status: 'healthy',
          last_webhook_at: new Date().toISOString(),
        },
      ],
      channel_capabilities: [
        {
          workspace_id: WORKSPACE_ID,
          channel: 'instagram',
          capability: 'feed_publish',
        },
      ],
      channel_consents: [
        {
          workspace_id: WORKSPACE_ID,
          channel: 'instagram',
          status: 'ACTIVE',
        },
      ],
    }
    vi.clearAllMocks()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('Gate 0 (Evidence Identity): mints verifiable EvidenceEnvelope with SHA-256 hash', async () => {
    const envelope = createEvidenceEnvelope({
      testRunId: 'test_run_release_gate_01',
      workspaceId: WORKSPACE_ID,
      actorRef: ACTOR_USER_ID,
      commitSha: '8th-canonical-truth-plane',
      deployId: 'dep_cf_workers_v09',
      actualMigrationHead: '20260907060000',
      schemaFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      browser: 'ego-browser',
    })

    expect(envelope.testRunId).toBe('test_run_release_gate_01')
    expect(envelope.workspaceId).toBe(WORKSPACE_ID)
    expect(envelope.actualMigrationHead).toBe('20260907060000')

    const validation = validateEvidenceEnvelope(envelope)
    expect(validation.valid).toBe(true)
    expect(validation.classification).toBe('SCOPED')
  })

  it('Gate 2 (DB Constraints) & Gate 5 (Canonical Content & Exact Approval): enforces 64-char hex SHA-256', async () => {
    const content = await CanonicalContentLifecycleService.createContent({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      title: '봄맞이 속눈썹 펌 이벤트',
      caption: '자연스러운 C컬 펌 시술 안내 ✨ #속눈썹펌 #소희AI',
      mediaUrls: ['https://images.example.com/lash-curl-01.jpg'],
      createdBy: ACTOR_USER_ID,
    })

    expect(content.fingerprint).toMatch(/^[a-f0-9]{64}$/)

    const approval = await CanonicalContentLifecycleService.approveContentVersion({
      workspaceId: WORKSPACE_ID,
      contentId: content.contentId,
      versionId: content.versionId,
      fingerprint: content.fingerprint,
      decidedBy: ACTOR_USER_ID,
    })

    expect(approval.status).toBe('approved')
    expect(approval.fingerprint).toBe(content.fingerprint)
  })

  it('Gate 6/7/8/9 (Admission Gate & Action Ledger): verifies fail-closed admission and durable request/attempt/receipt lifecycle', async () => {
    // 1. Admission evaluation
    const admission = await ExecutionAdmissionGate.evaluate({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      isAutonomousExecution: true,
      isPublicCustomer: false, // Internal verified operator
    })

    expect(admission.admitted).toBe(true)
    expect(admission.status).toBe('ADMITTED')

    // 2. Action request ledger
    const actionReq = await CanonicalActionLedgerService.createActionRequest({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      targetExternalId: 'meta_inst_12345',
      targetLabel: '@byreum.beauty',
      exactPayload: {
        caption: '자연스러운 C컬 펌 ✨',
        imageUrl: 'https://images.example.com/lash-curl-01.jpg',
      },
      idempotencyKey: 'release_gate_test_key_01',
    })

    expect(actionReq.status).toBe('prepared')

    // 3. Start attempt
    const attempt = await CanonicalActionLedgerService.startAttempt({
      workspaceId: WORKSPACE_ID,
      actionRequestId: actionReq.requestId,
      attemptNumber: 1,
    })

    expect(attempt.status).toBe('submitted')

    // 4. Record verified receipt
    const receipt = await CanonicalActionLedgerService.recordReceiptAndVerify({
      workspaceId: WORKSPACE_ID,
      actionRequestId: actionReq.requestId,
      attemptId: attempt.attemptId,
      providerReference: 'prov_post_17999888777666555',
      resultUrl: 'https://www.instagram.com/p/C9_RELEASE_POST/',
      observedPayload: {
        caption: '자연스러운 C컬 펌 ✨',
        imageUrl: 'https://images.example.com/lash-curl-01.jpg',
      },
    })

    expect(receipt.status).toBe('succeeded')
    expect(receipt.resultUrl).toBe('https://www.instagram.com/p/C9_RELEASE_POST/')
  })

  it('Gate 1 & Gate 10 (Canonical Invariant Monitor & Same-Truth): actively detects governance invariants', async () => {
    const monitorResult = await CanonicalInvariantMonitor.evaluateAll(WORKSPACE_ID)

    // Meta App 1568352131460103 Development mode is actively tracked
    const metaViolation = monitorResult.violations.find(v => v.invariant === 'META_TEST_ROLE_ONLY_PUBLIC_COPY')
    expect(metaViolation).toBeDefined()
    expect(metaViolation?.severity).toBe('P0')
  })

  it('Gate 12 (Failure Injection): kill switch or mismatched fingerprint blocks admission immediately', async () => {
    const admission = await ExecutionAdmissionGate.evaluate({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      contentVersionId: 'wrong-ver-id',
      expectedFingerprint: 'wrong-fingerprint-000000000000000000000000000000000000000000000000',
      isPublicCustomer: false,
    })

    expect(admission.admitted).toBe(false)
    expect(admission.status).toBe('BLOCKED')
    expect(admission.reasonCode).toBe('APPROVAL_MISMATCH')
  })
})
