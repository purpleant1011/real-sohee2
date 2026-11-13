import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvidenceRecordListView } from './evidence-record-list-view'
import { evidenceRecordListSnapshot } from './evidence-record-list-state'
import { evidenceRecordBoundary, type EvidenceRecordBoundary } from './server/evidence-record-boundary'
import type { EvidenceRecordListDTO } from './server/evidence-record-dto'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = Date.now()
const PERIOD = { start: '2026-10-13T00:00:00.000Z', end: '2026-10-19T23:59:59.000Z' }

function dto(overrides: Partial<EvidenceRecordListDTO> = {}): EvidenceRecordListDTO {
  return {
    workspaceId: WS,
    metric: 'bookings',
    state: 'OBSERVED',
    datasetMode: 'ACTUAL',
    metricConnected: true,
    period: PERIOD,
    checkedAt: new Date(NOW - 5 * 60_000).toISOString(),
    observedAt: new Date(NOW - 10 * 60_000).toISOString(),
    totalCount: 2,
    records: [
      {
        recordRef: null, kind: 'BOOKING_CONFIRMED', kindLabel: '예약 확정',
        summary: '10월 18일 예약', occurredAt: '2026-10-18T05:07:00.000Z', detailHref: null,
      },
      {
        recordRef: null, kind: 'BOOKING_CANCELED', kindLabel: '예약 취소',
        summary: '10월 17일 예약', occurredAt: '2026-10-17T05:00:00.000Z', detailHref: null,
      },
    ],
    omittedUnknownCount: 0,
    hasMore: false,
    ...overrides,
  }
}

function renderBoundary(boundary: EvidenceRecordBoundary, onRetry?: () => void) {
  const snapshot = evidenceRecordListSnapshot({ boundary, metricLabel: '예약 확정', now: NOW })
  return render(<EvidenceRecordListView snapshot={snapshot} onRetry={onRetry} />)
}

function renderPayload(payload: unknown, status = 200, onRetry?: () => void) {
  return renderBoundary(
    evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status, payload }),
    onRetry,
  )
}

describe('EvidenceRecordListView — 확인된 목록', () => {
  it('종류·시각과 건수를 그리며 기록 id·UUID 를 노출하지 않는다', () => {
    renderPayload(dto())

    expect(screen.getByRole('heading', { level: 1, name: '예약 확정 근거 기록' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '근거 기록 내용' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('list', { name: '근거 기록 목록' })).toBeInTheDocument()
    expect(screen.getByText('2건')).toBeInTheDocument()
    expect(screen.getByText('10월 18일 예약')).toBeInTheDocument()
    expect(screen.getByText(/예약 확정 · 10월 18일 05:07 \(한국 시간 기준\)/)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  it('모르는 종류를 걸러냈다는 사실을 함께 말한다', () => {
    renderPayload(dto({ omittedUnknownCount: 1 }))

    expect(screen.getByText('확인하지 못한 종류 1건은 표시하지 않았어요.')).toBeInTheDocument()
  })
})

describe('EvidenceRecordListView — 목록을 그리면 안 되는 상태', () => {
  it('ERROR 는 0건이 아니라 실패로 그린다(목록 없음 + 재시도)', () => {
    const onRetry = vi.fn()
    renderPayload({ error: '근거 기록을 불러오지 못했어요.' }, 500, onRetry)

    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했어요')
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
    expect(screen.queryByText('0건')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('확인된 0건만 "아직 아무것도 없어요"로 그린다', () => {
    renderPayload(dto({ totalCount: 0, records: [], hasMore: true }))

    expect(screen.getByText('이 기간에 확인된 기록이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })

  it('없는 주소는 0건이 아니라 찾지 못함으로 그린다', () => {
    renderBoundary(evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 404, payload: null }))

    expect(screen.getByText('그런 기록을 찾지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })

  it('세션 만료와 권한 없음을 다른 화면으로 그린다', () => {
    const { unmount } = renderBoundary(evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 401, payload: null }))
    expect(screen.getByText('로그인이 만료됐어요')).toBeInTheDocument()
    unmount()

    renderBoundary(evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: 403, payload: null }))
    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeInTheDocument()
  })

  it('오프라인은 네트워크 문제로 그린다', () => {
    renderBoundary(evidenceRecordBoundary({ workspaceId: WS, metric: 'bookings', status: null, payload: null, offline: true }))

    expect(screen.getByText('네트워크에 연결할 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })

  it('오래된 확인은 기록을 숨기고 다시 확인하게 한다', () => {
    renderPayload(dto({ checkedAt: new Date(NOW - 3 * 60 * 60_000).toISOString() }))

    expect(screen.getByText('이전에 확인한 내용이에요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
    expect(screen.queryByText('10월 18일 예약')).toBeNull()
  })

  it('ACTUAL 이 아니면 기록 카드를 그리지 않는다', () => {
    renderPayload(dto({ datasetMode: 'EXCLUDED', totalCount: 5, records: [], hasMore: true }))

    expect(screen.getByText('실제 기록이 아니라서 근거 기록을 보여드리지 않아요.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })
})
