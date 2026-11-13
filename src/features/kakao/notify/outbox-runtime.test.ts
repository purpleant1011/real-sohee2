import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationOutboxRuntime,
} from './outbox-runtime'
import type { SolapiEnv } from './solapi-factory'
import type {
  Job,
  SendFn,
} from './outbox-processor'
import type { SupabaseOutboxClient } from './supabase-outbox-ports'
import type {
  InformationalEvidenceReader,
  TemplateApprovalReader,
} from './outbox-repository'

describe('createNotificationOutboxRuntime', () => {
  const validTemplateIds = JSON.stringify({
    SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP240001',
    SOHEE_BOOKING_CHANGED_V1: 'KA01TP240002',
    SOHEE_BOOKING_CANCELLED_V1: 'KA01TP240003',
    SOHEE_PAYMENT_CONFIRMED_V1: 'KA01TP240004',
    SOHEE_REMINDER_24H_V1: 'KA01TP240005',
    SOHEE_REMINDER_2H_V1: 'KA01TP240006',
  })

  const validEnv: SolapiEnv = {
    KAKAO_OUTBOX_ENABLED: 'true',
    SOLAPI_ENABLED: 'true',
    SOLAPI_API_KEY: 'test-api-key',
    SOLAPI_API_SECRET: 'test-api-secret',
    SOLAPI_PF_ID: 'test-pf-id',
    SOLAPI_WEBHOOK_SECRET: 'test-webhook-secret',
    SOLAPI_TEMPLATE_IDS: validTemplateIds,
  }

  const dummyJob: Job = {
    id: 'job-001',
    workspaceId: 'ws-111',
    reservationId: 'res-222',
    reservationUpdatedAt: '2026-11-06T10:00:00.000Z',
    event: 'BOOKING_CONFIRMED',
    dueAt: '2026-11-06T10:00:00.000Z',
  }

  function createMockSupabaseClient(overrides: {
    jobs?: Job[]
    reservationRow?: Record<string, unknown> | null
    businessProfileRow?: Record<string, unknown> | null
  } = {}): {
    client: SupabaseOutboxClient
    rpcMock: ReturnType<typeof vi.fn>
    fromMock: ReturnType<typeof vi.fn>
  } {
    const rpcMock = vi.fn().mockImplementation((fn: string) => {
      if (fn === 'claim_kakao_notification_job') {
        return Promise.resolve({ data: true, error: null })
      }
      if (fn === 'mark_kakao_notification_sending') {
        return Promise.resolve({ data: true, error: null })
      }
      if (fn === 'finish_kakao_notification_job') {
        return Promise.resolve({ data: true, error: null })
      }
      if (fn === 'expire_kakao_notification_jobs') {
        return Promise.resolve({ data: 0, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'kakao_notification_outbox') {
        return {
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: overrides.jobs ?? [
                    {
                      id: dummyJob.id,
                      workspace_id: dummyJob.workspaceId,
                      reservation_id: dummyJob.reservationId,
                      reservation_updated_at: dummyJob.reservationUpdatedAt,
                      event: dummyJob.event,
                      due_at: dummyJob.dueAt,
                      status: 'READY',
                      lease_until: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'reservations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: overrides.reservationRow !== undefined
                    ? overrides.reservationRow
                    : {
                        id: dummyJob.reservationId,
                        workspace_id: dummyJob.workspaceId,
                        status: 'CONFIRMED',
                        customer_id: 'cust-1',
                        customer_name: '홍길동',
                        customer_phone: '010-1234-5678',
                        service_name: '헤어 컷',
                        metadata: { bookingStartsAt: '2026-11-07T10:00:00.000Z' },
                        updated_at: '2026-11-06T10:00:00.000Z',
                      },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'business_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: overrides.businessProfileRow !== undefined
                  ? overrides.businessProfileRow
                  : {
                      business_name: '소희 헤어 살롱',
                      location: '서울시 강남구 테헤란로 123',
                    },
                error: null,
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn(),
      }
    })

    const client: SupabaseOutboxClient = {
      rpc: rpcMock,
      from: fromMock as unknown as SupabaseOutboxClient['from'],
    }

    return { client, rpcMock, fromMock }
  }

  const validEvidenceReader: InformationalEvidenceReader = vi.fn().mockResolvedValue({
    granted: true,
    subjectPhone: '01012345678',
    workspaceId: dummyJob.workspaceId,
    reservationId: dummyJob.reservationId,
  })

  const validApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
    approved: true,
    templateId: 'KA01TP240001',
  })

  const validSend: SendFn = vi.fn().mockResolvedValue({ accepted: true })

  describe('closure only run: 보안 및 비밀값 격리', () => {
    it('반환 객체는 오직 run 함수만 노출하며 env, client, secrets 프로퍼티를 노출하지 않는다', () => {
      const { client } = createMockSupabaseClient()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: validSend,
      })

      expect(Object.keys(runtime)).toEqual(['run'])
      expect(typeof runtime.run).toBe('function')

      const json = JSON.stringify(runtime)
      expect(json).toBe('{}')
      expect(json).not.toContain('test-api-key')
      expect(json).not.toContain('test-api-secret')
      expect(json).not.toContain('test-webhook-secret')
    })
  })

  describe('disabled 조건 검증 (부작용 0)', () => {
    it('KAKAO_OUTBOX_ENABLED가 "true"가 아니면 disabled 상태이며 DB query/rpc/send 모두 0회 호출된다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: { ...validEnv, KAKAO_OUTBOX_ENABLED: 'false' },
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: sendMock,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(result.processed).toBe(0)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('SOLAPI_ENABLED가 "true"가 아니면 disabled 상태이며 부작용이 0이다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: { ...validEnv, SOLAPI_ENABLED: 'false' },
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: sendMock,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('필수 환경변수 키가 누락되어 readiness.configurationReady가 false인 경우 disabled로 처리된다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: { ...validEnv, SOLAPI_API_SECRET: '' },
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: sendMock,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('evidenceReader가 주입되지 않은 경우 disabled 상태이며 DB/query/send 호출이 없다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: undefined,
        templateApprovalReader: validApprovalReader,
        send: sendMock,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('templateApprovalReader가 주입되지 않은 경우 disabled 상태이며 부작용이 0이다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: undefined,
        send: sendMock,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('send가 주입되지 않은 경우 disabled 상태이며 fallback send는 네트워크 없이 거부만 한다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: undefined,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(false)
      expect(rpcMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
    })
  })

  describe('enabled 상태 정상 처리 및 승인/결과불명(UNKNOWN) 격리', () => {
    it('모든 조건이 충족되면 run 실행 시 작업을 조회하고 정상 발송(SENT) 처리한다', async () => {
      const { client, rpcMock, fromMock } = createMockSupabaseClient()
      const sendMock = vi.fn().mockResolvedValue({ accepted: true })
      const now = new Date('2026-11-06T10:00:00.000Z')

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: sendMock,
        now,
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.SENT).toBe(1)
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(rpcMock).toHaveBeenCalledWith('expire_kakao_notification_jobs')
      expect(fromMock).toHaveBeenCalledWith('kakao_notification_outbox')
      expect(fromMock).toHaveBeenCalledWith('reservations')
      expect(fromMock).toHaveBeenCalledWith('business_profiles')
    })

    it('승인리더 존재자체!=승인: templateApproval이 false면 해당 job은 BLOCKED 상태로 정산되고 send는 호출되지 않는다', async () => {
      const { client } = createMockSupabaseClient()
      const sendMock = vi.fn()
      const unapprovedReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: false,
        templateId: 'KA01TP240001',
      })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: unapprovedReader,
        send: sendMock,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.BLOCKED).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('send 실패(throw) 시 UNKNOWN 상태로 전이되고 자체 자동 재전송(재시도)을 수행하지 않는다', async () => {
      const { client } = createMockSupabaseClient()
      const throwingSend: SendFn = vi.fn().mockRejectedValue(new Error('Solapi network drop 504'))

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: validEvidenceReader,
        templateApprovalReader: validApprovalReader,
        send: throwingSend,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()
      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.UNKNOWN).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(throwingSend).toHaveBeenCalledTimes(1) // 자동 재시도 없음
    })

    describe('KAKAO_OUTBOX_TEST_ALLOWLIST 시험 발송용 게이트 연동', () => {
      it('KAKAO_OUTBOX_TEST_ALLOWLIST 미설정 시 기존 동작 유지하여 정상 발송(SENT)을 수행한다', async () => {
        const { client } = createMockSupabaseClient()
        const sendMock = vi.fn().mockResolvedValue({ accepted: true })

        const runtime = createNotificationOutboxRuntime({
          client,
          env: { ...validEnv, KAKAO_OUTBOX_TEST_ALLOWLIST: undefined },
          evidenceReader: validEvidenceReader,
          templateApprovalReader: validApprovalReader,
          send: sendMock,
          now: new Date('2026-11-06T10:00:00.000Z'),
        })

        const result = await runtime.run()
        expect(result.enabled).toBe(true)
        expect(result.processed).toBe(1)
        expect(result.counts.SENT).toBe(1)
        expect(sendMock).toHaveBeenCalledTimes(1)
      })

      it('KAKAO_OUTBOX_TEST_ALLOWLIST에 예약 번호가 포함되어 있으면 정상 발송(SENT)한다', async () => {
        const { client } = createMockSupabaseClient()
        const sendMock = vi.fn().mockResolvedValue({ accepted: true })

        const runtime = createNotificationOutboxRuntime({
          client,
          env: {
            ...validEnv,
            KAKAO_OUTBOX_TEST_ALLOWLIST: '010-1234-5678, 010-9999-8888',
          },
          evidenceReader: validEvidenceReader,
          templateApprovalReader: validApprovalReader,
          send: sendMock,
          now: new Date('2026-11-06T10:00:00.000Z'),
        })

        const result = await runtime.run()
        expect(result.enabled).toBe(true)
        expect(result.processed).toBe(1)
        expect(result.counts.SENT).toBe(1)
        expect(sendMock).toHaveBeenCalledTimes(1)
      })

      it('KAKAO_OUTBOX_TEST_ALLOWLIST에 예약 번호가 포함되어 있지 않으면 BLOCKED 처리되고 send는 0회 호출된다', async () => {
        const { client } = createMockSupabaseClient()
        const sendMock = vi.fn().mockResolvedValue({ accepted: true })

        const runtime = createNotificationOutboxRuntime({
          client,
          env: {
            ...validEnv,
            KAKAO_OUTBOX_TEST_ALLOWLIST: '010-9999-8888, 010-7777-6666',
          },
          evidenceReader: validEvidenceReader,
          templateApprovalReader: validApprovalReader,
          send: sendMock,
          now: new Date('2026-11-06T10:00:00.000Z'),
        })

        const result = await runtime.run()
        expect(result.enabled).toBe(true)
        expect(result.processed).toBe(1)
        expect(result.counts.BLOCKED).toBe(1)
        expect(result.counts.SENT).toBe(0)
        expect(sendMock).not.toHaveBeenCalled()
      })

      it('KAKAO_OUTBOX_TEST_ALLOWLIST가 유효 항목 0개인 경우 fail-closed(전원 차단)되어 send 0회로 BLOCKED 된다', async () => {
        const { client } = createMockSupabaseClient()
        const sendMock = vi.fn().mockResolvedValue({ accepted: true })

        const runtime = createNotificationOutboxRuntime({
          client,
          env: {
            ...validEnv,
            KAKAO_OUTBOX_TEST_ALLOWLIST: 'invalid, not-a-number, 02-123-4567',
          },
          evidenceReader: validEvidenceReader,
          templateApprovalReader: validApprovalReader,
          send: sendMock,
          now: new Date('2026-11-06T10:00:00.000Z'),
        })

        const result = await runtime.run()
        expect(result.enabled).toBe(true)
        expect(result.processed).toBe(1)
        expect(result.counts.BLOCKED).toBe(1)
        expect(result.counts.SENT).toBe(0)
        expect(sendMock).not.toHaveBeenCalled()
      })

      it('런타임 결과 객체에 KAKAO_OUTBOX_TEST_ALLOWLIST 환경변수나 전화번호가 노출되지 않는다', async () => {
        const { client } = createMockSupabaseClient()
        const secretPhone = '01012345678'
        const runtime = createNotificationOutboxRuntime({
          client,
          env: {
            ...validEnv,
            KAKAO_OUTBOX_TEST_ALLOWLIST: secretPhone,
          },
          evidenceReader: validEvidenceReader,
          templateApprovalReader: validApprovalReader,
          send: vi.fn().mockResolvedValue({ accepted: true }),
          now: new Date('2026-11-06T10:00:00.000Z'),
        })

        const result = await runtime.run()
        const serialized = JSON.stringify(result)
        expect(serialized).not.toContain(secretPhone)
        expect(serialized).not.toContain('12345678')
        expect(serialized).not.toContain('KAKAO_OUTBOX_TEST_ALLOWLIST')
      })
    })
  })
})
