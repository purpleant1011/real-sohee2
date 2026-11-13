import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeMetaPublish } from '@/lib/external-actions/meta-action-executor'
import { executeResponseJobDelivery } from '@/features/channels/responsive-employee-loop'

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn().mockResolvedValue({
    accessToken: 'server-credential-token', externalAccountId: 'act-12345',
  }),
}))

vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn().mockResolvedValue({
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    ready: true,
    facts: {},
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }),
}))

describe('[RC-03][Regression] External Action Safety · Idempotency & RESULT_UNKNOWN (ANI-1328)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  let origAllowlist: string | undefined

  beforeEach(() => {
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  function createBaseMockClient(overrides: Record<string, any> = {}) {
    return {
      from: (table: string) => {
        if (overrides[table]) {
          return overrides[table]
        }
        if (table === 'channel_connections') {
          const connData = {
            id: 'conn-meta-1',
            workspace_id: workspaceId,
            channel: 'instagram',
            status: 'connected',
            external_account_id: 'act-12345',
          }
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => ({ data: connData, error: null }),
            single: async () => ({ data: connData, error: null }),
          }
          return {
            select: () => chain,
          }
        }
        if (table === 'system_kill_switches') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
                in: () => ({
                  then: (cb: any) => cb({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        // ANI-1758: 수신거부 가드 fail-closed. 이 테스트는 "미등록"을 명시한다.
        if (table === 'customer_opt_outs') {
          return {
            select: () => {
              const chain: any = {
                eq: () => chain,
                maybeSingle: async () => ({ data: null, error: null }),
              }
              return chain
            },
          }
        }
        if (table === 'channel_consents') {
          const consentData = {
            id: 'cst-1',
            workspace_id: workspaceId,
            channel: 'instagram',
            consent_tier: 'AUTONOMOUS_DELEGATION',
            status: 'ACTIVE',
            capabilities: { publish: true, reply_dm: true, dm_reply: true, reply_comments: true },
          }
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => ({ data: consentData, error: null }),
            single: async () => ({ data: consentData, error: null }),
          }
          return { select: () => chain }
        }
        if (table === 'consent_ledger') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: 'cst-1', status: 'GRANTED', capability: 'publish' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'external_action_requests') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            insert: async () => ({ error: null }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }
        }
        if (table === 'external_action_attempts') {
          return {
            insert: async () => ({ error: null }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }
        }
        if (table === 'external_action_receipts') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        if (table === 'audit_events') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        // ANI-1753 후속: 수신거부 가드가 fail-closed 로 바뀌면서 이 조회가 필수 경로가 됐다.
        // 이 고객은 수신거부하지 않은 상태(data: null)이므로 발송이 계속 진행된다.
        if (table === 'customer_opt_outs') {
          const optOutChain: any = {
            eq: () => optOutChain,
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: null }),
          }
          return { select: () => optOutChain }
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
              single: async () => ({ data: null, error: null }),
            }),
          }),
        }
      },
    }
  }

  describe('1. Timeout Isolation to RESULT_UNKNOWN (No False Failed Classification)', () => {
    it('isolates network/provider timeout to RESULT_UNKNOWN and prevents blind retry', async () => {
      let requestStatus = ''
      let attemptStatus = ''
      let receiptInserted: any = null

      const mockClient = createBaseMockClient({
        external_action_requests: {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: async () => ({ error: null }),
          update: (updates: any) => ({
            eq: () => {
              requestStatus = updates.status
              return Promise.resolve({ error: null })
            },
          }),
        },
        external_action_attempts: {
          insert: async () => ({ error: null }),
          update: (updates: any) => ({
            eq: () => {
              attemptStatus = updates.status
              return Promise.resolve({ error: null })
            },
          }),
        },
        external_action_receipts: {
          insert: async (row: any) => {
            receiptInserted = row
            return { error: null }
          },
        },
      })

      const mockIgProvider = {
        publish: vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT - network socket timeout')),
      }

      const result = await executeMetaPublish({
        client: mockClient as any,
        adminClient: mockClient as any,
        workspaceId,
        channel: 'instagram',
        actorUserId: 'usr-admin',
        caption: '안전한 바이름 소식 [SOHEE_VERIFIED_77]',
        mediaUrls: ['https://example.com/storage/byreum-real-eyebrow.jpg'],
        idempotencyKey: 'idemp-test-timeout-1',
        igProvider: mockIgProvider as any,
      })

      // Strict assertions: Timeout MUST NOT be treated as a plain 'FAILED'
      expect(result.status).toBe('RESULT_UNKNOWN')
      expect(result.errorCode).toBe('TIMEOUT_RESULT_UNKNOWN')
      expect(requestStatus).toBe('RESULT_UNKNOWN')
      expect(attemptStatus).toBe('RESULT_UNKNOWN')
      expect(receiptInserted).not.toBeNull()
      expect(receiptInserted?.reconcile_state).toBe('READBACK_REQUIRED')
    })
  })

  describe('2. Deterministic Idempotency & Pre-execution Duplication Guard', () => {
    it('returns existing execution receipt without invoking provider API on duplicated request', async () => {
      const mockIgPublish = vi.fn()

      const existingReceipt = {
        id: 'rcpt-existing-1',
        action_request_id: 'req-existing-1',
        receipt_kind: 'observed_result',
        provider_reference: 'existing-post',
        result_url: 'https://www.instagram.com/p/EXISTING123/',
      }

      const mockClient = createBaseMockClient({
        external_action_requests: {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'req-existing-1',
                    workspace_id: workspaceId,
                    status: 'succeeded',
                    channel: 'instagram', action_kind: 'feed_publish', target_external_id: 'act-12345',
                    exact_payload: { caption: '동일한 게시물 [SOHEE_VERIFIED_77]',
                      mediaUrls: ['https://example.com/storage/byreum-real-eyebrow.jpg'],
                      verificationCode: 'SOHEE_VERIFIED_77', isAiGenerated: false },
                    idempotency_key: 'idemp-duplicate-test',
                  },
                  error: null,
                }),
              }),
            }),
          }),
        },
        external_action_receipts: {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: existingReceipt, error: null }),
              }),
            }),
          }),
        },
      })

      const result = await executeMetaPublish({
        client: mockClient as any,
        adminClient: mockClient as any,
        workspaceId,
        channel: 'instagram',
        actorUserId: 'usr-admin',
        caption: '동일한 게시물 [SOHEE_VERIFIED_77]',
        mediaUrls: ['https://example.com/storage/byreum-real-eyebrow.jpg'],
        idempotencyKey: 'idemp-duplicate-test',
        verificationCode: 'SOHEE_VERIFIED_77',
        igProvider: { publish: mockIgPublish } as any,
      })

      // Provider API MUST NOT be called!
      expect(mockIgPublish).not.toHaveBeenCalled()
      expect(result.status).toBe('SUCCEEDED')
      expect(result.actionRequestId).toBe('req-existing-1')
      expect(result.receipt).toEqual(existingReceipt)
    })
  })

  describe('3. Responsive Employee Loop DM Timeout Isolation', () => {
    it('isolates DM send timeout to RESULT_UNKNOWN and creates READBACK_REQUIRED receipt', async () => {
      let attemptStatus = ''
      let receiptInserted: any = null

      const mockClient = createBaseMockClient({
        channel_response_jobs: {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'job-dm-timeout-1',
                  workspace_id: workspaceId,
                  channel: 'instagram',
                  response_kind: 'instagram_dm',
                  external_target_id: 'cust-ig-998',
                  draft_text: '예약 슬롯 안내드립니다.',
                  status: 'claimed',
                },
                error: null,
              }),
              maybeSingle: async () => ({
                data: {
                  id: 'job-dm-timeout-1',
                  workspace_id: workspaceId,
                  channel: 'instagram',
                  response_kind: 'instagram_dm',
                  external_target_id: 'cust-ig-998',
                  draft_text: '예약 슬롯 안내드립니다.',
                  status: 'claimed',
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        },
        external_action_requests: {
          insert: () => Promise.resolve({ error: null }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        },
        external_action_attempts: {
          insert: () => Promise.resolve({ error: null }),
          update: (updates: any) => ({
            eq: () => {
              attemptStatus = updates.status
              return Promise.resolve({ error: null })
            },
          }),
        },
        external_action_receipts: {
          insert: (row: any) => {
            receiptInserted = row
            return Promise.resolve({ error: null })
          },
        },
        channel_delivery_attempts: {
          insert: () => Promise.resolve({ error: null }),
        },
      })

      const mockProvider = {
        sendDirectMessage: vi.fn().mockRejectedValue(new Error('Gateway Timeout 504')),
      }

      const result = await executeResponseJobDelivery({
        client: mockClient as any,
        jobId: 'job-dm-timeout-1',
        actorUserId: 'usr-admin',
        metaProvider: mockProvider as any,
      })

      expect(result.status).toBe('RESULT_UNKNOWN')
      expect(result.errorCode).toBe('TIMEOUT_RESULT_UNKNOWN')
      expect(attemptStatus).toBe('RESULT_UNKNOWN')
      expect(receiptInserted?.reconcile_state).toBe('READBACK_REQUIRED')
    })
  })
})
