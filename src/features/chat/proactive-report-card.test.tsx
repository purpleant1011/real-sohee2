import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { M01ProactiveReport } from './proactive-report'
import { ProactiveReportCard } from './proactive-report-card'

const report: M01ProactiveReport = Object.freeze({
  checkedAt: '2026-08-10T09:30:00+09:00',
  conversationCount: 7,
  headline: '최근 콘텐츠 반응을 정리했어요.',
  insight: '확인된 고객 대화에서 다음 방향을 찾았어요.',
  metrics: Object.freeze([
    { key: 'engagements', label: '관심 반응', value: 184 },
    { key: 'visits', label: '유입', value: 23 },
    { key: 'inquiries', label: '문의', value: 12 },
    { key: 'reservations', label: '예약', value: 7 },
  ] as const),
  periodLabel: '2026. 8. 3. – 2026. 8. 10.',
  screenId: 'M-01',
  sourceMessage: '확인된 기간의 실제 반응만 표시합니다.',
  sourceState: '표본 확인됨',
})

describe('ProactiveReportCard', () => {
  it('introduces the report with the approved Sohee character', () => {
    render(<ul><ProactiveReportCard report={report} /></ul>)

    expect(screen.getByRole('img', { name: '소희' })).toHaveAttribute(
      'src',
      expect.stringContaining('sohee-character-v1.png'),
    )
    expect(screen.queryByText('S.')).not.toBeInTheDocument()
  })
})
