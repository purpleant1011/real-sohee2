import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'

let mockDb: Record<string, any[]> = {}

function createMockQueryBuilder(tableName: string) {
  mockDb[tableName] = mockDb[tableName] || []

  const filters: Array<{ col: string; val: any }> = []

  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: any) => {
      filters.push({ col, val })
      return builder
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      const row = mockDb[tableName]?.find(r => 
        filters.every(f => r[f.col] === f.val)
      )
      return { data: row ? { ...row } : null, error: null }
    }),
    single: vi.fn(async () => {
      const row = mockDb[tableName]?.find(r => 
        filters.every(f => r[f.col] === f.val)
      )
      return { data: row ? { ...row } : null, error: null }
    }),
    insert: vi.fn((record: any) => {
      const row = { id: record.id || crypto.randomUUID(), ...record }
      mockDb[tableName].push(row)
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { ...row }, error: null })),
        })),
        then: (resolve: any) => resolve({ data: { ...row }, error: null }),
      }
    }),
    update: vi.fn((patch: any) => ({
      eq: vi.fn((col1: string, val1: any) => ({
        eq: vi.fn((col2: string, val2: any) => {
          const row = mockDb[tableName]?.find(r => r[col1] === val1 && r[col2] === val2)
          if (row) Object.assign(row, patch)
          return Promise.resolve({ data: row ? { ...row } : null, error: null })
        }),
      })),
    })),
  }

  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => createMockQueryBuilder(tableName)),
  })),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async (_wsId: string, channel: string) => ({
    accessToken: `MOCK_TOKEN_${channel.toUpperCase()}`,
    externalAccountId: `meta_acc_${channel}_123`,
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({
    blocked: false,
    reason: null,
  })),
}))

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: vi.fn().mockResolvedValue({
      admitted: true,
      status: 'ADMITTED',
      dimensions: { killSwitch: true, connected: true, authorized: true, leaseAcquired: true },
    }),
  },
}))

const mockIgPublish = vi.fn(async () => ({
  providerPostId: 'ig_post_99999',
  destinationUrl: 'https://www.instagram.com/p/TEST_IDEM_POST/',
}))

vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: vi.fn(() => ({
    publish: mockIgPublish,
  })),
  createThreadsProvider: vi.fn(() => ({
    publish: vi.fn(),
  })),
  getPublishedMetaPostPermalink: vi.fn(async () => 'https://www.instagram.com/p/TEST_IDEM_POST/'),
}))

vi.mock('@/lib/providers/instagram-provider', () => ({
  getPostReadback: vi.fn(async (postId: string) => ({
    isLive: true,
    postId,
    permalink: 'https://www.instagram.com/p/TEST_IDEM_POST/',
    caption: 'Idempotency test caption',
    readbackRequestId: 'rb_idem_123',
    observedAt: new Date().toISOString(),
    captionDigest: 'sha256_mock_digest',
  })),
}))

describe('ANI-1045: External Action Idempotency, RESULT_UNKNOWN & Reconcile', () => {
  beforeEach(() => {
    mockDb = {
      channel_connections: [
        { workspace_id: WORKSPACE_ID, channel: 'instagram', status: 'connected', webhook_status: 'healthy', last_webhook_at: new Date().toISOString() },
      ],
      content_items: [],
      content_versions: [],
      approvals: [
        {
          id: 'app-1',
          workspace_id: WORKSPACE_ID,
          version_id: 'vvvvvvvv-1111-4111-8111-111111111111',
          fingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          status: 'approved',
        },
        {
          id: 'app-2',
          workspace_id: WORKSPACE_ID,
          version_id: 'vvvvvvvv-2222-4222-8222-222222222222',
          fingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          status: 'approved',
        },
      ],
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
      proof_chains: [],
      evidence_ledger: [],
    }
    vi.clearAllMocks()
  })

  it('detects existing request on duplicate idempotency key and prevents duplicate insert', async () => {
    const key = `test_idem_${Date.now()}`

    const req1 = await CanonicalActionLedgerService.createActionRequest({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      targetExternalId: 'acc_123',
      targetLabel: '@acc_123',
      exactPayload: { caption: '첫 번째 시도' },
      idempotencyKey: key,
    })

    expect(req1.isExisting).toBe(false)
    expect(req1.status).toBe('prepared')

    const req2 = await CanonicalActionLedgerService.createActionRequest({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      targetExternalId: 'acc_123',
      targetLabel: '@acc_123',
      exactPayload: { caption: '첫 번째 시도' },
      idempotencyKey: key,
    })

    expect(req2.requestId).toBe(req1.requestId)
    expect(req2.isExisting).toBe(true)
    expect(mockDb.external_action_requests).toHaveLength(1)
  })

  it('transitions to unknown_result when markUnknownResult is called', async () => {
    const req = await CanonicalActionLedgerService.createActionRequest({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      targetExternalId: 'acc_123',
      targetLabel: '@acc_123',
      exactPayload: { caption: '타임아웃 시도' },
    })

    const attempt = await CanonicalActionLedgerService.startAttempt({
      workspaceId: WORKSPACE_ID,
      actionRequestId: req.requestId,
      attemptNumber: 1,
    })

    await CanonicalActionLedgerService.markUnknownResult({
      workspaceId: WORKSPACE_ID,
      actionRequestId: req.requestId,
      attemptId: attempt.attemptId,
      reason: 'Gateway Timeout during Meta API publish call',
    })

    const dbReq = mockDb.external_action_requests.find(r => r.id === req.requestId)
    const dbAttempt = mockDb.external_action_attempts.find(r => r.id === attempt.attemptId)

    expect(dbReq?.status).toBe('unknown_result')
    expect(dbReq?.failure_code).toBe('UNKNOWN_RESULT')
    expect(dbAttempt?.status).toBe('unknown_result')
    expect(dbAttempt?.failure_code).toBe('UNKNOWN_RESULT')
  })

  it('reconciles unknown_result to succeeded when post is verified live in external channel', async () => {
    const req = await CanonicalActionLedgerService.createActionRequest({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      actionKind: 'feed_publish',
      targetExternalId: 'acc_123',
      targetLabel: '@acc_123',
      exactPayload: { caption: '복구 테스트' },
    })

    const attempt = await CanonicalActionLedgerService.startAttempt({
      workspaceId: WORKSPACE_ID,
      actionRequestId: req.requestId,
      attemptNumber: 1,
    })

    await CanonicalActionLedgerService.markUnknownResult({
      workspaceId: WORKSPACE_ID,
      actionRequestId: req.requestId,
      attemptId: attempt.attemptId,
      reason: 'Network disconnect',
    })

    // Reconcile via independent readback
    const outcome = await CanonicalActionLedgerService.reconcileUnknownRequest({
      workspaceId: WORKSPACE_ID,
      actionRequestId: req.requestId,
      readbackFn: async () => ({
        isLive: true,
        externalPostId: 'reconciled_post_777',
        permalink: 'https://www.instagram.com/p/RECONCILED/',
        observedPayload: { caption: '복구 테스트' },
      }),
    })

    expect(outcome.reconciled).toBe(true)
    expect(outcome.status).toBe('succeeded')
    expect(outcome.resultUrl).toBe('https://www.instagram.com/p/RECONCILED/')

    const dbReq = mockDb.external_action_requests.find(r => r.id === req.requestId)
    expect(dbReq?.status).toBe('succeeded')
    expect(mockDb.external_action_receipts).toHaveLength(1)
    expect(mockDb.external_action_receipts[0].result_url).toBe('https://www.instagram.com/p/RECONCILED/')
  })

  it('PublishingExecutor enforces idempotency: double submission results in exactly 1 provider call', async () => {
    const contentVersionId = 'vvvvvvvv-1111-4111-8111-111111111111'
    const input = {
      workspaceId: WORKSPACE_ID,
      channel: 'INSTAGRAM' as const,
      caption: '더블 클릭 방지 캡션',
      imageUrl: 'https://images.example.com/verified-real.jpg',
      contentVersionId,
      expectedFingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actorUserId: ACTOR_ID,
    }

    // First call
    const res1 = await PublishingExecutor.executePublish(input)
    expect(res1.success).toBe(true)
    expect(res1.verified).toBe(true)
    expect(res1.stage).toBe('EXTERNAL_VERIFIED')
    expect(mockIgPublish).toHaveBeenCalledTimes(1)

    // Second call with exact same versionId (simulating double click or rapid retry)
    const res2 = await PublishingExecutor.executePublish(input)
    expect(res2.success).toBe(true)
    expect(res2.verified).toBe(true)
    expect(res2.stage).toBe('EXTERNAL_VERIFIED')
    expect(res2.publishedUrl).toBe(res1.publishedUrl)
    expect(res2.receiptId).toBe(res1.receiptId)

    // Critical Invariant: Provider publish must NOT be called again!
    expect(mockIgPublish).toHaveBeenCalledTimes(1)
  })

  it.each(['revoked', 'expired', 'scope missing', 'account changed'])('rechecks %s at the agent provider boundary', async (reason) => {
    const credential = vi.mocked(loadChannelCredentialByChannel)
    credential.mockResolvedValueOnce({ accessToken: 'token', externalAccountId: 'meta_acc_instagram_123' } as any)
    if (reason === 'account changed') credential.mockResolvedValueOnce({ accessToken: 'token', externalAccountId: 'other' } as any)
    else credential.mockRejectedValueOnce(new Error(reason))
    const result = await PublishingExecutor.executePublish({
      workspaceId: WORKSPACE_ID, channel: 'INSTAGRAM', caption: 'approved', imageUrl: 'https://cdn.example.com/approved.jpg',
      contentVersionId: 'version', expectedFingerprint: 'fingerprint', actorUserId: ACTOR_ID,
    })
    expect(result.errorCode).toBe('EXECUTION_PREFLIGHT_BLOCKED')
    expect(mockIgPublish).not.toHaveBeenCalled()
    expect(mockDb.external_action_attempts).toHaveLength(1)
  })

  it('rechecks admission after enqueue work and blocks revoked approval', async () => {
    vi.mocked(ExecutionAdmissionGate.evaluate)
      .mockResolvedValueOnce({ admitted: true } as any)
      .mockResolvedValueOnce({ admitted: false, message: '승인 철회', reasonCode: 'APPROVAL_STALE' } as any)
    const result = await PublishingExecutor.executePublish({
      workspaceId: WORKSPACE_ID, channel: 'INSTAGRAM', caption: 'approved', imageUrl: 'https://cdn.example.com/approved.jpg',
      contentVersionId: 'version', expectedFingerprint: 'fingerprint', actorUserId: ACTOR_ID,
    })
    expect(result.errorCode).toBe('APPROVAL_STALE')
    expect(mockIgPublish).not.toHaveBeenCalled()
  })

  it('does not redispatch a succeeded request whose receipt is absent', async () => {
    mockDb.external_action_requests.push({
      id: 'request', workspace_id: WORKSPACE_ID, channel: 'instagram', action_kind: 'feed_publish',
      target_external_id: 'meta_acc_instagram_123', exact_payload: { caption: 'approved', imageUrl: 'https://cdn.example.com/approved.jpg' },
      status: 'succeeded', idempotency_key: 'key',
    })
    await expect(PublishingExecutor.executePublish({ workspaceId: WORKSPACE_ID, channel: 'INSTAGRAM', caption: 'approved', imageUrl: 'https://cdn.example.com/approved.jpg', idempotencyKey: 'key' }))
      .resolves.toMatchObject({ stage: 'RESULT_UNKNOWN' })
    expect(mockIgPublish).not.toHaveBeenCalled()
  })

  it('PublishingExecutor captures provider network timeout and marks RESULT_UNKNOWN', async () => {
    mockIgPublish.mockRejectedValueOnce(new Error('ETIMEDOUT: Connection to graph.facebook.com timed out'))

    const contentVersionId = 'vvvvvvvv-2222-4222-8222-222222222222'
    const result = await PublishingExecutor.executePublish({
      workspaceId: WORKSPACE_ID,
      channel: 'INSTAGRAM',
      caption: '타임아웃 발생 캡션',
      imageUrl: 'https://images.example.com/verified-real.jpg',
      contentVersionId,
      expectedFingerprint: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actorUserId: ACTOR_ID,
    })

    expect(result.success).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.stage).toBe('RESULT_UNKNOWN')
    expect(result.errorCode).toBe('UNKNOWN_RESULT')

    const dbReq = mockDb.external_action_requests.find(r => r.content_version_id === contentVersionId)
    expect(dbReq?.status).toBe('unknown_result')
  })
})
