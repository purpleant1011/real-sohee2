import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

import { getWorkspaceTrialProgress } from '../trial-journey'

describe('getWorkspaceTrialProgress count error fail-closed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('content_items count 조회 실패 시 인건비 절감을 0으로 왜곡하지 않고 throw한다', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({}),
      from: vi.fn((table: string) => {
        if (table === 'trial_journey_milestones') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'm-0', workspace_id: 'ws-1', day_stage: 0, title: '첫 마일스톤', is_completed: false },
              ],
              error: null,
            }),
          }
        }
        if (table === 'external_action_receipts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'channel_connections' || table === 'content_plans') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count: 1, error: null }),
          }
        }
        if (table === 'trial_entitlements') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { starts_at: new Date().toISOString(), ends_at: new Date().toISOString() },
              error: null,
            }),
          }
        }
        if (table === 'content_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'DB_CONNECTION_TIMEOUT' } }),
          }
        }
        if (table === 'credit_ledger_entries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    }

    mocks.createServerSupabaseClient.mockResolvedValue(supabase)

    await expect(getWorkspaceTrialProgress('ws-1')).rejects.toThrow(
      /TRIAL_JOURNEY_READ_FAILED.*content_items/
    )
  })
})
