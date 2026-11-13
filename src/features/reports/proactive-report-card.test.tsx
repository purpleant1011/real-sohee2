import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProactiveReportCard } from './proactive-report-card'

describe('ProactiveReportCard', () => {
  it('separates observation interpretation unknowns and decision', () => {
    render(<ProactiveReportCard report={{ observations: ['저장 수가 늘었어요.'], interpretations: ['첫 문장이 관심을 얻었을 수 있어요.'], unknowns: ['예약 전환 원인은 아직 알 수 없어요.'], proposal: '같은 주제로 다음 편을 제안해요.', requiredDecision: '다음 주에도 이어갈지 선택해 주세요.' }} />)
    expect(screen.getByRole('heading', { name: '확인된 변화' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '가능한 해석' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '아직 알 수 없는 부분' })).toBeVisible()
    expect(screen.getByRole('button', { name: '다음 방향 논의하기' })).toBeDisabled()
  })
})
