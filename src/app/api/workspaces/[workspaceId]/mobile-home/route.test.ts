import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), dataset: vi.fn(), readHome: vi.fn(), deps: vi.fn(),
}))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (value: unknown) => value instanceof NextResponse }))
vi.mock('@/features/reporting/dataset', () => ({ readWorkspaceDataset: mocks.dataset }))
vi.mock('@/features/mobile-decision/server/production', () => ({ createMobileReadDeps: mocks.deps }))
vi.mock('@/features/mobile-decision/server/read-model', () => ({ readMobileHome: mocks.readHome }))
import { GET } from './route'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const request = () => GET(new Request(`http://localhost/api/workspaces/${workspaceId}/mobile-home`), { params: Promise.resolve({ workspaceId }) })

describe('모바일 홈 조회 경계 진단', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.authorize.mockResolvedValue({ workspaceId, supabase: {}, admin: {} })
    mocks.dataset.mockResolvedValue({ mode: 'ACTUAL' })
    mocks.deps.mockReturnValue({})
    mocks.readHome.mockResolvedValue({ version: 1 })
  })

  afterEach(() => vi.useRealTimers())

  it.each([
    ['auth', 5_000],
    ['dataset', 5_000],
    ['home', 6_000],
  ] as const)('%s 무응답을 빈 성공 대신 503으로 종료한다', async (stage, elapsed) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const dependency = { auth: mocks.authorize, dataset: mocks.dataset, home: mocks.readHome }[stage]
    dependency.mockReturnValue(new Promise<never>(() => {}))
    let response: NextResponse | undefined
    void request().then(result => { response = result })

    await vi.advanceTimersByTimeAsync(elapsed)

    expect(response?.status).toBe(503)
    expect(response?.headers.get('Cache-Control')).toBe('no-store')
    expect(response?.headers.get('Server-Timing')).toContain(`${stage};dur=`)
    expect(await response?.json()).toEqual({ error: '업무를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.' })
    if (stage === 'auth') expect(mocks.dataset).not.toHaveBeenCalled()
    if (stage !== 'home') expect(mocks.readHome).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['auth', 'dataset'] as const)('%s 시간 초과 후 늦은 성공으로 다음 조회를 시작하지 않는다', async stage => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    let resolve!: (value: unknown) => void
    const held = new Promise(resolveValue => { resolve = resolveValue })
    const dependency = stage === 'auth' ? mocks.authorize : mocks.dataset
    dependency.mockReturnValue(held)
    let response: NextResponse | undefined
    void request().then(result => { response = result })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(response?.status).toBe(503)

    resolve(stage === 'auth' ? { workspaceId, supabase: {}, admin: {} } : { mode: 'ACTUAL' })
    await vi.advanceTimersByTimeAsync(0)

    expect(response?.status).toBe(503)
    if (stage === 'auth') expect(mocks.dataset).not.toHaveBeenCalled()
    expect(mocks.readHome).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('느린 단계가 누적되어도 클라이언트 제한보다 먼저 API 전체 대기를 종료한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    mocks.authorize.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ workspaceId, supabase: {}, admin: {} }), 4_000)
    }))
    mocks.dataset.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ mode: 'ACTUAL' }), 4_000)
    }))
    mocks.readHome.mockReturnValue(new Promise<never>(() => {}))
    let response: NextResponse | undefined
    void request().then(result => { response = result })

    await vi.advanceTimersByTimeAsync(11_999)
    expect(response).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)

    expect(response?.status).toBe(503)
    expect(response?.headers.get('Server-Timing')).toMatch(/^auth;dur=.*dataset;dur=.*home;dur=/)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('정상 응답 뒤에는 제한 시간 타이머를 남기지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const response = await request()
    expect(response.status).toBe(200)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('응답에 인증·데이터 구분·홈 집계 시간을 남기되 사용자·가게 정보는 넣지 않는다', async () => {
    const response = await request()
    expect(await response.json()).toEqual({ version: 1 })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const timing = response.headers.get('Server-Timing')
    expect(timing).toMatch(/^auth;dur=\d+(?:\.\d+)?, dataset;dur=\d+(?:\.\d+)?, home;dur=\d+(?:\.\d+)?$/)
    expect(timing).not.toContain(workspaceId)
  })

  it('인증 거절에도 경과 시간을 남기고 dataset·홈은 읽지 않는다', async () => {
    mocks.authorize.mockResolvedValue(NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 }))
    const response = await request()
    expect(response.status).toBe(401)
    expect(response.headers.get('Server-Timing')).toMatch(/^auth;dur=/)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.dataset).not.toHaveBeenCalled()
    expect(mocks.readHome).not.toHaveBeenCalled()
  })

  it('인증 조회 자체가 실패해도 비밀값 없는 503과 실패 단계의 시간을 반환한다', async () => {
    mocks.authorize.mockRejectedValue(new Error('private-token-and-query'))
    const response = await request()
    expect(response.status).toBe(503)
    expect(response.headers.get('Server-Timing')).toMatch(/^auth;dur=/)
    expect(await response.text()).not.toContain('private-token-and-query')
    expect(mocks.dataset).not.toHaveBeenCalled()
  })

  it('non-ACTUAL 데이터는 홈 집계 전에 차단한다', async () => {
    mocks.dataset.mockResolvedValue({ mode: 'SHOWCASE_DEMO' })
    const response = await request()
    expect(response.status).toBe(503)
    expect(response.headers.get('Server-Timing')).toMatch(/^auth;dur=.*dataset;dur=/)
    expect(mocks.readHome).not.toHaveBeenCalled()
  })
})
