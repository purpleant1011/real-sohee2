import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PcWeeklyResults } from '../pc-weekly-results'
import type { MobileMetric, Remote } from '@/features/mobile-decision/contracts'

const ready = <T,>(data: T): Remote<T> => ({
  state: 'ready',
  data,
  observedAt: '2026-11-07T00:00:00Z',
  validUntil: null,
})

describe('PcWeeklyResults (PC 3열 관제 화면 — 이번 주 성과 요약 카드)', () => {
  it('게시 확인, 예약 확정, 확인된 매출 3개 지표를 정상 수치와 함께 렌더링한다', () => {
    const metrics: Remote<MobileMetric[]> = ready([
      {
        id: 'published',
        label: '게시 확인',
        value: 3,
        unit: '건',
        state: 'ready',
        evidenceRef: 'proof-1',
        source: 'instagram',
        datasetMode: 'ACTUAL',
        period: null,
      },
      {
        id: 'bookings',
        label: '예약 확정',
        value: 2,
        unit: '건',
        state: 'ready',
        evidenceRef: 'booking-1',
        source: 'crm',
        datasetMode: 'ACTUAL',
        period: null,
      },
      {
        id: 'revenue',
        label: '확인된 매출',
        value: 120000,
        unit: '원',
        state: 'ready',
        evidenceRef: 'rev-1',
        source: 'pos',
        datasetMode: 'ACTUAL',
        period: null,
      },
    ])

    render(<PcWeeklyResults results={metrics} />)

    expect(screen.getByText('이번 주 성과')).toBeInTheDocument()
    expect(screen.getByText('게시 확인')).toBeInTheDocument()
    expect(screen.getByText('3건')).toBeInTheDocument()
    expect(screen.getByText('예약 확정')).toBeInTheDocument()
    expect(screen.getByText('2건')).toBeInTheDocument()
    expect(screen.getByText('확인된 매출')).toBeInTheDocument()
    expect(screen.getByText('120,000원')).toBeInTheDocument()
  })

  it('지표 값이 없거나 null인 경우 "아직 확인되지 않았어요" 한 줄을 표시한다', () => {
    const metrics: Remote<MobileMetric[]> = ready([
      {
        id: 'published',
        label: '게시 확인',
        value: null,
        unit: '건',
        state: 'ready',
        evidenceRef: null,
        datasetMode: 'ACTUAL',
        period: null,
      },
      {
        id: 'bookings',
        label: '예약 확정',
        value: null,
        unit: '건',
        state: 'ready',
        evidenceRef: null,
        datasetMode: 'ACTUAL',
        period: null,
      },
      {
        id: 'revenue',
        label: '확인된 매출',
        value: null,
        unit: '원',
        state: 'ready',
        evidenceRef: null,
        datasetMode: 'ACTUAL',
        period: null,
      },
    ])

    render(<PcWeeklyResults results={metrics} />)

    const unconfirmedElements = screen.getAllByText('아직 확인되지 않았어요')
    expect(unconfirmedElements.length).toBe(3)
  })

  it('전체 결과 데이터가 비어있거나 로딩 중일 때 적절한 폴백을 표시한다', () => {
    const metrics: Remote<MobileMetric[]> = {
      state: 'loading',
      data: null,
      observedAt: null,
      validUntil: null,
    }

    render(<PcWeeklyResults results={metrics} />)
    expect(screen.getByText('이번 주 성과')).toBeInTheDocument()
    const unconfirmedElements = screen.getAllByText('아직 확인되지 않았어요')
    expect(unconfirmedElements.length).toBe(3)
  })

  it('datasetMode가 ACTUAL이 아닌 경우(DEMO/TEST/UNKNOWN) 숫자를 노출하지 않고 "아직 확인되지 않았어요"로 표시한다', () => {
    const metrics: Remote<MobileMetric[]> = ready([
      {
        id: 'published',
        label: '게시 확인',
        value: 10,
        unit: '건',
        state: 'ready',
        evidenceRef: 'demo-1',
        datasetMode: 'DEMO',
        period: null,
      },
      {
        id: 'bookings',
        label: '예약 확정',
        value: 5,
        unit: '건',
        state: 'ready',
        evidenceRef: 'test-1',
        datasetMode: 'TEST',
        period: null,
      },
      {
        id: 'revenue',
        label: '확인된 매출',
        value: 500000,
        unit: '원',
        state: 'ready',
        evidenceRef: 'unk-1',
        datasetMode: 'UNKNOWN',
        period: null,
      },
    ])

    render(<PcWeeklyResults results={metrics} />)

    expect(screen.queryByText('10건')).toBeNull()
    expect(screen.queryByText('5건')).toBeNull()
    expect(screen.queryByText('500,000원')).toBeNull()
    const unconfirmedElements = screen.getAllByText('아직 확인되지 않았어요')
    expect(unconfirmedElements.length).toBe(3)
  })
})
