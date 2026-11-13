import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { handleFirstValuePublish } from './publish-route'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import type {
  ApprovedFactSnapshot,
  FactSnapshotResolver,
} from '@/features/publishing/fact-snapshot-gate'
import * as factGateModule from '@/features/publishing/fact-snapshot-gate'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const req = (binding: Record<string, unknown> = { revision: 1, fingerprint: mission.metadata.draftFingerprint }) =>
  new Request('http://localhost/api/first-value/publish', {
    method: 'POST',
    body: JSON.stringify({ missionId: id, reviewedImageIds: mission.metadata.payload.imageIds, ...binding }),
  })
const mission = {
  id,
  workspace_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  status: 'AWAITING_APPROVAL',
  metadata: {
    lane: 'QUICK_POST',
    payload: {
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      missionId: id,
      channels: [{ provider: 'threads', handle: 'test-store' }],
      copies: { instagram: { caption: '' }, threads: { content: '소희 첫 글 내용입니다.' } },
      imageIds: [] as string[],
      boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
      rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
    },
    draftFingerprint: 'good',
    factSnapshot: null as any,
  },
}

const validSnapshot: ApprovedFactSnapshot = {
  workspaceId: mission.workspace_id,
  resolvedAt: '2026-10-21T00:00:00.000Z',
  facts: [
    {
      id: 'fact-1',
      workspace_id: mission.workspace_id,
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
mission.metadata.factSnapshot = validSnapshot

const fakeResolver: FactSnapshotResolver = {
  loadApprovedFactSnapshot: vi.fn(),
  assertFactSnapshotCurrent: vi.fn(),
}

mission.metadata.draftFingerprint = calculateApprovalFingerprint(mission.metadata.payload)

let mockConnections: any[] = []

const makeAuth = (row = mission) => ({
  workspaceId: mission.workspace_id,
  userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  admin: {
    from: (table: string) => {
      if (table === 'channel_connections') {
        const query: any = {
          select: () => query,
          eq: () => Promise.resolve({ data: mockConnections, error: null }),
        }
        return query
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
      }
    },
  },
  supabase: {},
})
const auth = makeAuth()

describe('first-value publication server gate', () => {
  let origAllowlist: string | undefined

  let resolverSpy: any = null

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.META_APP_REVIEW_STATUS
    mockConnections = []
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    ;(fakeResolver.loadApprovedFactSnapshot as any).mockResolvedValue(validSnapshot)
    ;(fakeResolver.assertFactSnapshotCurrent as any).mockImplementation(() => {})
    resolverSpy = vi.spyOn(factGateModule, 'getDefaultFactSnapshotResolver').mockReturnValue(fakeResolver)
  })

  afterEach(() => {
    resolverSpy?.mockRestore()
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it.each([
    { revision: 0, fingerprint: 'good' },
    { revision: 1, fingerprint: 'old-draft' },
  ])('rejects an unseen draft before approval or retry: %j', async (binding) => {
    mocks.auth.mockResolvedValue(auth)
    const response = await handleFirstValuePublish(new Request('http://localhost/api/first-value/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: id, reviewedImageIds: mission.metadata.payload.imageIds, ...binding, retryChannel: 'threads' }),
    }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('STALE_DRAFT')
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
    expect(mocks.retrying).not.toHaveBeenCalled()
  })

  it.each([undefined, 'threads'] as const)('rejects a changed first image even when the legacy fingerprint is identical (retry=%s)', async (retryChannel) => {
    const reviewed = { ...mission.metadata.payload, imageIds: ['image-a', 'image-b'] }
    const current = { ...reviewed, imageIds: ['image-b', 'image-a'] }
    const fingerprint = calculateApprovalFingerprint(reviewed)
    expect(calculateApprovalFingerprint(current)).toBe(fingerprint)
    expect(current.imageIds[0]).not.toBe(reviewed.imageIds[0])
    const draft = { ...mission, metadata: { ...mission.metadata, payload: current, draftFingerprint: fingerprint } }
    mocks.auth.mockResolvedValue(makeAuth(draft))
    const response = await handleFirstValuePublish(req({ revision: 1, fingerprint, reviewedImageIds: reviewed.imageIds, ...(retryChannel ? { retryChannel } : {}) }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('STALE_DRAFT')
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
    expect(mocks.retrying).not.toHaveBeenCalled()
  })

  it('rejects a legacy request without the reviewed media list instead of substituting the current images', async () => {
    mocks.auth.mockResolvedValue(auth)
    const response = await handleFirstValuePublish(new Request('http://localhost/api/first-value/publish', {
      method: 'POST', body: JSON.stringify({ missionId: id, revision: 1, fingerprint: mission.metadata.draftFingerprint }),
    }))
    expect(response.status).toBe(422)
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects a request without the reviewed draft identity', async () => {
    mocks.auth.mockResolvedValue(auth)
    const response = await handleFirstValuePublish(req({}))
    expect(response.status).toBe(422)
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects publication when workspace is not in live allowlist', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '11111111-1111-4111-8111-111111111111'
    mocks.auth.mockResolvedValue(auth)

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('WORKSPACE_NOT_IN_LIVE_ROLLOUT')
    expect(json.error).toBe('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects unverified channels and never calls the provider', async () => {
    mocks.auth.mockResolvedValue(makeAuth())
    mocks.load.mockResolvedValue({
      stage: 'PREPARE_ONLY',
      verifiedChannels: [],
      prepared: true,
      businessVerified: false,
    })
    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('CHANNEL_NOT_VERIFIED')
    expect(json.error).toContain('채널')
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects with CONNECTION_IDENTITY_MISSING when connected channel is missing external_account_id', async () => {
    mockConnections = [
      { channel: 'threads', status: 'connected', external_account_id: null },
    ]
    mocks.auth.mockResolvedValue(makeAuth())
    mocks.load.mockResolvedValue({
      stage: 'PREPARE_ONLY',
      verifiedChannels: [],
      prepared: true,
      businessVerified: false,
    })
    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('CONNECTION_IDENTITY_MISSING')
    expect(json.error).toBe('이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.')
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('rejects with PUBLISH_NOT_ENABLED when META_APP_REVIEW_STATUS is not APPROVED even if channel is verified', async () => {
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    // process.env.META_APP_REVIEW_STATUS is undefined
    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('PUBLISH_NOT_ENABLED')
    expect(json.error).toContain('게시 기능을 준비하고 있어요')
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('approves and dispatches publication when META_APP_REVIEW_STATUS is APPROVED and channel is verified', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    mocks.publishing.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          executionResult: { overallStatus: 'ALL_VERIFIED', receipts: { threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-123', permalink: 'https://threads.net/p/123', verifiedAt: '2026-10-23T00:00:00.000Z' } } },
        }),
        { status: 200 }
      )
    )

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.verified).toBe(true)
    expect(json.permalink).toBe('https://threads.net/p/123')
    expect(json.channel).toBe('threads')
    expect(mocks.approval).toHaveBeenCalled()
    expect(mocks.publishing).toHaveBeenCalled()
  })

  it('keeps provider acceptance without readback unverified even if the aggregate claims success', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({ stage: 'PUBLISH_READY', verifiedChannels: ['threads'], prepared: true, businessVerified: false })
    mocks.approval.mockResolvedValue(Response.json({ success: true }))
    mocks.publishing.mockResolvedValue(Response.json({ success: true, executionResult: {
      overallStatus: 'ALL_VERIFIED', receipts: { threads: { stage: 'PROVIDER_ACCEPTED', providerPostId: 'pending-1' } },
    } }))
    const response = await handleFirstValuePublish(req())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('RESULT_UNKNOWN')
    expect(result.results[0].providerPostId).toBe('pending-1')
    expect(result.permalink).toBeNull()
  })

  it('does not confirm a channel whose receipt carries no readback timestamp', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({ stage: 'PUBLISH_READY', verifiedChannels: ['threads'], prepared: true, businessVerified: false })
    mocks.approval.mockResolvedValue(Response.json({ success: true }))
    mocks.publishing.mockResolvedValue(Response.json({ success: true, executionResult: {
      overallStatus: 'ALL_VERIFIED',
      receipts: { threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-1', permalink: 'https://threads.net/p/1' } },
    } }))
    const response = await handleFirstValuePublish(req())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('RESULT_UNKNOWN')
    expect(result.results[0].status).toBe('RESULT_UNKNOWN')
    expect(result.results[0].verifiedAt).toBeNull()
    expect(result.permalink).toBeNull()
  })

  it('turns an approval-time fingerprint race into a stale-draft conflict', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(
        JSON.stringify({ error: '지문 불일치 오류', code: 'FINGERPRINT_MISMATCH_REJECTED' }),
        { status: 422 }
      )
    )

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe('STALE_DRAFT')
    expect(json.error).toContain('최신')
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('forwards publish route failure status and code', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    mocks.publishing.mockResolvedValue(
      new Response(
        JSON.stringify({ error: '토큰 만료', code: 'TOKEN_EXPIRED' }),
        { status: 403 }
      )
    )

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.code).toBe('TOKEN_EXPIRED')
    expect(json.error).toBe('토큰 만료')
  })

  it('publishes to both Instagram and Threads when both are connected, verified and approved', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    const dualMission = {
      ...mission,
      metadata: {
        lane: 'QUICK_POST',
        payload: {
          ...mission.metadata.payload,
          channels: [{ provider: 'instagram', handle: 'test-store' }, { provider: 'threads', handle: 'test-store' }],
          copies: {
            instagram: { caption: '인스타 캡션' },
            threads: { content: '스레드 본문' },
          },
          imageIds: ['img-1'],
        },
        draftFingerprint: 'good-dual',
        factSnapshot: validSnapshot,
      },
    }
    dualMission.metadata.draftFingerprint = calculateApprovalFingerprint(dualMission.metadata.payload)
    const dualAuth = {
      ...auth,
      admin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: dualMission, error: null }),
              }),
            }),
          }),
        }),
      },
    }
    mocks.auth.mockResolvedValue(dualAuth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['instagram', 'threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    mocks.publishing.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          executionResult: {
            overallStatus: 'ALL_VERIFIED',
            receipts: {
              instagram: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'ig1', permalink: 'https://instagram.com/p/ig1', verifiedAt: '2026-10-23T00:00:00.000Z' },
              threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th1', permalink: 'https://threads.net/p/th1', verifiedAt: '2026-10-23T00:00:00.000Z' },
            },
          },
        }),
        { status: 200 }
      )
    )

    const response = await handleFirstValuePublish(req({ revision: 1, fingerprint: dualMission.metadata.draftFingerprint, reviewedImageIds: dualMission.metadata.payload.imageIds }))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.verified).toBe(true)
    expect(json.overallStatus).toBe('ALL_VERIFIED')
    expect(json.results).toEqual([
      { channel: 'instagram', verified: true, providerPostId: 'ig1', permalink: 'https://instagram.com/p/ig1', verifiedAt: '2026-10-23T00:00:00.000Z', errorCode: null, status: 'VERIFIED', stage: 'EXTERNALLY_VERIFIED' },
      { channel: 'threads', verified: true, providerPostId: 'th1', permalink: 'https://threads.net/p/th1', verifiedAt: '2026-10-23T00:00:00.000Z', errorCode: null, status: 'VERIFIED', stage: 'EXTERNALLY_VERIFIED' },
    ])
  })

  it('does not dispatch an unverified second target merely because one target is ready', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    const payload = { ...mission.metadata.payload, channels: [
      { provider: 'instagram', handle: 'test-store' }, { provider: 'threads', handle: 'test-store' },
    ] }
    const draft = { ...mission, metadata: { ...mission.metadata, payload, draftFingerprint: calculateApprovalFingerprint(payload) } }
    mocks.auth.mockResolvedValue(makeAuth(draft))
    mocks.approval.mockResolvedValue(Response.json({ success: true }))
    mocks.publishing.mockResolvedValue(Response.json({ executionResult: { receipts: {} } }))
    mocks.load.mockResolvedValue({ stage: 'PUBLISH_READY', verifiedChannels: ['threads'], prepared: true, businessVerified: false })
    const response = await handleFirstValuePublish(req({ revision: 1, fingerprint: draft.metadata.draftFingerprint }))
    expect(response.status).toBe(403)
    expect(mocks.approval).not.toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('does not retry after channel permission is revoked', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({ stage: 'PREPARE_ONLY', verifiedChannels: [], prepared: true, businessVerified: false })
    mocks.retrying.mockResolvedValue(Response.json({ executionResult: { receipts: {} } }))
    const response = await handleFirstValuePublish(req({ revision: 1, fingerprint: mission.metadata.draftFingerprint, retryChannel: 'threads' }))
    expect(response.status).toBe(403)
    expect(mocks.retrying).not.toHaveBeenCalled()
  })

  it('delegates an eligible retryChannel to retryMission after permission revalidation', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.load.mockResolvedValue({ stage: 'PUBLISH_READY', verifiedChannels: ['threads'], prepared: true, businessVerified: false })
    const retryReq = new Request('http://localhost/api/first-value/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: id, revision: 1, fingerprint: mission.metadata.draftFingerprint, reviewedImageIds: mission.metadata.payload.imageIds, retryChannel: 'threads' }),
    })
    mocks.auth.mockResolvedValue(auth)
    mocks.retrying.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          executionResult: {
            overallStatus: 'ALL_VERIFIED',
            receipts: {
              threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'retried1', permalink: 'https://threads.net/p/retried1', verifiedAt: '2026-10-23T00:00:00.000Z' },
            },
          },
        }),
        { status: 200 }
      )
    )

    const response = await handleFirstValuePublish(retryReq)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.verified).toBe(true)
    expect(json.results).toEqual([
      { channel: 'threads', verified: true, providerPostId: 'retried1', permalink: 'https://threads.net/p/retried1', verifiedAt: '2026-10-23T00:00:00.000Z', errorCode: null, status: 'VERIFIED', stage: 'EXTERNALLY_VERIFIED' },
    ])
    expect(mocks.retrying).toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('forwards 409 FACT_SNAPSHOT_STALE from approval preflight failure and halts publishing', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(
        JSON.stringify({ error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.', code: 'FACT_SNAPSHOT_STALE' }),
        { status: 409 }
      )
    )

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(409)
    const json = await response.json()
    expect(json.code).toBe('FACT_SNAPSHOT_STALE')
    expect(json.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.approval).toHaveBeenCalled()
    expect(mocks.publishing).not.toHaveBeenCalled()
  })

  it('forwards 503 FACT_READ_FAILED from publish preflight failure', async () => {
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    mocks.auth.mockResolvedValue(auth)
    mocks.load.mockResolvedValue({
      stage: 'PUBLISH_READY',
      verifiedChannels: ['threads'],
      prepared: true,
      businessVerified: false,
    })
    mocks.approval.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    mocks.publishing.mockResolvedValue(
      new Response(
        JSON.stringify({ error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.', code: 'FACT_READ_FAILED' }),
        { status: 503 }
      )
    )

    const response = await handleFirstValuePublish(req())
    expect(response.status).toBe(503)
    const json = await response.json()
    expect(json.code).toBe('FACT_READ_FAILED')
    expect(json.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
  })
})
