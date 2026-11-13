import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditSummary } from './credit-summary'

describe('CreditSummary', () => {
  it('hides credit numbers and gauges, showing only utilization status', () => {
    render(<CreditSummary balance={{ workspaceId: '10000000-0000-4000-8000-000000000001', periodStart: '2026-08-17', periodEnd: '2026-08-23', granted: 2000, adjustments: 0, released: 20, consumed: 667, reserved: 80, available: 1253, weeklyLimit: 2000, policyVersion: 'v08-test-2000-1' }} />)
    expect(screen.queryByText('1253 / 2000')).toBeNull()
    expect(screen.queryByText(/사용 가능 1253/)).toBeNull()
    expect(screen.queryByText(/임시 확보 80/)).toBeNull()
    expect(screen.queryByText(/사용 667/)).toBeNull()
    expect(screen.queryByText(/크레딧/)).toBeNull()
    expect(screen.getByText('정상 이용 중')).toBeVisible()
  })

  it('shows limit reached notice when available allowance is exhausted', () => {
    render(<CreditSummary balance={{ workspaceId: '10000000-0000-4000-8000-000000000001', periodStart: '2026-08-17', periodEnd: '2026-08-23', granted: 2000, adjustments: 0, released: 0, consumed: 2000, reserved: 0, available: 0, weeklyLimit: 2000, policyVersion: 'v08-test-2000-1' }} />)
    expect(screen.getByText(/이용 한도에 도달했어요/)).toBeVisible()
    expect(screen.queryByText(/0 \/ 2000/)).toBeNull()
  })

  it('shows checking status without numeric credits when balance is null', () => {
    render(<CreditSummary balance={null} />)
    expect(screen.getByText('이용 상태 확인 필요')).toBeVisible()
    expect(screen.queryByText(/주간 테스트 한도/)).toBeNull()
    expect(screen.queryByText(/크레딧/)).toBeNull()
  })
})
