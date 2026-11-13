import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from '@/app/api/workspaces/[workspaceId]/reports/weekly/route'

const { authorize, generate, generateRange } = vi.hoisted(() => ({ authorize: vi.fn(), generate: vi.fn(), generateRange: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('../weekly-ceo-report-service', () => ({
  WeeklyCeoReportService: class { generateReport = generate; generateRangeReport = generateRange },
}))
const request = (search = '') => new Request(`https://example.test/api/workspaces/workspace-a/reports/weekly${search}`)
const context = () => ({ params: Promise.resolve({ workspaceId: 'workspace-a' }) })

beforeEach(() => { authorize.mockReset(); generate.mockReset(); generateRange.mockReset() })
describe('weekly report authorization boundary', () => {
  it('returns the authorization denial without accessing reporting data', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await GET(request(), context())).status).toBe(403)
    expect(generate).not.toHaveBeenCalled()
  })
  it('rejects an authorization fallback to a different workspace', async () => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-b', admin: {} })
    expect((await GET(request(), context())).status).toBe(404)
    expect(generate).not.toHaveBeenCalled()
  })
  it('reads only the authorized workspace and prevents response caching', async () => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: {} })
    generate.mockResolvedValue({ workspaceId: 'workspace-a', datasetMode: 'ACTUAL' })
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(authorize).toHaveBeenCalledWith('workspace-a')
    // 기간 파라미터(ANI-1706)로 두 번째 인자(기준 시각)가 붙었다.
    expect(generate).toHaveBeenCalledWith('workspace-a', expect.any(Date))
    expect(await response.json()).toEqual({ workspaceId: 'workspace-a', datasetMode: 'ACTUAL' })
  })
})

// ANI-1706 기간 선택: 같은 읽기 경로에서 기준 시각만 옮긴다(새 API·쓰기 경로 없음).
describe('weekly report period selection', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const NOW = new Date('2026-10-24T13:05:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: {} })
    generate.mockResolvedValue({ workspaceId: 'workspace-a', datasetMode: 'ACTUAL' })
  })
  afterEach(() => { vi.useRealTimers() })

  const baseDateOf = (index = 0) => (generate.mock.calls[index] as [string, Date])[1]

  it('파라미터가 없으면 이번 주 기준 시각(다음 UTC 자정)을 넘긴다', async () => {
    await GET(request(), context())
    expect(baseDateOf().toISOString()).toBe('2026-10-25T00:00:00.000Z')
  })

  it('?period=previous 는 기준 시각만 정확히 7일 앞당긴다', async () => {
    await GET(request(), context())
    await GET(request('?period=previous'), context())
    expect(baseDateOf(0).getTime() - baseDateOf(1).getTime()).toBe(7 * DAY_MS)
    expect(baseDateOf(1).toISOString()).toBe('2026-10-18T00:00:00.000Z')
  })

  it('모르는 기간 값은 200 으로 이번 주를 돌려준다', async () => {
    const response = await GET(request('?period=last-month'), context())
    expect(response.status).toBe(200)
    expect(baseDateOf().toISOString()).toBe('2026-10-25T00:00:00.000Z')
  })
})

// ANI-1782 직접 선택 구간: start·end 가 짝으로 온 구간만 서비스에 넘기고, 어긋나면 조회 없이 400 으로 닫는다.
describe('weekly report direct range', () => {
  const NOW = new Date('2026-10-24T13:05:00.000Z') // 이번 주 종료 = 2026-10-25T00:00Z
  const RANGE_ERROR = { error: '조회 기간을 확인해 주세요.' }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: {} })
    generate.mockResolvedValue({ workspaceId: 'workspace-a', datasetMode: 'ACTUAL' })
    generateRange.mockResolvedValue({ workspaceId: 'workspace-a', datasetMode: 'ACTUAL' })
  })
  afterEach(() => { vi.useRealTimers() })

  async function expectRangeRejected(search: string) {
    const response = await GET(request(search), context())
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(RANGE_ERROR)
    expect(generate).not.toHaveBeenCalled()
    expect(generateRange).not.toHaveBeenCalled()
  }

  it('정상 구간은 시작일 0시부터 종료일 다음 날 0시까지의 기간으로 서비스에 넘긴다', async () => {
    const response = await GET(request('?start=2026-09-01&end=2026-10-01'), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(generateRange).toHaveBeenCalledWith('workspace-a', { start: '2026-09-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('하루짜리 구간과 92일 경계는 통과한다', async () => {
    expect((await GET(request('?start=2026-10-24&end=2026-10-24'), context())).status).toBe(200)
    expect((await GET(request('?start=2026-07-01&end=2026-09-30'), context())).status).toBe(200)
    expect(generateRange).toHaveBeenLastCalledWith('workspace-a', { start: '2026-07-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' })
  })

  it('시작만 또는 종료만 있으면 400 이다', async () => {
    await expectRangeRejected('?start=2026-09-01')
    await expectRangeRejected('?end=2026-10-01')
  })

  it('구간과 period 가 함께 오면 400 이다', async () => {
    await expectRangeRejected('?start=2026-09-01&end=2026-10-01&period=previous')
    await expectRangeRejected('?period=current&start=2026-09-01&end=2026-10-01')
  })

  it('달력에 없는 날짜나 형식이 다른 값은 400 이다', async () => {
    await expectRangeRejected('?start=2026-02-30&end=2026-03-01')
    await expectRangeRejected('?start=2026/09/01&end=2026-10-01')
    await expectRangeRejected('?start=&end=')
  })

  it('93일, 역순, 미래 종료 구간은 400 이다', async () => {
    await expectRangeRejected('?start=2026-07-01&end=2026-10-01')
    await expectRangeRejected('?start=2026-10-05&end=2026-10-01')
    await expectRangeRejected('?start=2026-10-20&end=2026-10-25')
  })

  it('프리셋 회귀: 파라미터가 없거나 previous 이거나 모르는 값이면 기존 기준 시각을 쓴다', async () => {
    await GET(request(), context())
    await GET(request('?period=previous'), context())
    await GET(request('?period=last-month'), context())
    expect(generateRange).not.toHaveBeenCalled()
    expect(generate.mock.calls.map(([, base]) => (base as Date).toISOString())).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-18T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
    ])
  })
})
