import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks=vi.hoisted(() => ({ quick:vi.fn(),device:vi.fn(),select:vi.fn(),candidate:vi.fn(),current:vi.fn(),recover:vi.fn(),safety:vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest:mocks.quick,isResponse:(value:unknown) => value instanceof Response }))
vi.mock('@/features/local-publishing/device-auth', () => ({ authenticateConnectorRequest:mocks.device }))
vi.mock('@/features/local-publishing/execution-scope.server', () => ({
  authorizeExecutionScope:mocks.select,findExecutionCandidate:mocks.candidate,readDeviceExecutionScope:mocks.current,recoverDeviceCheckpoint:mocks.recover,
}))
vi.mock('@/features/admin/interventions/read-state', () => ({ readInterventionState:mocks.safety }))

import { GET as candidate,POST as select } from '@/app/api/workspaces/[workspaceId]/naver-connector/execution-scope/route'
import { POST as current } from '@/app/api/connector/execution-scope/current/route'
import { POST as recover } from '@/app/api/connector/jobs/[jobId]/recover/route'

const workspaceId='93000000-0000-4000-8000-000000000001'
const userId='93000000-0000-4000-8000-000000000002'
const actionId='93000000-0000-4000-8000-000000000003'
const connectionId='93000000-0000-4000-8000-000000000004'
const requestId='93000000-0000-4000-8000-000000000005'
const scopeId='93000000-0000-4000-8000-000000000006'
const leaseId='93000000-0000-4000-8000-000000000007'
const device={ workspaceId,deviceId:'93000000-0000-4000-8000-000000000008',tokenDigest:'a'.repeat(64),status:'active',platform:'macos',clientVersion:'0.1.2' } as const
const path=`https://example.com/api/workspaces/${workspaceId}/naver-connector/execution-scope`
const params={ params:Promise.resolve({ workspaceId }) }
const body={ actionId,connectionId,requestId,fingerprint:'b'.repeat(64) }
const post=(value:unknown=body,origin='https://example.com') => new Request(path,{ method:'POST',headers:{ origin,'content-type':'application/json' },body:JSON.stringify(value) })
const authorization={ actionId,scopeId,deviceId:device.deviceId,targetExternalId:'scope-blog',expiresAt:'2026-10-16T12:00:00Z' }

describe('execution scope HTTP boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.quick.mockResolvedValue({ workspaceId,userId,role:'manager',admin:{},supabase:{} })
    mocks.device.mockResolvedValue(device)
    mocks.safety.mockResolvedValue({ blocked:false })
    mocks.select.mockResolvedValue({ data:authorization })
    mocks.candidate.mockResolvedValue({ data:null })
    mocks.current.mockResolvedValue({ data:{ mode:'recovery_required' } })
    mocks.recover.mockResolvedValue({ data:{ state:'blocked' } })
  })

  it('selects an exact action only with same-origin owner/manager authorization', async () => {
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 인증된 요청이어도 403 POLICY_DISABLED 로 즉시 차단
    const response=await select(post(),params)
    expect(response.status).toBe(403)
    const json=await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.quick).toHaveBeenCalledWith(workspaceId,{ requireRole:'manager' })
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects cross-origin selection before any scope mutation', async () => {
    expect((await select(post(body,'https://evil.example'),params)).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('propagates actor authorization failures and respects an intervention stop', async () => {
    mocks.quick.mockResolvedValueOnce(new Response('{}',{ status:403 }))
    expect((await select(post(),params)).status).toBe(403)
    // V1.2 G0-02: 정책 정본에 따라 intervention 상태 조회 이전에 즉시 403 POLICY_DISABLED 로 차단
    mocks.safety.mockResolvedValue({ blocked:true,label:'소희가 잠시 멈췄어요' })
    const blockedRes = await select(post(),params)
    expect(blockedRes.status).toBe(403)
    expect((await blockedRes.json()).errorCode).toBe('POLICY_DISABLED')
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects client authority overrides, bad UUIDs and absent fingerprints', async () => {
    expect((await select(post({ ...body,workspaceId:'client-supplied' }),params)).status).toBe(400)
    expect((await select(post({ ...body,actionId:'wrong' }),params)).status).toBe(400)
    expect((await select(post({ actionId,connectionId,requestId }),params)).status).toBe(400)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('distinguishes an empty read from a failed candidate query', async () => {
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 인증된 candidate 조회도 403 POLICY_DISABLED 로 즉시 차단
    const url=path+`?contentId=${actionId}&versionId=${requestId}&connectionId=${connectionId}&fingerprint=${body.fingerprint}`
    const blocked=await candidate(new Request(url),params)
    expect(blocked.status).toBe(403)
    const json=await blocked.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
    expect(mocks.candidate).not.toHaveBeenCalled()
  })

  it('requires device authentication and keeps blocked scope distinct from legacy unscoped', async () => {
    const req=() => new Request('https://example.com/api/connector/execution-scope/current',{ method:'POST',body:'{}' })
    const response=await current(req())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mode:'recovery_required' })
    expect(mocks.current).toHaveBeenCalledWith(device)
    mocks.device.mockResolvedValue(null)
    expect((await current(req())).status).toBe(401)
  })

  it('never converts a scope read error into a null legacy scope', async () => {
    mocks.current.mockResolvedValue({ error:{ code:'SCOPE_QUERY_FAILED' } })
    const response=await current(new Request('https://example.com/api/connector/execution-scope/current',{ method:'POST',body:'{}' }))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toBeNull()
  })

  it('passes the exact lease and submit boundary to server recovery, without accepting body job overrides', async () => {
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 recover 요청은 인증 후 403 POLICY_DISABLED 로 즉시 차단
    const req=(value:unknown) => new Request(`https://example.com/api/connector/jobs/${actionId}/recover`,{ method:'POST',body:JSON.stringify(value) })
    const response=await recover(req({ leaseId,mayHaveSubmitted:true }),{ params:Promise.resolve({ jobId:actionId }) })
    expect(response.status).toBe(403)
    const json=await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
    expect(mocks.recover).not.toHaveBeenCalled()
  })

  it('does not authorize live execution from a preview origin even when that request is same-origin', async () => {
    const request=new Request(`https://preview.example.com/api/workspaces/${workspaceId}/naver-connector/execution-scope`,{
      method:'POST',headers:{ origin:'https://preview.example.com','content-type':'application/json' },body:JSON.stringify(body),
    })
    expect((await select(request,params)).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
  })

})
