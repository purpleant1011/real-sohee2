import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'

const WORKSPACE_ID = 'cccccccc-3333-4333-8333-333333333333'
const CONTENT_VERSION_ID = 'dddddddd-4444-4444-8444-444444444444'
const VALID_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

let mockDb: Record<string, any[]> = {}
let mockKillSwitchBlocked = false

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
                single: vi.fn(async () => {
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
              single: vi.fn(async () => {
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
            single: vi.fn(async () => {
              const row = mockDb[tableName]?.find(r => r[col1] === val1)
              return { data: row || null, error: null }
            }),
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
      }
    }),
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({
    blocked: mockKillSwitchBlocked,
    reason: mockKillSwitchBlocked ? '긴급 킬스위치 가동 중' : null,
  })),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async (_wsId: string, channel: string) => ({
    accessToken: `MOCK_ACCESS_TOKEN_${channel}`,
    externalAccountId: `meta_acc_${channel}_9999`,
  })),
}))

describe('Wave 4: Webhook·Capability·Consent & Execution Admission Gate (ANI-1021, ANI-1022, ANI-1025)', () => {
  beforeEach(() => {
    vi.stubEnv('META_DATA_DELETION_CALLBACK_ENABLED', 'true')
    vi.stubEnv('META_APP_MODE', 'development')
    vi.stubEnv('META_APP_REVIEW_STATUS', 'unsubmitted')
    vi.stubEnv('META_ACCESS_TIER', 'standard')
    mockKillSwitchBlocked = false
    mockDb = {
      channel_connections: [],
      channel_capabilities: [],
      channel_consents: [],
      approvals: [],
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
      proof_chains: [],
      evidence_ledger: [],
    }
    vi.clearAllMocks()
  })

  afterEach(() => vi.unstubAllEnvs())

  describe('1. Execution Admission Gate - Single Point Fail-Closed Evaluation (ANI-1022)', () => {
    it('blocks execution when kill switch is engaged', async () => {
      mockKillSwitchBlocked = true

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('KILL_SWITCH_ENGAGED')
      expect(result.dimensions.connected).toBe(false)
    })

    it('blocks execution when channel connection does not exist or is disconnected', async () => {
      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('CHANNEL_NOT_CONNECTED')
      expect(result.dimensions.connected).toBe(false)
    })

    it('blocks autonomous execution for public customers when Meta app is TEST_ROLE_ONLY (ANI-1025)', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'healthy',
        last_webhook_at: new Date().toISOString(),
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        isAutonomousExecution: true,
        isPublicCustomer: true,
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('TEST_ROLE_ONLY_PUBLIC_DENIED')
      expect(result.dimensions.connected).toBe(true)
      expect(result.dimensions.authorized).toBe(false)
    })

    it('blocks autonomous execution when webhook is unproven (ANI-1021)', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'pending',
        last_webhook_at: null, // Zero evidence
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        isAutonomousExecution: true,
        isPublicCustomer: false, // internal tester
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('WEBHOOK_UNPROVEN')
      expect(result.dimensions.listening).toBe(false)
    })

    it('blocks execution when content approval fingerprint does not match (Exact Approval Gate)', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'healthy',
        last_webhook_at: new Date().toISOString(),
      })

      mockDb.approvals.push({
        workspace_id: WORKSPACE_ID,
        version_id: CONTENT_VERSION_ID,
        fingerprint: 'wrong_hex_fingerprint_0000000000000000000000000000000000000000000000',
        status: 'approved',
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        contentVersionId: CONTENT_VERSION_ID,
        expectedFingerprint: VALID_FINGERPRINT,
        isPublicCustomer: false,
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('APPROVAL_MISMATCH')
      expect(result.dimensions.executable).toBe(false)
    })

    it('blocks autonomous execution when capability row is missing', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'healthy',
        last_webhook_at: new Date().toISOString(),
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        isAutonomousExecution: true,
        isPublicCustomer: false,
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('CAPABILITY_MISSING')
      expect(result.dimensions.proven).toBe(false)
    })

    it('blocks autonomous execution when user consent is missing or revoked', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'healthy',
        last_webhook_at: new Date().toISOString(),
      })
      mockDb.channel_capabilities.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        capability: 'feed_publish',
      })
      mockDb.channel_consents.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'REVOKED',
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        isAutonomousExecution: true,
        isPublicCustomer: false,
      })

      expect(result.admitted).toBe(false)
      expect(result.status).toBe('BLOCKED')
      expect(result.reasonCode).toBe('CONSENT_MISSING_OR_REVOKED')
      expect(result.dimensions.autonomous).toBe(false)
    })

    it('admits execution when all readiness dimensions are verified', async () => {
      mockDb.channel_connections.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'connected',
        webhook_status: 'healthy',
        last_webhook_at: new Date().toISOString(),
      })
      mockDb.channel_capabilities.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        capability: 'feed_publish',
      })
      mockDb.channel_consents.push({
        workspace_id: WORKSPACE_ID,
        channel: 'instagram',
        status: 'ACTIVE',
      })
      mockDb.approvals.push({
        workspace_id: WORKSPACE_ID,
        version_id: CONTENT_VERSION_ID,
        fingerprint: VALID_FINGERPRINT,
        status: 'approved',
      })

      const result = await ExecutionAdmissionGate.evaluate({
        workspaceId: WORKSPACE_ID,
        channel: 'instagram',
        actionKind: 'feed_publish',
        contentVersionId: CONTENT_VERSION_ID,
        expectedFingerprint: VALID_FINGERPRINT,
        isAutonomousExecution: true,
        isPublicCustomer: false,
      })

      expect(result.admitted).toBe(true)
      expect(result.status).toBe('ADMITTED')
      expect(result.reasonCode).toBe('OK')
      expect(result.dimensions.connected).toBe(true)
      expect(result.dimensions.authorized).toBe(true)
      expect(result.dimensions.listening).toBe(true)
      expect(result.dimensions.executable).toBe(true)
      expect(result.dimensions.proven).toBe(true)
      expect(result.dimensions.autonomous).toBe(true)
    })
  })

  describe('2. PublishingExecutor Admission Gate Integration', () => {
    it('fails closed immediately at PublishingExecutor without making any provider calls if admission is blocked', async () => {
      // Channel connection missing in mockDb
      const publishResult = await PublishingExecutor.executePublish({
        workspaceId: WORKSPACE_ID,
        channel: 'INSTAGRAM',
        caption: '테스트 캡션입니다 ✨',
        imageUrl: 'https://images.example.com/verified-real-asset.jpg',
      })

      expect(publishResult.success).toBe(false)
      expect(publishResult.stage).toBe('FAILED')
      expect(publishResult.errorCode).toBe('CHANNEL_NOT_CONNECTED')
      expect(mockDb.external_action_requests).toHaveLength(0) // Zero provider attempts
    })
  })
})
