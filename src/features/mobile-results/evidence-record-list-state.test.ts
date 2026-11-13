import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_RECORD_LIST_NOTICE,
  evidenceRecordCountText,
  evidenceRecordListSnapshot,
  evidenceRecordOmittedText,
  evidenceRecordOccurredLabel,
} from './evidence-record-list-state'
import { evidenceRecordBoundary } from './server/evidence-record-boundary'
import type { EvidenceRecordListDTO, EvidenceRecordSummary } from './server/evidence-record-dto'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const PERIOD = { start: '2026-10-13T00:00:00.000Z', end: '2026-10-19T23:59:59.000Z' }

function record(overrides: Partial<EvidenceRecordSummary> = {}): EvidenceRecordSummary {
  return {
    recordRef: null,
    kind: 'BOOKING_CONFIRMED',
    kindLabel: '예약 확정',
    summary: '10월 18일 예약',
    occurredAt: '2026-10-18T05:00:00.000Z',
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
    checkedAt: '2026-10-24T11:30:00.000Z',
    observedAt: '2026-10-24T11:00:00.000Z',
    totalCount: 2,
    records: [record(), record({ occurredAt: '2026-10-17T05:00:00.000Z', summary: '10월 17일 예약' })],
    omittedUnknownCount: 0,
    hasMore: false,
    ...overrides,
  }
}

function boundaryFrom(payload: unknown, metric: 'bookings' | 'inquiries' = 'bookings') {
  return evidenceRecordBoundary({ workspaceId: WS, metric, status: 200, payload })
}

function snapshotFrom(payload: unknown) {
  const metric = (payload as { metric?: string } | null)?.metric === 'inquiries' ? 'inquiries' : 'bookings'
  return evidenceRecordListSnapshot({ boundary: boundaryFrom(payload, metric), metricLabel: '예약 확정', now: NOW })
}

describe('evidenceRecordListSnapshot — 그릴 수 있는 목록', () => {
  it('OBSERVED 2건이면 목록을 그리고 건수는 전체 건수다', () => {
    const snapshot = snapshotFrom(dto())

    expect(snapshot.kind).toBe('ready')
    expect(snapshot.showRecords).toBe(true)
    expect(snapshot.records).toHaveLength(2)
    expect(snapshot.countText).toBe('2건')
    expect(snapshot.notice).toBeNull()
    expect(snapshot.chip).toBeNull()
    expect(snapshot.checkedAt).toBe('2026-10-24T11:30:00.000Z')
    expect(snapshot.periodLabel).toBe('2026.10.13 ~ 2026.10.19 (한국 시간 기준)')
  })

  it('잘랐으면 전체 건수와 보이는 건수를 함께 말한다', () => {
    const records = Array.from({ length: 3 }, (_, i) => record({ occurredAt: `2026-10-1${i + 1}T05:00:00.000Z` }))
    const snapshot = snapshotFrom(dto({ totalCount: 25, records, hasMore: true }))

    expect(snapshot.countText).toBe('25건 중 최근 3건')
    expect(snapshot.showRecords).toBe(true)
  })

  it('모르는 종류는 버리되 조용히 버리지 않고 수를 말한다', () => {
    const snapshot = snapshotFrom(dto({ omittedUnknownCount: 2 }))

    expect(snapshot.omittedText).toBe('확인하지 못한 종류 2건은 표시하지 않았어요.')
  })

  it('확인 시각을 읽지 못해도 목록은 그대로 보여 주고 표기만 붙인다', () => {
    const snapshot = snapshotFrom(dto({ checkedAt: null }))

    expect(snapshot.showRecords).toBe(true)
    expect(snapshot.stale).toBe(false)
    expect(snapshot.checkedAtNotice).toBe(EVIDENCE_RECORD_LIST_NOTICE.unknownCheckedAt)
  })
})

describe('evidenceRecordListSnapshot — 보여 줄 수 없는 상태', () => {
  it('아직 조회 중(null)은 0건이 아니라 loading 이다', () => {
    const snapshot = evidenceRecordListSnapshot({ boundary: null, metricLabel: '예약 확정', now: NOW })

    expect(snapshot.kind).toBe('loading')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.totalCount).toBeNull()
    expect(snapshot.chip).toEqual({ kind: 'loading' })
  })

  it('확인된 0건일 때만 "없다"고 말한다', () => {
    const snapshot = snapshotFrom(dto({ totalCount: 0, records: [], hasMore: true }))

    expect(snapshot.kind).toBe('confirmed_empty')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.empty)
  })

  it('ERROR 는 0건으로 바뀌지 않고 재조회를 안내한다', () => {
    const snapshot = snapshotFrom(dto({ state: 'ERROR', totalCount: null, records: [], hasMore: true }))

    expect(snapshot.kind).toBe('error')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.totalCount).toBeNull()
    expect(snapshot.countText).toBeNull()
    expect(snapshot.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.error)
    expect(snapshot.chip).toEqual({ kind: 'error' })
  })

  it('ACTUAL 이 아니면 기록 카드를 그리지 않는다', () => {
    const snapshot = snapshotFrom(dto({ datasetMode: 'EXCLUDED', totalCount: 5, records: [], hasMore: true }))

    expect(snapshot.kind).toBe('excluded')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.excluded)
  })

  it('원천 미연결 지표는 "0건"이 아니라 집계하지 않는다고 말한다', () => {
    const snapshot = snapshotFrom(dto({
      metric: 'inquiries',
      metricConnected: false,
      totalCount: 0,
      records: [],
      hasMore: true,
    }))

    expect(snapshot.kind).toBe('metric_disconnected')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.metricDisconnected)
  })

  it('미관측과 채널 미연결을 구분한다', () => {
    expect(snapshotFrom(dto({ state: 'NOT_OBSERVED', totalCount: null, records: [], hasMore: true })).notice)
      .toBe(EVIDENCE_RECORD_LIST_NOTICE.notObserved)
    expect(snapshotFrom(dto({ state: 'CONNECTION_REQUIRED', totalCount: null, records: [], hasMore: true })).notice)
      .toBe(EVIDENCE_RECORD_LIST_NOTICE.connectionRequired)
  })

  it('401(세션 만료)과 403(권한 없음)을 다른 문구로 닫는다', () => {
    const session = evidenceRecordListSnapshot({
      boundary: evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 401, payload: null }),
      metricLabel: '예약 확정',
      now: NOW,
    })
    const permission = evidenceRecordListSnapshot({
      boundary: evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 403, payload: null }),
      metricLabel: '예약 확정',
      now: NOW,
    })

    expect(session.unauthorizedReason).toBe('session')
    expect(session.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.session)
    expect(permission.unauthorizedReason).toBe('permission')
    expect(permission.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.permission)
    expect(session.showRecords).toBe(false)
  })

  it('404·오프라인을 0건으로 닫지 않는다', () => {
    expect(snapshotFrom({ error: '기록을 찾을 수 없어요.' }).kind).toBe('error') // 본문이 DTO 가 아니다
    const missing = evidenceRecordListSnapshot({
      boundary: evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 404, payload: null }),
      metricLabel: '예약 확정',
      now: NOW,
    })
    const offline = evidenceRecordListSnapshot({
      boundary: evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: null, payload: null, offline: true }),
      metricLabel: '예약 확정',
      now: NOW,
    })

    expect(missing.kind).toBe('missing')
    expect(missing.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.missing)
    expect(offline.kind).toBe('offline')
    expect(offline.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.offline)
    expect(offline.chip).toEqual({ kind: 'offline' })
  })

  it('오래된 확인은 목록을 숨기고 칩으로 말한다(오래된 숫자를 새것처럼 그리지 않는다)', () => {
    const snapshot = snapshotFrom(dto({ checkedAt: '2026-10-23T11:30:00.000Z' }))

    expect(snapshot.stale).toBe(true)
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.records).toEqual([])
    expect(snapshot.countText).toBeNull()
    expect(snapshot.notice).toBe(EVIDENCE_RECORD_LIST_NOTICE.stale)
    expect(snapshot.chip).toEqual({ kind: 'stale' })
  })

  it('다른 사업장 응답은 레코드가 있어도 그리지 않는다', () => {
    const snapshot = snapshotFrom(dto({ workspaceId: 'other' }))

    expect(snapshot.kind).toBe('error')
    expect(snapshot.showRecords).toBe(false)
    expect(snapshot.records).toEqual([])
  })
})

describe('표시 도우미', () => {
  it('기록 시각은 한국 시간 기준으로 고정 표기하고 읽을 수 없으면 null 이다', () => {
    expect(evidenceRecordOccurredLabel('2026-10-18T05:07:00.000Z')).toBe('10월 18일 05:07 (한국 시간 기준)')
    expect(evidenceRecordOccurredLabel('어제')).toBeNull()
  })

  it('건수 문구는 잘린 사실을 숨기지 않는다', () => {
    expect(evidenceRecordCountText(3, 3, false)).toBe('3건')
    expect(evidenceRecordCountText(25, 20, true)).toBe('25건 중 최근 20건')
  })

  it('모르는 종류가 없으면 빈 줄을 만들지 않는다', () => {
    expect(evidenceRecordOmittedText(0)).toBeNull()
    expect(evidenceRecordOmittedText(-1)).toBeNull()
    expect(evidenceRecordOmittedText(1)).toBe('확인하지 못한 종류 1건은 표시하지 않았어요.')
  })
})
