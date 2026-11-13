import { describe, expect, it, vi } from 'vitest'
import {
  executeEngagementKillSwitch,
  getOperatorEngagementOverview,
} from '../engagement-repository'

describe('engagement-repository', () => {
  describe('getOperatorEngagementOverview', () => {
    it('aggregates policies, expiring DMs, auto-reply stats, and audit logs', async () => {
      const fixedNow = new Date('2026-10-14T12:00:00.000Z')

      const mockWorkspaces = [
        { id: 'ws-1', name: '강남 카페' },
        { id: 'ws-2', name: '홍대 식당' },
      ]

      const mockPolicies = [
        { workspace_id: 'ws-1', channel: 'instagram', autonomy_level: 'L3_AUTONOMOUS', is_paused: false },
        { workspace_id: 'ws-2', channel: 'instagram', autonomy_level: 'L1_MANUAL', is_paused: true },
        { workspace_id: 'ws-3', channel: 'threads', autonomy_level: 'L2_ASSISTED', is_paused: false },
      ]

      const mockThreads = [
        // 45분 남음 -> CRITICAL
        {
          id: 'th-1',
          workspace_id: 'ws-1',
          customer_handle: '@user1',
          last_message_text: '오늘 예약 되나요?',
          last_message_at: '2026-10-14T11:00:00.000Z',
          expires_at: '2026-10-14T12:45:00.000Z',
          status: 'NEEDS_REPLY',
        },
        // 90분 남음 -> WARNING
        {
          id: 'th-2',
          workspace_id: 'ws-2',
          customer_handle: '@user2',
          last_message_text: '주차 가능한가요?',
          last_message_at: '2026-10-14T10:30:00.000Z',
          expires_at: '2026-10-14T13:30:00.000Z',
          status: 'NEEDS_CHECK',
        },
        // 이미 만료됨 -> EXPIRED
        {
          id: 'th-3',
          workspace_id: 'ws-1',
          customer_handle: '@user3',
          last_message_text: '어제 갔었는데요',
          last_message_at: '2026-10-13T10:00:00.000Z',
          expires_at: '2026-10-14T10:00:00.000Z',
          status: 'EXPIRED',
        },
      ]

      const mockComments = [
        { id: 'cm-1', status: 'SENT', updated_at: '2026-10-14T08:00:00.000Z' },
        { id: 'cm-2', status: 'SENT', updated_at: '2026-10-14T09:00:00.000Z' },
        { id: 'cm-3', status: 'FAILED', updated_at: '2026-10-14T10:00:00.000Z' },
      ]

      const mockAudits = [
        {
          id: 'aud-1',
          workspace_id: 'ws-1',
          channel: 'instagram',
          action: 'auto_reply',
          actor: 'system',
          created_at: '2026-10-14T11:30:00.000Z',
          details: { comment_id: 'cm-1' },
        },
      ]

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'workspaces') {
            return {
              select: vi.fn().mockResolvedValue({ data: mockWorkspaces, error: null }),
            }
          }
          if (table === 'engagement_policies') {
            return {
              select: vi.fn().mockResolvedValue({ data: mockPolicies, error: null }),
            }
          }
          if (table === 'instagram_dm_threads') {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: mockThreads, error: null }),
                }),
              }),
            }
          }
          if (table === 'social_comments') {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ data: mockComments, error: null }),
              }),
            }
          }
          if (table === 'engagement_audit') {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockAudits, error: null }),
                }),
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: mockAudits, error: null }),
                }),
              }),
            }
          }
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }),
      }

      const { data, error } = await getOperatorEngagementOverview({ client: mockClient }, fixedNow)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      if (!data) return

      // 자율성 분포 검증
      expect(data.autonomy.l3Autonomous).toBe(1)
      expect(data.autonomy.l1Manual).toBe(1)
      expect(data.autonomy.l2Assisted).toBe(1)
      expect(data.autonomy.totalConfigured).toBe(3)
      expect(data.autonomy.pausedCount).toBe(1)

      // DM 24h 윈도우 스레드 검증
      expect(data.expiringDms).toHaveLength(3)
      const criticalDm = data.expiringDms.find((d) => d.id === 'th-1')
      expect(criticalDm?.urgency).toBe('CRITICAL')
      expect(criticalDm?.remainingMinutes).toBe(45)
      expect(criticalDm?.workspaceName).toBe('강남 카페')

      const warningDm = data.expiringDms.find((d) => d.id === 'th-2')
      expect(warningDm?.urgency).toBe('WARNING')
      expect(warningDm?.remainingMinutes).toBe(90)
      expect(warningDm?.workspaceName).toBe('홍대 식당')

      const expiredDm = data.expiringDms.find((d) => d.id === 'th-3')
      expect(expiredDm?.urgency).toBe('EXPIRED')

      // 24시간 통계 검증 (성공 2, 실패 1 -> 66.7%)
      expect(data.stats24h.totalAttempts).toBe(3)
      expect(data.stats24h.successfulReplies).toBe(2)
      expect(data.stats24h.failedReplies).toBe(1)
      expect(data.stats24h.successRatePercent).toBe(66.7)

      // 감사 로그 검증
      expect(data.recentAudits).toHaveLength(1)
      expect(data.recentAudits[0].action).toBe('auto_reply')
      expect(data.recentAudits[0].workspaceName).toBe('강남 카페')
    })

    it('returns error when policy query fails', async () => {
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'workspaces') {
            return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
          }
          if (table === 'engagement_policies') {
            return { select: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }) }
          }
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
        }),
      }

      const { data, error } = await getOperatorEngagementOverview({ client: mockClient })
      expect(data).toBeNull()
      expect(error).toContain('POLICIES_QUERY_FAILED')
    })
  })

  describe('executeEngagementKillSwitch', () => {
    it('executes downgrade_to_l1 for all workspaces', async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'engagement_policies') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'pol-1', workspace_id: 'ws-1' },
                    { id: 'pol-2', workspace_id: 'ws-2' },
                  ],
                  error: null,
                }),
              }),
              update: updateFn,
            }
          }
          if (table === 'engagement_audit') {
            return {
              insert: insertFn,
            }
          }
          return {}
        }),
      }

      const result = await executeEngagementKillSwitch(
        {
          scope: 'all',
          action: 'downgrade_to_l1',
          reason: 'L3 환각 긴급 중단',
        },
        'operator-user-123',
        { client: mockClient },
      )

      expect(result.success).toBe(true)
      expect(result.affectedWorkspaces).toBe(2)
      expect(result.updatedPolicies).toBe(2)
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ autonomy_level: 'L1_MANUAL' }),
      )
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: 'operator-user-123',
          action: 'policy_update',
        }),
      )
    })

    it('executes pause for single workspace', async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'engagement_policies') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ id: 'pol-1', workspace_id: 'ws-target' }],
                  error: null,
                }),
              }),
              update: updateFn,
            }
          }
          if (table === 'engagement_audit') {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }
          return {}
        }),
      }

      const result = await executeEngagementKillSwitch(
        {
          scope: 'workspace',
          workspaceId: '11111111-2222-3333-4444-555555555555',
          action: 'pause',
          reason: '특정 매장 일시 중지',
        },
        'operator-user-456',
        { client: mockClient },
      )

      expect(result.success).toBe(true)
      expect(result.affectedWorkspaces).toBe(1)
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ is_paused: true }),
      )
    })
  })
})
