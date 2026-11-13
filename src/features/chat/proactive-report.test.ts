import { describe, expect, it } from 'vitest'
import type { ReportSnapshot } from '@/features/reports/types'
import { createM01ProactiveReport } from './proactive-report'

const verifiedSnapshot: ReportSnapshot = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-10',
  checkedAt: '2026-08-10T09:30:00+09:00',
  sampleState: 'sufficient',
  message: '확인된 기간의 실제 반응만 표시합니다.',
  metrics: Object.freeze({
    visits: 23,
    engagements: 184,
    inquiries: 12,
    reservations: 7,
    observedPosts: 1,
  }),
})

describe('createM01ProactiveReport', () => {
  it('maps verified report values and connected customer conversations into the M-01 contract', () => {
    expect(createM01ProactiveReport({
      conversationCount: 7,
      snapshot: verifiedSnapshot,
    })).toEqual({
      checkedAt: '2026-08-10T09:30:00+09:00',
      conversationCount: 7,
      headline: '최근 콘텐츠 반응을 정리했어요.',
      insight: '확인된 고객 대화 7건이 있어요. 고객의 질문과 예약 연결은 리포트에서 확인할 수 있어요.',
      metrics: [
        { key: 'engagements', label: '관심 반응', value: 184 },
        { key: 'visits', label: '유입', value: 23 },
        { key: 'inquiries', label: '문의', value: 12 },
        { key: 'reservations', label: '예약', value: 7 },
      ],
      periodLabel: '2026. 8. 3. – 2026. 8. 10.',
      screenId: 'M-01',
      sourceMessage: '확인된 기간의 실제 반응만 표시합니다.',
      sourceState: '표본 확인됨',
    })
  })

  it('does not create a proactive performance report when no period or metric has been verified', () => {
    const collectingSnapshot: ReportSnapshot = Object.freeze({
      periodStart: null,
      periodEnd: null,
      checkedAt: null,
      sampleState: 'collecting',
      message: '자료를 모으고 있어요.',
      metrics: Object.freeze({
        visits: null,
        engagements: null,
        inquiries: null,
        reservations: null,
        observedPosts: null,
      }),
    })

    expect(createM01ProactiveReport({
      conversationCount: 0,
      snapshot: collectingSnapshot,
    })).toBeNull()
  })

  it('keeps a failed customer-conversation lookup unknown instead of presenting a false zero', () => {
    const report = createM01ProactiveReport({
      conversationCount: null,
      snapshot: verifiedSnapshot,
    })

    expect(report?.conversationCount).toBeNull()
    expect(report?.insight).toBe('고객 대화 수는 아직 확인하지 못했어요. 연결 상태를 확인한 뒤 리포트에 표시할게요.')
  })
})
