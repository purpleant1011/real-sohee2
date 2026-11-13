// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { EvidenceRecordListDTO, EvidenceRecordSummary } from './evidence-record-dto'
import {
  EVIDENCE_RECORD_CACHE_CONTROL,
  evidenceRecordBoundary,
  validateEvidenceRecordListDTO,
} from './evidence-record-boundary'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '22222222-2222-4222-8222-222222222222'
const PERIOD = { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z' }

function record(overrides: Partial<EvidenceRecordSummary> = {}): EvidenceRecordSummary {
  return {
    recordRef: null,
    kind: 'BOOKING_CONFIRMED',
    kindLabel: '예약 확정',
    summary: '10월 21일 14:00 예약',
    occurredAt: '2026-10-21T05:00:00.000Z',
    detailHref: null,
    ...overrides,
  }
}

function dto(overrides: Partial<EvidenceRecordListDTO> = {}): EvidenceRecordListDTO {
  return {
    workspaceId: WS,
    metric: 'bookings',
    state: 'OBSERVED',
    datasetMode: 'ACTUAL',
    metricConnected: true,
    period: PERIOD,
    checkedAt: '2026-10-24T03:12:00.000Z',
    observedAt: '2026-10-24T03:10:00.000Z',
    totalCount: 1,
    records: [record()],
    omittedUnknownCount: 0,
    hasMore: false,
    ...overrides,
  }
}

/** 상태 코드 + 본문으로 경계를 부르는 도우미. 기본은 정상 200 응답이다. */
function call(status: number | null, payload: unknown, extra: Partial<Parameters<typeof evidenceRecordBoundary>[0]> = {}) {
  return evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status, payload, ...extra })
}

describe('evidenceRecordBoundary — 인증·경로 경계', () => {
  it('401 은 세션 문제다 — 빈 목록이 아니라 권한 화면으로 간다', () => {
    const result = call(401, { ok: false })

    expect(result.kind).toBe('unauthorized')
    expect(result.kind === 'unauthorized' && result.reason).toBe('session')
    expect(result.data.records).toEqual([])
    expect(result.data.totalCount).toBeNull()
  })

  it('403 은 권한 문제다 — 401 과 문구를 나눈다', () => {
    const result = call(403, { ok: false })

    expect(result.kind).toBe('unauthorized')
    expect(result.kind === 'unauthorized' && result.reason).toBe('permission')
    expect(result.data.totalCount).toBeNull()
  })

  it('404 는 missing 이다 — 빈 목록으로 위장하지 않는다', () => {
    const result = call(404, {})

    expect(result.kind).toBe('missing')
    expect(result.data.totalCount).toBeNull()
    expect(result.data.records).toEqual([])
  })

  it('오프라인은 상태 코드보다 먼저 닫는다(200 본문이 있어도 그리지 않는다)', () => {
    const result = call(200, dto(), { offline: true })

    expect(result.kind).toBe('offline')
    expect(result.data.records).toEqual([])
  })

  it('fetch 가 던졌으면(status=null) transport ERROR 다', () => {
    const result = call(null, null)

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('transport')
    expect(result.data.totalCount).toBeNull()
  })

  it('5xx 는 transport ERROR 다', () => {
    const result = call(503, { message: 'upstream' })

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('transport')
  })

  it('본문이 없거나 DTO 형태가 아니면 payload ERROR 다', () => {
    expect(call(200, null).kind).toBe('error')
    expect(call(200, { hello: 'world' }).kind).toBe('error')
    expect(call(200, dto()).kind).toBe('ready')
  })
})

describe('evidenceRecordBoundary — 다른 사업장 응답은 그리지 않는다', () => {
  it('workspaceId 가 다르면 200 이어도 error 이고 B 사업장 레코드는 한 건도 남지 않는다', () => {
    const result = call(200, dto({ workspaceId: OTHER_WS }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('workspace')
    expect(result.data.records).toEqual([])
    expect(result.data.totalCount).toBeNull()
    // 응답 DTO 에 B 사업장 id 조차 남기지 않는다.
    expect(result.data.workspaceId).toBe('')
    expect(JSON.stringify(result.data)).not.toContain(OTHER_WS)
    expect(JSON.stringify(result.data)).not.toContain('예약 확정')
  })
})

describe('evidenceRecordBoundary — ERROR ≠ EMPTY', () => {
  it('서버가 state=ERROR 라고 말하면 error(state) 로 닫고 0건으로 바꾸지 않는다', () => {
    const result = call(200, dto({ state: 'ERROR', totalCount: null, records: [], hasMore: true, observedAt: null }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('state')
    expect(result.data.state).toBe('ERROR')
    expect(result.data.totalCount).toBeNull()
  })

  it('ERROR 인데 totalCount=0 을 실어 보내면 조작된 응답으로 보고 거부한다', () => {
    const result = call(200, dto({ state: 'ERROR', totalCount: 0, records: [], hasMore: true }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
    expect(result.data.totalCount).toBeNull()
  })

  it('NOT_OBSERVED 에 records 를 실어 보내면 거부한다', () => {
    const result = call(200, dto({ state: 'NOT_OBSERVED', totalCount: null, records: [record()], hasMore: true }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
    expect(result.data.records).toEqual([])
  })

  it('0건은 OBSERVED + totalCount=0 일 때만 confirmed_empty 다', () => {
    const result = call(200, dto({ totalCount: 0, records: [], hasMore: false }))

    expect(result.kind).toBe('confirmed_empty')
    expect(result.data.totalCount).toBe(0)
  })
})

describe('evidenceRecordBoundary — 상태 조합', () => {
  it('OBSERVED + 1건 이상은 ready 다', () => {
    const result = call(200, dto())

    expect(result.kind).toBe('ready')
    expect(result.data.records).toHaveLength(1)
  })

  it('NOT_OBSERVED / CONNECTION_REQUIRED 를 그대로 전달한다', () => {
    const notObserved = call(200, dto({ state: 'NOT_OBSERVED', totalCount: null, records: [], hasMore: true }))
    const connection = call(200, dto({ state: 'CONNECTION_REQUIRED', totalCount: null, records: [], hasMore: true }))

    expect(notObserved.kind).toBe('not_observed')
    expect(connection.kind).toBe('connection_required')
  })

  it('ACTUAL 이 아니면 excluded — 숫자·목록을 그리지 않는다', () => {
    for (const datasetMode of ['EXCLUDED', 'UNKNOWN'] as const) {
      const result = call(200, dto({ datasetMode, state: 'NOT_OBSERVED', totalCount: null, records: [], hasMore: true }))

      expect(result.kind).toBe('excluded')
      expect(result.data.totalCount).toBeNull()
      expect(result.data.records).toEqual([])
    }
  })

  it('고객 문의는 metric_disconnected — 0건과 구분한다', () => {
    const result = evidenceRecordBoundary({
      workspaceId: WS,
      metric: 'inquiries',
      status: 200,
      payload: dto({
        metric: 'inquiries',
        metricConnected: false,
        state: 'NOT_OBSERVED',
        totalCount: null,
        records: [],
        hasMore: true,
      }),
    })

    expect(result.kind).toBe('metric_disconnected')
    expect(result.data.totalCount).toBeNull()
  })
})

describe('evidenceRecordBoundary — 2안 필드(원본 id 금지)', () => {
  it('recordRef 가 채워져 오면 forbidden 으로 닫는다', () => {
    const result = call(200, dto({ records: [record({ recordRef: 'opaque-1' })] }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('forbidden')
    expect(result.data.records).toEqual([])
  })

  it('detailHref 가 채워져 오면 forbidden 으로 닫는다', () => {
    const result = call(200, dto({ records: [record({ detailHref: '/app/customers#reservation-1' })] }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('forbidden')
  })

  it('요약문에 UUID·URL 이 섞이면 forbidden 으로 닫는다', () => {
    const withUuid = call(200, dto({ records: [record({ summary: '예약 11111111-1111-4111-8111-111111111111' })] }))
    const withUrl = call(200, dto({ records: [record({ summary: 'https://example.com/p/1' })] }))

    expect(withUuid.kind === 'error' && withUuid.reason).toBe('forbidden')
    expect(withUrl.kind === 'error' && withUrl.reason).toBe('forbidden')
  })
})

describe('evidenceRecordBoundary — 수가 어긋난 목록', () => {
  const many = Array.from({ length: 21 }, (_, i) => record({ occurredAt: `2026-10-${String((i % 24) + 1).padStart(2, '0')}T05:00:00.000Z` }))

  it('상한(20건)을 넘겨 보내면 inconsistent 다', () => {
    const result = call(200, dto({ totalCount: 21, records: many, hasMore: false }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
    expect(result.data.records).toEqual([])
  })

  it('20건 + hasMore 는 정상이다', () => {
    const result = call(200, dto({ totalCount: 25, records: many.slice(0, 20), hasMore: true }))

    expect(result.kind).toBe('ready')
    expect(result.data.records).toHaveLength(20)
    expect(result.data.hasMore).toBe(true)
  })

  it('hasMore=false 는 "전부"라는 선언이다 — records 가 모자라면 거부한다', () => {
    const result = call(200, dto({ totalCount: 5, records: [record()], hasMore: false }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
  })

  it('records 가 totalCount 보다 많으면 거부한다', () => {
    const result = call(200, dto({ totalCount: 1, records: [record(), record()], hasMore: true }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
  })

  it('본문 metric 이 요청 metric 과 다르면 거부한다', () => {
    const result = call(200, dto({ metric: 'published' }))

    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.reason).toBe('inconsistent')
  })
})

describe('validateEvidenceRecordListDTO', () => {
  it('정상 DTO 를 통과시킨다', () => {
    const result = validateEvidenceRecordListDTO(dto(), { workspaceId: WS, metric: 'bookings' })

    expect(result.ok).toBe(true)
  })

  it('필수 필드가 빠지면 payload 로 거부한다', () => {
    const broken: Record<string, unknown> = { ...dto() }
    delete broken.hasMore

    const result = validateEvidenceRecordListDTO(broken, { workspaceId: WS })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('payload')
  })

  it('배열·null·문자열 본문은 payload 로 거부한다', () => {
    for (const payload of [[], null, 'ok', 3]) {
      const result = validateEvidenceRecordListDTO(payload, { workspaceId: WS })
      expect(result.ok === false && result.reason).toBe('payload')
    }
  })
})

describe('EVIDENCE_RECORD_CACHE_CONTROL', () => {
  it('이 경로는 캐시하지 않는다', () => {
    expect(EVIDENCE_RECORD_CACHE_CONTROL).toBe('no-store')
  })
})
