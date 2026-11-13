// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ReportingObservation } from '@/features/reporting/observation'
import {
  EVIDENCE_RECORD_KIND_LABEL,
  EVIDENCE_RECORD_MAX_RECORDS,
  type EvidenceRecordInput,
  type EvidenceRecordSourceRow,
  failedEvidenceRecordList,
  isEvidenceRecordMetric,
  toEvidenceRecordList,
} from './evidence-record-dto'

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z' }
const CHECKED_AT = '2026-10-24T03:12:00.000Z'
const OBSERVED_AT = '2026-10-24T03:10:00.000Z'

function observation(overrides: Partial<ReportingObservation> = {}): ReportingObservation {
  return {
    value: 3,
    state: 'OBSERVED',
    source: 'weekly-truth-summary',
    period: PERIOD,
    observedAt: OBSERVED_AT,
    evidenceIds: ['id-a', 'id-b', 'id-c'],
    ...overrides,
  }
}

function row(kind: unknown, occurredAt: unknown, subject?: unknown): EvidenceRecordSourceRow {
  return { kind, occurredAt, subject }
}

function input(overrides: Partial<EvidenceRecordInput> = {}): EvidenceRecordInput {
  return {
    workspaceId: WS,
    metric: 'bookings',
    datasetMode: 'ACTUAL',
    observation: observation(),
    period: PERIOD,
    checkedAt: CHECKED_AT,
    rows: [
      row('BOOKING_CONFIRMED', '2026-10-21T05:00:00.000Z', '10월 21일 14:00 예약'),
      row('BOOKING_CANCELED', '2026-10-22T05:00:00.000Z', '10월 22일 14:00 예약'),
      row('BOOKING_CONFIRMED', '2026-10-20T05:00:00.000Z'),
    ],
    complete: true,
    ...overrides,
  }
}

describe('toEvidenceRecordList — 관측 → 목록', () => {
  it('OBSERVED 면 totalCount 는 드릴다운의 evidenceCount 와 같고 최근 순으로 정렬한다', () => {
    const dto = toEvidenceRecordList(input())

    expect(dto.state).toBe('OBSERVED')
    expect(dto.totalCount).toBe(3)
    expect(dto.records.map(r => r.occurredAt)).toEqual([
      '2026-10-22T05:00:00.000Z',
      '2026-10-21T05:00:00.000Z',
      '2026-10-20T05:00:00.000Z',
    ])
    expect(dto.hasMore).toBe(false)
    expect(dto.omittedUnknownCount).toBe(0)
    expect(dto.datasetMode).toBe('ACTUAL')
    expect(dto.metricConnected).toBe(true)
    expect(dto.period).toEqual(PERIOD)
    expect(dto.observedAt).toBe(OBSERVED_AT)
    expect(dto.checkedAt).toBe(CHECKED_AT)
  })

  it('레코드 id(UUID·해시)를 만들지 않는다 — recordRef·detailHref 는 항상 null (2안)', () => {
    const dto = toEvidenceRecordList(input())

    expect(dto.records.every(r => r.recordRef === null)).toBe(true)
    expect(dto.records.every(r => r.detailHref === null)).toBe(true)
    // 화면 DTO 어디에도 원본 id 문자열이 남지 않는다.
    expect(JSON.stringify(dto)).not.toContain('id-a')
    expect(JSON.stringify(dto)).not.toContain('id-b')
  })

  it('kindLabel 은 서버가 완성한 한국어 문구다', () => {
    const dto = toEvidenceRecordList(input())

    expect(dto.records[0].kindLabel).toBe(EVIDENCE_RECORD_KIND_LABEL.BOOKING_CANCELED)
    expect(dto.records[0].kindLabel).toBe('예약 취소')
    expect(dto.records[1].kindLabel).toBe('예약 확정')
  })

  it('표시명이 없으면 종류별 기본 문구로 닫는다', () => {
    const dto = toEvidenceRecordList(input())

    expect(dto.records[2].summary).toBe('예약')
  })
})

describe('toEvidenceRecordList — ERROR 를 0건으로 바꾸지 않는다', () => {
  it('관측이 ERROR 면 state=ERROR, totalCount=null, records=[]', () => {
    const dto = toEvidenceRecordList(input({ observation: observation({ state: 'ERROR', value: 0 }) }))

    expect(dto.state).toBe('ERROR')
    expect(dto.totalCount).toBeNull()
    expect(dto.records).toEqual([])
    expect(dto.hasMore).toBe(true)
  })

  it('관측이 NOT_OBSERVED 면 0 이 아니라 null 이다', () => {
    const dto = toEvidenceRecordList(
      input({ observation: observation({ state: 'NOT_OBSERVED', value: 0, observedAt: null }) }),
    )

    expect(dto.state).toBe('NOT_OBSERVED')
    expect(dto.totalCount).toBeNull()
    expect(dto.observedAt).toBeNull()
    expect(dto.records).toEqual([])
  })

  it('CONNECTION_REQUIRED 는 그대로 전달한다', () => {
    const dto = toEvidenceRecordList(input({ observation: observation({ state: 'CONNECTION_REQUIRED', value: null }) }))

    expect(dto.state).toBe('CONNECTION_REQUIRED')
    expect(dto.totalCount).toBeNull()
  })

  it('관측은 있는데 기록 원장을 읽지 못했으면(rows=null) 빈 목록이 아니라 ERROR 다', () => {
    const dto = toEvidenceRecordList(input({ rows: null }))

    expect(dto.state).toBe('ERROR')
    expect(dto.totalCount).toBeNull()
    expect(dto.records).toEqual([])
  })

  it('원장이 전부 읽었다는데 줄 수가 evidenceCount 와 다르면 ERROR 다', () => {
    const dto = toEvidenceRecordList(
      input({ rows: [row('BOOKING_CONFIRMED', '2026-10-21T05:00:00.000Z')], complete: true }),
    )

    expect(dto.state).toBe('ERROR')
    expect(dto.totalCount).toBeNull()
  })

  it('원장 줄이 집계 수보다 많으면 어느 쪽도 믿지 않고 ERROR 다', () => {
    const dto = toEvidenceRecordList(
      input({
        observation: observation({ evidenceIds: ['id-a'] }),
        rows: [
          row('BOOKING_CONFIRMED', '2026-10-21T05:00:00.000Z'),
          row('BOOKING_CONFIRMED', '2026-10-22T05:00:00.000Z'),
        ],
        complete: false,
      }),
    )

    expect(dto.state).toBe('ERROR')
    expect(dto.totalCount).toBeNull()
  })

  it('관측 자체를 읽지 못했으면(observation=null) ERROR 다', () => {
    const dto = toEvidenceRecordList(input({ observation: null }))

    expect(dto.state).toBe('ERROR')
    expect(dto.totalCount).toBeNull()
  })

  it('workspaceId 가 비면 ERROR 다', () => {
    expect(toEvidenceRecordList(input({ workspaceId: '  ' })).state).toBe('ERROR')
  })
})

describe('toEvidenceRecordList — 데이터셋·지표 경계', () => {
  it('ACTUAL 이 아니면 숫자·목록을 모두 숨긴다', () => {
    for (const datasetMode of ['EXCLUDED', 'UNKNOWN'] as const) {
      const dto = toEvidenceRecordList(input({ datasetMode }))

      expect(dto.state).toBe('NOT_OBSERVED')
      expect(dto.totalCount).toBeNull()
      expect(dto.records).toEqual([])
    }
  })

  it('고객 문의는 저장된 댓글을 근거로 쓰지 않는다(metricConnected=false, 숫자 없음)', () => {
    const dto = toEvidenceRecordList(input({ metric: 'inquiries' }))

    expect(dto.metricConnected).toBe(false)
    expect(dto.state).toBe('NOT_OBSERVED')
    expect(dto.totalCount).toBeNull()
    expect(dto.records).toEqual([])
  })

  it('지표 키는 드릴다운 4종만 받는다', () => {
    expect(isEvidenceRecordMetric('published')).toBe(true)
    expect(isEvidenceRecordMetric('revenue')).toBe(false)
    expect(toEvidenceRecordList(input({ metric: 'revenue' as never })).state).toBe('ERROR')
  })
})

describe('toEvidenceRecordList — 모르는 줄은 버리지 않고 센다', () => {
  it('모르는 종류·시각 불명 줄은 omittedUnknownCount 로 세고 목록에서 뺀다', () => {
    const dto = toEvidenceRecordList(
      input({
        observation: observation({ evidenceIds: ['id-a', 'id-b', 'id-c', 'id-d'] }),
        rows: [
          row('BOOKING_CONFIRMED', '2026-10-21T05:00:00.000Z'),
          row('PAYMENT_CAPTURED', '2026-10-21T06:00:00.000Z'),
          row('BOOKING_CANCELED', '2026-10-22T01:00:00+09:00'),
          row('BOOKING_CONFIRMED', 'not-a-date'),
        ],
        complete: true,
      }),
    )

    expect(dto.state).toBe('OBSERVED')
    expect(dto.records).toHaveLength(1)
    expect(dto.omittedUnknownCount).toBe(3)
    expect(dto.totalCount).toBe(4)
    expect(dto.hasMore).toBe(true)
  })
})

describe('toEvidenceRecordList — 상한 20건 + hasMore', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`)
  const rows = Array.from({ length: 30 }, (_, i) =>
    row('BOOKING_CONFIRMED', `2026-10-${String((i % 24) + 1).padStart(2, '0')}T05:00:00.000Z`),
  )

  it('30건이면 20건만 보내고 hasMore=true, totalCount 는 30 이다', () => {
    const dto = toEvidenceRecordList(input({ observation: observation({ evidenceIds: ids }), rows }))

    expect(EVIDENCE_RECORD_MAX_RECORDS).toBe(20)
    expect(dto.records).toHaveLength(20)
    expect(dto.totalCount).toBe(30)
    expect(dto.hasMore).toBe(true)
  })

  it('원장이 잘렸다고 말했으면(complete=false) 전부인 척하지 않는다', () => {
    const dto = toEvidenceRecordList(
      input({
        observation: observation({ evidenceIds: ['id-a', 'id-b', 'id-c'] }),
        rows: [row('BOOKING_CONFIRMED', '2026-10-21T05:00:00.000Z')],
        complete: false,
      }),
    )

    expect(dto.state).toBe('OBSERVED')
    expect(dto.hasMore).toBe(true)
  })
})

describe('toEvidenceRecordList — 표시명 위생', () => {
  it('UUID·URL·이메일·과길이 표시명은 기본 문구로 닫는다', () => {
    const dto = toEvidenceRecordList(
      input({
        observation: observation({ evidenceIds: ['id-a', 'id-b', 'id-c', 'id-d'] }),
        rows: [
          row('PUBLISH_VERIFIED', '2026-10-21T05:00:00.000Z', '11111111-1111-4111-8111-111111111111'),
          row('PUBLISH_VERIFIED', '2026-10-21T05:00:00.000Z', 'https://example.com/post/1'),
          row('PUBLISH_VERIFIED', '2026-10-21T05:00:00.000Z', 'owner@example.com'),
          row('PUBLISH_VERIFIED', '2026-10-21T05:00:00.000Z', '가'.repeat(41)),
        ],
        complete: true,
      }),
    )

    expect(dto.records).toHaveLength(4)
    for (const record of dto.records) {
      expect(record.summary).toBe('게시한 게시물')
    }
  })

  it('안전한 표시명은 그대로 쓴다', () => {
    const dto = toEvidenceRecordList(
      input({
        observation: observation({ evidenceIds: ['id-a'] }),
        rows: [row('PUBLISH_VERIFIED', '2026-10-21T05:00:00.000Z', '인스타그램 게시물')],
        complete: true,
      }),
    )

    expect(dto.records[0].summary).toBe('인스타그램 게시물')
  })
})

describe('toEvidenceRecordList — 시각·기간', () => {
  it('checkedAt 이 ISO-UTC 가 아니면 null 이다(확인 시각을 지어내지 않는다)', () => {
    expect(toEvidenceRecordList(input({ checkedAt: '어제' })).checkedAt).toBeNull()
    expect(toEvidenceRecordList(input({ checkedAt: null })).checkedAt).toBeNull()
  })

  it('관측 기간이 없으면 입력 기간으로 채운다', () => {
    const dto = toEvidenceRecordList(input({ observation: observation({ period: undefined as never }) }))

    expect(dto.period).toEqual(PERIOD)
  })

  it('기간도 모르면 빈 경계다 — 화면이 0건 기간을 지어내지 않게 한다', () => {
    const dto = toEvidenceRecordList(input({ observation: null, period: null }))

    expect(dto.period).toEqual({ start: '', end: '' })
  })
})

describe('failedEvidenceRecordList', () => {
  it('숫자·목록 없이 ERROR 만 만든다', () => {
    const dto = failedEvidenceRecordList(WS, 'bookings')

    expect(dto.state).toBe('ERROR')
    expect(dto.datasetMode).toBe('UNKNOWN')
    expect(dto.totalCount).toBeNull()
    expect(dto.records).toEqual([])
    expect(dto.checkedAt).toBeNull()
    expect(dto.hasMore).toBe(true)
  })
})
