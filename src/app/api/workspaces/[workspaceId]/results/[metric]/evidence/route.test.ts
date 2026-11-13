// @vitest-environment node
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  generateReport: vi.fn(),
  readEvidenceRecords: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/features/reporting/weekly-ceo-report-service', () => ({
  WeeklyCeoReportService: class {
    generateReport = mocks.generateReport
  },
}))

vi.mock('@/features/mobile-results/server/evidence-record-read', () => ({
  readEvidenceRecords: mocks.readEvidenceRecords,
}))

import { GET } from './route'

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-13T00:00:00.000Z', end: '2026-10-19T23:59:59.999Z' }

function report(overrides: Record<string, unknown> = {}) {
  return {
    datasetMode: 'ACTUAL',
    period: PERIOD,
    generatedAt: '2026-10-24T01:00:00.000Z',
    metrics: {
      bookingConfirmed: {
        state: 'OBSERVED',
        value: 2,
        period: PERIOD,
        observedAt: '2026-10-24T00:30:00.000Z',
        evidenceIds: ['a', 'b'],
      },
    },
    ...overrides,
  }
}

function callFor(metric = 'bookings', workspaceId = WS) {
  return {
    request: new Request(`https://example.com/api/workspaces/${workspaceId}/results/${metric}/evidence`),
    context: { params: Promise.resolve({ workspaceId, metric }) },
  }
}

function authorized() {
  mocks.authorize.mockResolvedValue({ userId: 'u1', workspaceId: WS, role: 'owner', admin: { marker: 'admin' } })
}

describe('GET 근거 기록 목록', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    authorized()
    mocks.generateReport.mockResolvedValue(report())
    mocks.readEvidenceRecords.mockResolvedValue({
      rows: [
        { kind: 'BOOKING_CONFIRMED', occurredAt: '2026-10-18T05:00:00.000Z', subject: '10월 18일 예약' },
        { kind: 'BOOKING_CANCELED', occurredAt: '2026-10-17T05:00:00.000Z', subject: '10월 17일 예약' },
      ],
      complete: true,
    })
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST
  })

  it('플래그 OFF 면 없는 경로다 — 인증·조회를 하지 않는다(PC 응답 불변)', async () => {
    delete process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST
    const { request, context } = callFor()

    const res = await GET(request, context)

    expect(res.status).toBe(404)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.generateReport).not.toHaveBeenCalled()
    expect(mocks.readEvidenceRecords).not.toHaveBeenCalled()
  })

  it('모르는 지표는 404 이고 인증도 하지 않는다', async () => {
    const { request, context } = callFor('revenue')

    const res = await GET(request, context)

    expect(res.status).toBe(404)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('로그인이 없으면 401 을 그대로 돌려준다', async () => {
    mocks.authorize.mockResolvedValue(NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 }))
    const { request, context } = callFor()

    const res = await GET(request, context)

    expect(res.status).toBe(401)
    expect(mocks.generateReport).not.toHaveBeenCalled()
  })

  it('인가 사업장이 요청 사업장과 다르면 404 다(남의 사업장 기록을 읽지 않는다)', async () => {
    mocks.authorize.mockResolvedValue({ userId: 'u1', workspaceId: 'other', role: 'owner', admin: {} })
    const { request, context } = callFor()

    const res = await GET(request, context)

    expect(res.status).toBe(404)
    expect(mocks.generateReport).not.toHaveBeenCalled()
  })

  it('관측된 지표면 200·건수·no-store 로 내려가고 근거 id 만 읽는다', async () => {
    const { request, context } = callFor()

    const res = await GET(request, context)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(mocks.readEvidenceRecords).toHaveBeenCalledWith(expect.anything(), WS, 'bookings', ['a', 'b'])
    expect(body.state).toBe('OBSERVED')
    expect(body.totalCount).toBe(2)
    expect(body.records).toHaveLength(2)
    expect(body.records[0]).not.toHaveProperty('id')
  })

  it('원장을 읽지 못하면 200 이지만 ERROR·totalCount null 이다(0건이 아니다)', async () => {
    mocks.readEvidenceRecords.mockResolvedValue({ rows: null, complete: false })
    const { request, context } = callFor()

    const res = await GET(request, context)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.state).toBe('ERROR')
    expect(body.totalCount).toBeNull()
    expect(body.records).toEqual([])
  })

  it('원장 줄 수가 근거 건수와 다르면 ERROR 로 닫는다', async () => {
    mocks.readEvidenceRecords.mockResolvedValue({
      rows: [{ kind: 'BOOKING_CONFIRMED', occurredAt: '2026-10-18T05:00:00.000Z' }],
      complete: true,
    })
    const { request, context } = callFor()

    const body = await (await GET(request, context)).json()

    expect(body.state).toBe('ERROR')
    expect(body.totalCount).toBeNull()
  })

  it('고객 문의는 원천 미연결이라 원장을 읽지 않고 NOT_OBSERVED 다', async () => {
    const { request, context } = callFor('inquiries')

    const res = await GET(request, context)
    const body = await res.json()

    expect(mocks.readEvidenceRecords).not.toHaveBeenCalled()
    expect(body.metricConnected).toBe(false)
    expect(body.state).toBe('NOT_OBSERVED')
    expect(body.totalCount).toBeNull()
  })

  it('ACTUAL 이 아닌 리포트는 숫자·목록을 숨긴다', async () => {
    mocks.generateReport.mockResolvedValue(report({ datasetMode: 'EXCLUDED' }))
    const { request, context } = callFor()

    const body = await (await GET(request, context)).json()

    expect(body.state).toBe('NOT_OBSERVED')
    expect(body.totalCount).toBeNull()
    expect(body.records).toEqual([])
  })

  it('리포트 생성이 실패하면 500 이고 캐시하지 않는다', async () => {
    mocks.generateReport.mockRejectedValue(new Error('boom'))
    const { request, context } = callFor()

    const res = await GET(request, context)

    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('알 수 없는 period 값은 이번 주로 닫고 조회는 그대로 한다', async () => {
    const { request, context } = callFor()
    const withPeriod = new Request(`${request.url}?period=whenever`)

    const res = await GET(withPeriod, context)

    expect(res.status).toBe(200)
    expect(mocks.generateReport).toHaveBeenCalledTimes(1)
  })
})
