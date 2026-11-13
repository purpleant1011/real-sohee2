import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentLivingGreeting } from './agent-living-greeting'

describe('AgentLivingGreeting Component', () => {
  it('renders greeting text and action link when action is present', () => {
    render(
      <AgentLivingGreeting
        greeting={{
          greetingText: '안녕하세요 사장님! 바이름 마케팅 직원 소희예요.',
          badgeText: '예약 문의 대기 중',
          badgeVariant: 'urgent',
          quickAction: {
            label: '예약 문의 확인하기',
            href: '/app/engagement?tab=messages',
          },
        }}
      />
    )

    expect(screen.getByText(/바이름 마케팅 직원 소희예요/i)).toBeDefined()
    expect(screen.getByText(/예약 문의 대기 중/i)).toBeDefined()
    const link = screen.getByRole('link', { name: /예약 문의 확인하기/i })
    expect(link.getAttribute('href')).toBe('/app/engagement?tab=messages')
  })

  it('renders cleanly without action link when no action is needed', () => {
    render(
      <AgentLivingGreeting
        greeting={{
          greetingText: '현재 모든 고객 반응에 답장을 마쳤어요.',
          badgeText: '정상 가동 중',
          badgeVariant: 'success',
        }}
      />
    )

    expect(screen.getByText(/정상 가동 중/i)).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
