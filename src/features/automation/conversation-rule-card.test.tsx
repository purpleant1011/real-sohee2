import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConversationRuleCard } from './conversation-rule-card'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

describe('ConversationRuleCard', () => {
  it('shows schedule cost caps and quiet hours before saving on desktop', () => {
    render(<ConversationRuleCard proposal={{ name: '아침 성과 보고', schedule: '매일 오전 9:00', timezone: 'Asia/Seoul', channels: ['인스타그램'], perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, quietHours: { start: '22:00', end: '07:00' }, active: false }} />)
    expect(screen.getByText('하루 최대 40 크레딧')).toBeVisible()
    expect(screen.getByText('조용한 시간 오후 10:00부터 오전 7:00')).toBeVisible()
    expect(screen.getByText('비활성')).toBeVisible()
    expect(screen.getByRole('button', { name: '이대로 저장' })).toBeDisabled()
  })

  it('hides credit cost caps on mobile', () => {
    render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <ConversationRuleCard proposal={{ name: '아침 성과 보고', schedule: '매일 오전 9:00', timezone: 'Asia/Seoul', channels: ['인스타그램'], perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, quietHours: { start: '22:00', end: '07:00' }, active: false }} />
      </MobileR2Provider>,
    )
    expect(screen.queryByText(/40 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/20 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/200 크레딧/)).not.toBeInTheDocument()
    expect(screen.getByText('조용한 시간 오후 10:00부터 오전 7:00')).toBeVisible()
  })
})
