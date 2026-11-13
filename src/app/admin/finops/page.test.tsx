import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockFrom = vi.fn()

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import AdminFinOpsPage from './page'

describe('AdminFinOpsPage', () => {
  it('guards page with billing.read and renders bounded metrics without table names or English headers', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'finops_cost_ledger') {
        const query: any = {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              { category: 'llm', cost_in_won: 5400, units_consumed: 120, created_at: '2026-10-05T00:00:00Z' },
            ],
            error: null,
          }),
        }
        return query
      }
      if (table === 'credit_ledger_entries') {
        const query: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              { action: 'text_generation', amount: -200, occurred_at: '2026-10-06T00:00:00Z' },
              { action: 'image_generation', amount: -50, occurred_at: '2026-10-07T00:00:00Z' },
            ],
            error: null,
          }),
        }
        return query
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
    })

    const view = await AdminFinOpsPage()
    expect(requireOperator).toHaveBeenCalledWith('billing.read')

    const html = renderToStaticMarkup(view)
    expect(html).toContain('AI 비용')
    expect(html).not.toContain('FinOps')
    expect(html).toContain('최근 30일 AI 텍스트 소비')
    expect(html).toContain('최근 30일 이미지 생성 작업')
    expect(html).toContain('5,400원')
    expect(html).toContain('확인할 수 없어요') // 마진은 산출 불가로 확인 불가 표시
    expect(html).not.toMatch(/finops_cost_ledger|credit_ledger_entries|UNKNOWN \(분석 대기\)|Financial Engineering/)
  })

  it('renders LoadErrorNotice when database query fails', async () => {
    mockFrom.mockImplementation(() => {
      const query: any = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: new Error('Permission denied') }),
      }
      return query
    })

    const view = await AdminFinOpsPage()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('불러오지 못했어요')
    expect(html).toContain('다시 불러오기')
  })
})
