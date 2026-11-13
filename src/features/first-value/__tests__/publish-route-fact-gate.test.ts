import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ApprovedFactSnapshot,
  FactSnapshotResolver,
} from '@/features/publishing/fact-snapshot-gate'
import * as factGateModule from '@/features/publishing/fact-snapshot-gate'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  record: vi.fn(),
  approval: vi.fn(),
  publishing: vi.fn(),
  retrying: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.auth,
  isResponse: (v: unknown) => v instanceof Response,
}))
vi.mock('@/features/quick-start/quick-post-approval-readiness', () => ({
  readQuickPostApprovalReadiness: mocks.load,
}))
vi.mock('@/features/quick-start/funnel-events', () => ({
  recordFunnelEvent: mocks.record,
}))
vi.mock('@/app/api/missions/first-post/approve/route', () => ({
  POST: mocks.approval,
}))
vi.mock('@/app/api/missions/first-post/publish/route', () => ({
  POST: mocks.publishing,
}))
vi.mock('@/app/api/missions/first-post/publish/retry/route', () => ({
  POST: mocks.retrying,
}))
vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/safety/meta-live-allowlist', () => ({
  isMetaLiveAllowed: vi.fn().mockReturnValue(true),
}))

import { handleFirstValuePublish } from '../publish-route'

describe('handleFirstValuePublish Fact Snapshot Gate', () => {
  const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  const validSnapshot: ApprovedFactSnapshot = {
    workspaceId,
    resolvedAt: '2026-10-21T00:00:00.000Z',
    facts: [
      {
        id: 'fact-1',
        workspace_id: workspaceId,
        category: 'pricing',
        content: '기본 펌 40,000원',
        status: 'active',
        source_candidate_id: 'cand-1',
        approved_by_user_id: 'user-1',
        approved_at: '2026-10-20T10:00:00.000Z',
        valid_from: '2026-10-20T10:00:00.000Z',
        valid_until: null,
        supersedes_fact_id: null,
        created_at: '2026-10-20T10:00:00.000Z',
      },
    ],
    hash: 'hash-40000',
  }

  const baseMission = {
    id: missionId,
    workspace_id: workspaceId,
    status: 'AWAITING_APPROVAL',
    metadata: {
      lane: 'QUICK_POST',
      payload: {
        workspaceId,
        missionId,
        channels: [{ provider: 'threads', handle: 'test-store' }],
        copies: {
          instagram: { caption: '', hashtags: [] },
          threads: { content: '소희 첫 글 내용입니다.' },
        },
        imageIds: [] as string[],
        boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
        rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
      },
      draftFingerprint: '',
      factSnapshot: validSnapshot,
    },
  }
  baseMission.metadata.draftFingerprint = calculateApprovalFingerprint(baseMission.metadata.payload)

  const makeAuth = (m = baseMission) => ({
    workspaceId,
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    admin: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: m, error: null }),
            }),
          }),
        }),
      }),
    },
    supabase: {},
  })

  const req = (extra: Record<string, unknown> = {}) =>
    new Request('http://localhost/api/first-value/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({
        missionId,
        revision: 1,
        fingerprint: baseMission.metadata.draftFingerprint,
        reviewedImageIds: baseMission.metadata.payload.imageIds,
        ...extra,
      }),
    })

  const fakeResolver: FactSnapshotResolver = {
    loadApprovedFactSnapshot: vi.fn(),
    assertFactSnapshotCurrent: vi.fn(),
  }

  let resolverSpy: any = null

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    resolverSpy = vi.spyOn(factGateModule, 'getDefaultFactSnapshotResolver').mockReturnValue(fakeResolver)
    mocks.auth.mockResolvedValue(makeAuth())
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    mocks.publishing.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          executionResult: { overallStatus: 'ALL_VERIFIED', receipts: { threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-1', permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z' } } },
        }),
        { status: 200 }
      )
    )
    mocks.retrying.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          executionResult: { overallStatus: 'ALL_VERIFIED', receipts: { threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-1', permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z' } } },
        }),
        { status: 200 }
      )
    )
  })

  afterEach(() => {
    resolverSpy?.mockRestore()
    delete process.env.META_APP_REVIEW_STATUS
  })

  it('rejects at initial precheck before readiness/probe when facts are stale (409)', async () => {
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue({
      ...validSnapshot,
      hash: 'hash-50000',
    })
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {
      throw new Error('FACT_SNAPSHOT_STALE')
    })

    const res = await handleFirstValuePublish(req())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects before retryMission when facts become stale (409)', async () => {
    // Passes initial precheck
    ;(fakeResolver.loadApprovedFactSnapshot as any)
      .mockResolvedValueOnce(validSnapshot)
      // Second call (before retry) returns modified snapshot
      .mockResolvedValueOnce({ ...validSnapshot, hash: 'hash-modified' })

    ;(fakeResolver.assertFactSnapshotCurrent as any)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('FACT_SNAPSHOT_STALE')
      })

    const res = await handleFirstValuePublish(req({ retryChannel: 'threads' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(mocks.retrying).not.toHaveBeenCalled()
  })

  it('rejects before publishMission even if mission was already APPROVED if facts changed (409)', async () => {
    const approvedMission = { ...baseMission, status: 'APPROVED' }
    mocks.auth.mockResolvedValue(makeAuth(approvedMission))

    // Initial precheck passes
    ;(fakeResolver.loadApprovedFactSnapshot as any)
      .mockResolvedValueOnce(validSnapshot)
      // Final precheck fails
      .mockResolvedValueOnce({ ...validSnapshot, hash: 'hash-stale' })

    ;(fakeResolver.assertFactSnapshotCurrent as any)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('FACT_SNAPSHOT_STALE')
      })

    const res = await handleFirstValuePublish(req())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(mocks.approval).not.toHaveBeenCalled() // skipped because already APPROVED
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects before publishMission if facts change after approveMission call (409)', async () => {
    // Initial precheck passes
    ;(fakeResolver.loadApprovedFactSnapshot as any)
      .mockResolvedValueOnce(validSnapshot)
      // Pre-publish check fails
      .mockResolvedValueOnce({ ...validSnapshot, hash: 'hash-changed-post-approve' })

    ;(fakeResolver.assertFactSnapshotCurrent as any)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('FACT_SNAPSHOT_STALE')
      })

    const res = await handleFirstValuePublish(req())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(mocks.approval).toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('passes all gates when facts remain current (200)', async () => {
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(validSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {})

    const res = await handleFirstValuePublish(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verified).toBe(true)
    expect(mocks.approval).toHaveBeenCalled()
    expect(mocks.publishing).toHaveBeenCalled()
  })
})
