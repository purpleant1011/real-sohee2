import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  authenticate: vi.fn(),
  claim: vi.fn(),
  scopedClaim: vi.fn(),
  checkpoint: vi.fn(),
  permit: vi.fn(),
  complete: vi.fn(),
  payload: vi.fn(),
  registerConnection: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }))
vi.mock('@/features/local-publishing/device-auth', () => ({ authenticateConnectorRequest: mocks.authenticate }))
vi.mock('@/features/local-publishing/repository', () => ({
  claimLocalPublishJob: mocks.claim,
  claimScopedLocalPublishJob: mocks.scopedClaim,
  recordCheckpoint: mocks.checkpoint,
  issueLocalSubmitPermit: mocks.permit,
  completeLocalPublishJob: mocks.complete,
  registerBrowserChannelConnection: mocks.registerConnection,
}))
vi.mock('@/features/local-publishing/payload-loader', () => ({ loadApprovedLocalPayload: mocks.payload }))

import { POST as pair } from './pair/route'
import { POST as heartbeat } from './heartbeat/route'
import { POST as verifyConnection } from './connections/verify/route'
import { POST as claim } from './jobs/claim/route'
import { POST as checkpoint } from './jobs/[jobId]/checkpoint/route'
import { POST as submitPermit } from './jobs/[jobId]/submit-permit/route'
import { POST as complete } from './jobs/[jobId]/complete/route'

const device = {
  deviceId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  platform: 'macos',
  clientVersion: '0.1.0',
  status: 'active',
  tokenDigest: 'a'.repeat(64),
} as const
const jobId = '10000000-0000-4000-8000-000000000003'
const leaseId = '10000000-0000-4000-8000-000000000004'
const params = { params: Promise.resolve({ jobId }) }

describe('connector routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(device)
    mocks.eq.mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.from.mockReturnValue({ update: mocks.update })
  })

  it('pairs with a one-time high-entropy code and returns the token once', async () => {
    // V1.2 G0-02: 정책 정본에 따라 pair 요청은 유효한 입력이어도 403 POLICY_DISABLED 로 즉시 차단, DB rpc 미호출
    mocks.rpc.mockResolvedValue({ data: { deviceId: device.deviceId, workspaceId: device.workspaceId }, error: null })
    const response = await pair(new Request('https://example.com/api/connector/pair', {
      method: 'POST',
      body: JSON.stringify({
        code: 'c'.repeat(32), displayName: '업무용 Chrome', platform: 'macos', clientVersion: '0.1.0',
      }),
    }))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.errorCode).toBe('POLICY_DISABLED')
    expect(body.action).toBe('login')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns 401 before any connector operation when device auth fails', async () => {
    mocks.authenticate.mockResolvedValue(null)
    const response = await claim(new Request('https://example.com/api/connector/jobs/claim', { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('claims and returns an exact payload without the device digest', async () => {
    // V1.2 G0-02: 정책 정본에 따라 claim 요청은 인증 후 403 POLICY_DISABLED 로 즉시 차단, payload 로더 및 claim 미호출
    mocks.claim.mockResolvedValue({ data: {
      jobId, leaseId,
      attemptId: '10000000-0000-4000-8000-000000000005',
      contentVersionId: '10000000-0000-4000-8000-000000000006',
      approvalId: '10000000-0000-4000-8000-000000000007',
      approvalFingerprint: 'b'.repeat(64),
      browserChannelConnectionId: '10000000-0000-4000-8000-000000000008',
    } })
    mocks.payload.mockResolvedValue({ data: { id: jobId, channel: 'naver_blog' } })
    const response = await claim(new Request('https://example.com/api/connector/jobs/claim', { method: 'POST' }))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.errorCode).toBe('POLICY_DISABLED')
    expect(body.action).toBe('publish')
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.payload).not.toHaveBeenCalled()
  })

  it('records strict checkpoints and rejects secret-shaped extras', async () => {
    const invalid = await checkpoint(new Request(`https://example.com/api/connector/jobs/${jobId}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        leaseId, phase: 'preflight_verified', observedAt: '2026-08-19T07:00:00.000Z', cookie: 'never-store',
      }),
    }), params)
    expect(invalid.status).toBe(400)
    expect(mocks.checkpoint).not.toHaveBeenCalled()

    // V1.2 G0-02: 잘못된 바디는 400 유지하되, 유효한 체크포인트 요청은 403 POLICY_DISABLED 로 즉시 차단, recordCheckpoint 미호출
    mocks.checkpoint.mockResolvedValue({ data: true })
    const valid = await checkpoint(new Request(`https://example.com/api/connector/jobs/${jobId}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, phase: 'preflight_verified', observedAt: '2026-08-19T07:00:00.000Z' }),
    }), params)
    expect(valid.status).toBe(403)
    const validBody = await valid.json()
    expect(validBody.errorCode).toBe('POLICY_DISABLED')
    expect(validBody.action).toBe('publish')
    expect(mocks.checkpoint).not.toHaveBeenCalled()
  })

  it('heartbeats, issues a permit, and completes only through repository boundaries', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    expect((await heartbeat(new Request('https://example.com/api/connector/heartbeat', {
      method: 'POST', body: JSON.stringify({ clientVersion: '0.1.2' }),
    }))).status).toBe(200)
    expect(mocks.from).toHaveBeenCalledWith('connector_devices')
    expect(mocks.update).toHaveBeenCalledWith({ client_version: '0.1.2' })
    expect(mocks.eq).toHaveBeenCalledWith('id', device.deviceId)

    // V1.2 G0-02: submitPermit 및 complete 요청은 인증 후 403 POLICY_DISABLED 로 즉시 차단
    mocks.permit.mockResolvedValue({ data: { permit: 'p'.repeat(43) } })
    const permitResponse = await submitPermit(new Request(`https://example.com/api/connector/jobs/${jobId}/submit-permit`, {
      method: 'POST', body: JSON.stringify({ leaseId }),
    }), params)
    expect(permitResponse.status).toBe(403)
    const permitBody = await permitResponse.json()
    expect(permitBody.errorCode).toBe('POLICY_DISABLED')
    expect(permitBody.action).toBe('publish')
    expect(mocks.permit).not.toHaveBeenCalled()

    mocks.complete.mockResolvedValue({ data: true })
    const completeResponse = await complete(new Request(`https://example.com/api/connector/jobs/${jobId}/complete`, {
      method: 'POST', body: JSON.stringify({
        leaseId, status: 'succeeded', providerReference: 'naver-post-1',
        resultUrl: 'https://blog.naver.com/findk3/223000000000',
      }),
    }), params)
    expect(completeResponse.status).toBe(403)
    const completeBody = await completeResponse.json()
    expect(completeBody.errorCode).toBe('POLICY_DISABLED')
    expect(completeBody.action).toBe('publish')
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('keeps legacy connector heartbeats compatible when no client version is sent', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    const response = await heartbeat(new Request('https://example.com/api/connector/heartbeat', {
      method: 'POST', body: JSON.stringify({}),
    }))

    expect(response.status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('registers the observed Naver account only through the authenticated device boundary', async () => {
    mocks.registerConnection.mockResolvedValue({ data: { connectionId: '10000000-0000-4000-8000-000000000009' } })
    const response = await verifyConnection(new Request('https://example.com/api/connector/connections/verify', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'naver_blog', externalAccountLabel: 'findk3', targetExternalId: 'findk3',
        targetUrl: 'https://blog.naver.com/findk3/postwrite?categoryNo=1', environment: 'test',
      }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ connectionId: '10000000-0000-4000-8000-000000000009' })
  })

  it('uses only the explicit scoped claim and never bulk-recovers another queued action', async () => {
    // V1.2 G0-02: scoped claim 요청 역시 403 POLICY_DISABLED 로 즉시 차단, scopedClaim 미호출
    const scopeId='10000000-0000-4000-8000-000000000009'
    mocks.claim.mockResolvedValue({ data:null })
    mocks.scopedClaim.mockResolvedValue({ data:null })
    const response=await claim(new Request('https://example.com/api/connector/jobs/claim',{
      method:'POST',body:JSON.stringify({ actionId:jobId,scopeId }),
    }))
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
    expect(mocks.scopedClaim).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('rejects malformed partial scope instead of falling back to FIFO', async () => {
    mocks.claim.mockResolvedValue({ data:null })
    const response=await claim(new Request('https://example.com/api/connector/jobs/claim',{
      method:'POST',body:JSON.stringify({ actionId:jobId }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.scopedClaim).not.toHaveBeenCalled()
  })

})
