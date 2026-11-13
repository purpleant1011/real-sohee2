import { describe, expect, it, vi } from 'vitest'
import { CustomerDataRetentionManager } from '@/features/privacy/customer-data-retention-lineage'
import { executeResponseJobDelivery } from '@/features/channels/responsive-employee-loop'

/**
 * ANI-1753 후속 — 스키마 드리프트 폐쇄(A그룹: 개인정보·수신거부) 회귀 테스트.
 *
 * 감사(docs/harness/SCHEMA-CODE-DRIFT-AUDIT-2026-10-23.md)에서 확인된 결함:
 *  - customer_opt_outs 테이블이 어떤 마이그레이션에도 없어 조회가 항상 실패했고,
 *    그 실패를 삼켜(fail-open) 수신거부 고객에게도 자동 응답을 보냈다.
 *  - customer_conversations / reservations 의 익명화 컬럼이 없어 update 가 400 으로 실패했고,
 *    빈 catch 블록이 그 실패를 삼켜 "익명화 완료"를 주장했다.
 */

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = 'cust-schema-drift-001'

interface UpdateCall {
  table: string
  payload: Record<string, unknown>
}

/**
 * 익명화 경로용 최소 Supabase 대역.
 * update 호출의 payload 를 그대로 기록해 "실제로 어떤 컬럼을 바꿨는지" 검증한다.
 */
function createAnonymizationClient(options: {
  conversationRows?: Array<{ id: string }>
  conversationError?: unknown
  reservationRows?: Array<{ id: string; status: string; total_amount_krw: number }>
  reservationError?: unknown
  reservationUpdateError?: unknown
  optOutError?: unknown
  attributionError?: unknown
}) {
  const updates: UpdateCall[] = []
  const upserts: Array<{ table: string; payload: Record<string, unknown> }> = []

  const client = {
    from(table: string) {
      if (table === 'customer_opt_outs') {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            upserts.push({ table, payload })
            return { error: options.optOutError ?? null }
          },
        }
      }
      if (table === 'customer_conversations') {
        return {
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload })
            const chain = {
              eq: () => chain,
              select: async () => ({
                data: options.conversationError ? null : (options.conversationRows ?? []),
                error: options.conversationError ?? null,
              }),
            }
            return chain
          },
        }
      }
      if (table === 'reservations') {
        return {
          select() {
            const chain = {
              eq: () => chain,
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({
                  data: options.reservationError ? null : (options.reservationRows ?? []),
                  error: options.reservationError ?? null,
                }).then(resolve),
            }
            return chain
          },
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload })
            const chain = {
              eq: () => chain,
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ error: options.reservationUpdateError ?? null }).then(resolve),
            }
            return chain
          },
        }
      }
      // ANI-1758: 코드가 없는 테이블명(attribution_events)을 쓰던 것을 정본
      // social_attribution_events 로 고쳤다.
      if (table === 'social_attribution_events') {
        return {
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload })
            const chain = {
              eq: () => chain,
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ error: options.attributionError ?? null }).then(resolve),
            }
            return chain
          },
        }
      }
      throw new Error(`unexpected table in anonymization test: ${table}`)
    },
  }

  return { client, updates, upserts }
}

describe('A. PII 익명화가 실제 컬럼을 갱신한다 (ANI-1753 후속)', () => {
  it('대화·예약·동의 레지스트리에 실제 컬럼 값을 써 넣고 변경 건수를 실제 행 수로 센다', async () => {
    const { client, updates, upserts } = createAnonymizationClient({
      conversationRows: [{ id: 'c1' }, { id: 'c2' }],
      reservationRows: [{ id: 'bk-1', status: 'CONFIRMED', total_amount_krw: 180000 }],
    })

    const result = await new CustomerDataRetentionManager().cascadeCustomerDataDeletionAsync({
      requestId: 'del-req-001',
      workspaceId: WORKSPACE_ID,
      customerId: CUSTOMER_ID,
      client,
    })

    const conversationUpdate = updates.find((u) => u.table === 'customer_conversations')
    expect(conversationUpdate).toBeDefined()
    expect(conversationUpdate?.payload).toMatchObject({
      content: '[PII_ANONYMIZED]',
      customer_name: '익명고객',
      is_anonymized: true,
    })
    expect(typeof conversationUpdate?.payload.anonymized_at).toBe('string')

    const reservationUpdate = updates.find((u) => u.table === 'reservations')
    expect(reservationUpdate).toBeDefined()
    expect(reservationUpdate?.payload).toMatchObject({
      customer_name: '익명고객',
      customer_phone: '010-****-0000',
      customer_email: null,
      pii_redacted: true,
    })
    expect(typeof reservationUpdate?.payload.anonymized_at).toBe('string')

    // 수신거부 원장에도 기록이 남아야 한다(테이블이 실제로 존재해야 통과).
    expect(upserts[0]).toMatchObject({
      table: 'customer_opt_outs',
      payload: { workspace_id: WORKSPACE_ID, customer_id: CUSTOMER_ID, deletion_request_id: 'del-req-001' },
    })

    // 고정 숫자가 아니라 실제 반환된 행 수를 센다.
    expect(result.affectedRecords.conversationsAnonymized).toBe(2)
    expect(result.affectedRecords.reservationPiiRedacted).toBe(1)
    expect(result.status).toBe('PARTIAL_LEGAL_HOLD')
    expect(result.failedStages).toEqual([])
  })

  it('익명화 update 가 DB 오류를 돌려주면 삼키지 않고 NEEDS_REVIEW 로 알린다', async () => {
    const { client } = createAnonymizationClient({
      conversationError: { code: '42703', message: 'column "is_anonymized" does not exist' },
      reservationRows: [],
      attributionError: { code: '42P01', message: 'relation "social_attribution_events" does not exist' },
    })

    const result = await new CustomerDataRetentionManager().cascadeCustomerDataDeletionAsync({
      requestId: 'del-req-002',
      workspaceId: WORKSPACE_ID,
      customerId: CUSTOMER_ID,
      client,
    })

    expect(result.status).toBe('NEEDS_REVIEW')
    expect(result.failedStages).toContain('CONVERSATIONS')
    expect(result.failedStages).toContain('ATTRIBUTION_EVENTS')
    expect(result.affectedRecords.conversationsAnonymized).toBe(0)
    expect(result.auditNotice).toContain('비식별화가 완료되지 않았습니다')
  })
})

describe('B. 수신거부 가드는 fail-closed 다 (ANI-1753 후속)', () => {
  function createDeliveryClient(optOutLookup: () => Promise<unknown>) {
    const jobUpdates: Array<Record<string, unknown>> = []
    return {
      jobUpdates,
      client: {
        from(table: string) {
          if (table === 'channel_response_jobs') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'job-1',
                      workspace_id: WORKSPACE_ID,
                      channel_connection_id: 'conn-1',
                      response_kind: 'instagram_dm',
                      external_target_id: CUSTOMER_ID,
                      draft_text: '안내드립니다.',
                      status: 'claimed',
                    },
                    error: null,
                  }),
                }),
              }),
              update: (payload: Record<string, unknown>) => {
                jobUpdates.push(payload)
                const chain = {
                  eq: () => chain,
                  then: (resolve: (value: unknown) => unknown) =>
                    Promise.resolve({ error: null }).then(resolve),
                }
                return chain
              },
            }
          }
          if (table === 'channel_connections') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'conn-1',
                      workspace_id: WORKSPACE_ID,
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
                  eq: () => ({ maybeSingle: optOutLookup }),
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
      },
    }
  }

  it('수신거부 등록 고객이면 실제 발송 없이 BLOCKED 로 끝난다', async () => {
    const { client } = createDeliveryClient(async () => ({
      data: { id: 'opt-1' },
      error: null,
    }))
    const provider = { sendDirectMessage: vi.fn(), sendCommentReply: vi.fn() }

    const result = await executeResponseJobDelivery({
      client: client as any,
      jobId: 'job-1',
      actorUserId: 'usr-1',
      metaProvider: provider as any,
    })

    expect(provider.sendDirectMessage).not.toHaveBeenCalled()
    expect(result.status).toBe('BLOCKED')
    expect(result.errorCode).toBe('CUSTOMER_OPTED_OUT')
  })

  it('수신거부 조회가 DB 오류를 돌려주면(테이블 부재 포함) 발송하지 않고 차단한다', async () => {
    const { client, jobUpdates } = createDeliveryClient(async () => ({
      data: null,
      error: { code: '42P01', message: 'relation "public.customer_opt_outs" does not exist' },
    }))
    const provider = { sendDirectMessage: vi.fn(), sendCommentReply: vi.fn() }

    const result = await executeResponseJobDelivery({
      client: client as any,
      jobId: 'job-1',
      actorUserId: 'usr-1',
      metaProvider: provider as any,
    })

    expect(provider.sendDirectMessage).not.toHaveBeenCalled()
    expect(result.status).toBe('BLOCKED')
    expect(result.errorCode).toBe('OPT_OUT_CHECK_UNAVAILABLE')
    // 차단 사유가 작업 원장에 남는다.
    expect(jobUpdates.some((u) => u.cancellation_reason === 'OPT_OUT_CHECK_UNAVAILABLE')).toBe(true)
  })

  it('수신거부 조회가 예외를 던져도 발송하지 않고 차단한다', async () => {
    const { client } = createDeliveryClient(async () => {
      throw new Error('network down')
    })
    const provider = { sendDirectMessage: vi.fn(), sendCommentReply: vi.fn() }

    const result = await executeResponseJobDelivery({
      client: client as any,
      jobId: 'job-1',
      actorUserId: 'usr-1',
      metaProvider: provider as any,
    })

    expect(provider.sendDirectMessage).not.toHaveBeenCalled()
    expect(result.status).toBe('BLOCKED')
    expect(result.errorCode).toBe('OPT_OUT_CHECK_UNAVAILABLE')
  })
})
