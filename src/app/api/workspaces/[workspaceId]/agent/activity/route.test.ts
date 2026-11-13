import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/workspace-actor-guard'

const { verify, createClient, replay, readStatus } = vi.hoisted(() => ({ verify: vi.fn(), createClient: vi.fn(), replay: vi.fn(), readStatus: vi.fn() }))
vi.mock('@/lib/auth/workspace-actor-guard', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth/workspace-actor-guard')>(), verifyWorkspaceActor: verify,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: createClient }))
vi.mock('@/features/agent-activity/activity-store', () => ({ replayActivity: replay, readActivityRunStatus: readStatus }))
const workspaceId = '00000000-0000-0000-0000-000000000001'
const runId = '00000000-0000-0000-0000-000000000002'
const context = { params: Promise.resolve({ workspaceId }) }
const req = (query = `runId=${runId}`, headers = {}) => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/activity?${query}`, { headers })
beforeEach(() => {
  vi.clearAllMocks()
  verify.mockResolvedValue({ workspaceId, actorId: 'member' })
  createClient.mockResolvedValue({ authenticated: true })
  replay.mockResolvedValue([])
  readStatus.mockResolvedValue('executing')
})
describe('인증된 활동 replay', () => {
  it.each([[new UnauthorizedError(), 401], [new ForbiddenError(), 403]])('비회원은 원장 조회 전에 차단한다', async (error, status) => {
    verify.mockRejectedValueOnce(error)
    const response = await GET(req(), context)
    expect(response.status).toBe(status)
    expect(replay).not.toHaveBeenCalled()
  })
  it.each(['runId=invalid', `runId=${runId}&last-seq=-1`, `runId=${runId}&last-seq=1.5`, `runId=${runId}&last-seq=9007199254740992`])('잘못된 커서를 거부한다: %s', async query => {
    expect((await GET(req(query), context)).status).toBe(400)
    expect(replay).not.toHaveBeenCalled()
  })
  it('인증된 RLS 클라이언트로 last-seq 이후만 요청하고 캐시하지 않는다', async () => {
    const response = await GET(req(`runId=${runId}&last-seq=7`), context)
    expect(response.status).toBe(200)
    expect(replay).toHaveBeenCalledWith({ authenticated: true }, { workspaceId, runId, after: 7 })
    expect(readStatus).toHaveBeenCalledWith({ authenticated: true }, { workspaceId, runId })
    expect(await response.json()).toEqual({ events: [], last_seq: 7, run_status: 'executing' })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('SSE replay는 Last-Event-ID 이후 이벤트에 영속 sequence id를 붙인다', async () => {
    replay.mockResolvedValueOnce([{ sequence: 8, kind: 'blocked' }])
    const response = await GET(req(`runId=${runId}`, { accept: 'text/event-stream', 'Last-Event-ID': '7' }), context)
    expect(replay).toHaveBeenCalledWith(expect.anything(), { workspaceId, runId, after: 7 })
    expect(await response.text()).toBe('id: 8\nevent: activity\ndata: {"sequence":8,"kind":"blocked"}\n\n')
  })
  it('DB 에러 원문을 노출하거나 빈 성공으로 위장하지 않는다', async () => {
    replay.mockRejectedValueOnce(new Error('SECRET_DB_CUSTOMER'))
    const response = await GET(req(), context)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('SECRET_DB_CUSTOMER')
  })
})
