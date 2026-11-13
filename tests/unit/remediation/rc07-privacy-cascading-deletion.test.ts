import { describe, it, expect, vi } from 'vitest'
import {
  CustomerDataRetentionManager,
} from '@/features/privacy/customer-data-retention-lineage'
import { executeResponseJobDelivery } from '@/features/channels/responsive-employee-loop'

describe('[RC-07][Regression] End-Customer Privacy & Cascading Deletion (ANI-1332)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const customerId = 'cust-optout-target-001'

  describe('1. Cascading Customer Data Anonymization (No Fixed Mock Numbers)', () => {
    it('executes real database anonymization across conversations, reservations, and opt-outs', async () => {
      let conversationsUpdatedCount = 0
      let optOutRecorded = false
      let reservationRedactedCount = 0

      const mockClient = {
        from: (table: string) => {
          if (table === 'customer_opt_outs') {
            return {
              upsert: async (row: any) => {
                if (row.customer_id === customerId) {
                  optOutRecorded = true
                }
                return { error: null }
              },
            }
          }
          if (table === 'customer_conversations') {
            return {
              update: (updates: any) => ({
                eq: () => ({
                  eq: () => ({
                    // 익명화는 실제로 몇 행이 바뀌었는지 확인해야 하므로 update 뒤에 .select('id') 가 붙는다.
                    select: () => {
                      conversationsUpdatedCount = 3 // Real simulated update of 3 matching rows
                      return Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], error: null })
                    },
                  }),
                }),
              }),
            }
          }
          if (table === 'reservations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => Promise.resolve({
                    data: [
                      { id: 'bk-1', status: 'CONFIRMED', total_amount_krw: 180000 },
                    ],
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: () => {
                    reservationRedactedCount = 1
                    return Promise.resolve({ error: null })
                  },
                }),
              }),
            }
          }
          // ANI-1758: 코드가 없는 테이블명(attribution_events)을 쓰던 것을 정본
          // social_attribution_events 로 고쳤다. 대역도 정본 이름을 따라야 한다.
          if (table === 'social_attribution_events') {
            return {
              update: () => ({
                eq: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
              }),
            }
          }
          return {}
        },
      }

      const manager = new CustomerDataRetentionManager()
      const result = await manager.cascadeCustomerDataDeletionAsync({
        requestId: 'del-req-001',
        workspaceId,
        customerId,
        client: mockClient as any,
      })

      // Strict assertions: Must not return fixed 5/8/2 numbers, but real affected records
      expect(result.affectedRecords.conversationsAnonymized).toBe(3)
      expect(result.affectedRecords.reservationPiiRedacted).toBe(1)
      expect(result.status).toBe('PARTIAL_LEGAL_HOLD')
      expect(optOutRecorded).toBe(true)
    })
  })

  describe('2. Opt-out Customer Automated Response Block Guard', () => {
    it('fails closed and blocks DM/comment automated reply when customer is in opt-out registry', async () => {
      const mockMetaProvider = {
        sendDirectMessage: vi.fn(),
      }

      const mockClient = {
        from: (table: string) => {
          if (table === 'channel_response_jobs') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'job-optout-1',
                      workspace_id: workspaceId,
                      channel_connection_id: 'conn-1',
                      response_kind: 'instagram_dm',
                      external_target_id: customerId,
                      draft_text: '안녕하세요! 문의주신 예약 안내드립니다.',
                      status: 'claimed',
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }
          }
          if (table === 'channel_connections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'conn-1',
                      workspace_id: workspaceId,
                      channel: 'instagram',
                      status: 'active',
                      access_token: 'valid-token',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'customer_opt_outs') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'opt-1', customer_id: customerId, workspace_id: workspaceId },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'channel_consents') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        consent_tier: 'AUTONOMOUS_DELEGATION',
                        status: 'ACTIVE',
                        capabilities: { reply_dm: true },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }
        },
      }

      const result = await executeResponseJobDelivery({
        client: mockClient as any,
        jobId: 'job-optout-1',
        actorUserId: 'usr-admin',
        metaProvider: mockMetaProvider as any,
      })

      // Strict assertions: External DM MUST NOT be sent, job must be BLOCKED
      expect(mockMetaProvider.sendDirectMessage).not.toHaveBeenCalled()
      expect(result.status).toBe('BLOCKED')
      expect(result.errorCode).toBe('CUSTOMER_OPTED_OUT')
    })
  })
})
