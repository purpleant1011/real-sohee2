import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/operator-revenue/revenue-repository', () => ({
  getOperatorRevenueData: vi.fn(async () => ({
    data: {
      stats: {
        windowDays: 30,
        windowLabel: '최근 30일',
        totalScDistributed: 500,
        totalScSettled: 200,
        burnRatePercent: 40,
        activeWorkspacesCount: 3,
        mrrKrw: null,
        mrrGrowth: null,
        idempotentStatus: null,
        idempotentIssuesCount: null,
      },
      ledger: [
        {
          id: 'test-1',
          referenceId: 'test1000',
          timestamp: '2026. 10. 08. 12:00',
          workspace: '테스트 고객사',
          workspaceId: 'ws-1',
          type: 'grant',
          typeLabel: '지급',
          amount: 500,
          amountLabel: '+500 SC',
          isPositive: true,
          action: '주간 정기 충전',
          idempotencyKey: 'idem-test',
        },
      ],
    },
    error: null,
  })),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import RevenuePage from './page'

describe('RevenuePage', () => {
  it('guards page with billing.read and renders credit ledger data', async () => {
    const view = await RevenuePage()
    expect(requireOperator).toHaveBeenCalledWith('billing.read')

    const html = renderToStaticMarkup(view)
    expect(html).toContain('크레딧 원장')
    expect(html).toContain('테스트 고객사')
    expect(html).toContain('최근 30일 지급 크레딧')
    expect(html).toContain('결제·구독 관리')
    // No hardcoded fake phrases
    expect(html).not.toMatch(/100% Match|Credit Economy V2|실운영 모드|Weekly Grant|Burn Rate/)
  })
})
