import { describe, expect, it, vi } from 'vitest'
import {
  runNotificationOutboxBatch,
  DEFAULT_OUTBOX_BATCH_LIMIT,
  type OutboxSourcePort,
} from './outbox-runner'
import {
  type InformationalEvidence,
  type Job,
  type OutboxProcessorDeps,
  type ReservationSnapshot,
  type TemplateApproval,
} from './outbox-processor'
import {
  SupabaseNotificationOutboxStore,
  type OutboxSupabaseRpcClient,
} from './outbox-store'

describe('outbox-runner: runNotificationOutboxBatch', () => {
  const baseJob1: Job = {
    id: 'job-uuid-001',
    workspaceId: 'ws-456',
    reservationId: 'res-789',
    reservationUpdatedAt: '2026-11-06T10:00:00.000Z',
    event: 'BOOKING_CONFIRMED',
    dueAt: '2026-11-06T10:00:00.000Z',
  }

  const baseJob2: Job = {
    id: 'job-uuid-002',
    workspaceId: 'ws-456',
    reservationId: 'res-790',
    reservationUpdatedAt: '2026-11-06T10:00:00.000Z',
    event: 'BOOKING_CONFIRMED',
    dueAt: '2026-11-06T10:00:00.000Z',
  }

  const baseSnapshot: ReservationSnapshot = {
    workspaceId: 'ws-456',
    reservationId: 'res-789',
    version: '2026-11-06T10:00:00.000Z',
    status: 'CONFIRMED',
    customerId: 'cust-001',
    phone: '010-1234-5678',
  }

  const baseEvidence: InformationalEvidence = {
    granted: true,
    subjectPhone: '010-1234-5678',
    workspaceId: 'ws-456',
    reservationId: 'res-789',
  }

  const baseApproval: TemplateApproval = {
    approved: true,
    templateId: 'tpl-confirmed-001',
  }

  function createMockProcessorDeps(overrides: Partial<OutboxProcessorDeps> = {}) {
    const claimMock = vi.fn().mockResolvedValue('lease-token-abc')
    const markSendingMock = vi.fn().mockResolvedValue(true)
    const finishMock = vi.fn().mockResolvedValue(true)

    const getCurrentReservationMock = vi.fn().mockImplementation(async (wsId, resId) => ({
      ...baseSnapshot,
      workspaceId: wsId,
      reservationId: resId,
    }))
    const getInformationalEvidenceMock = vi.fn().mockImplementation(async (snap) => ({
      ...baseEvidence,
      workspaceId: snap.workspaceId,
      reservationId: snap.reservationId,
      subjectPhone: snap.phone,
    }))
    const getTemplateApprovalMock = vi.fn().mockResolvedValue({ ...baseApproval })
    const sendMock = vi.fn().mockResolvedValue({ accepted: true })

    const deps: OutboxProcessorDeps = {
      enabled: true,
      now: new Date('2026-11-06T10:00:00.000Z'),
      repository: {
        getCurrentReservation: getCurrentReservationMock,
        getInformationalEvidence: getInformationalEvidenceMock,
        getTemplateApproval: getTemplateApprovalMock,
      },
      store: {
        claim: claimMock,
        markSending: markSendingMock,
        finish: finishMock,
      },
      send: sendMock,
      ...overrides,
    }

    return {
      deps,
      claimMock,
      markSendingMock,
      finishMock,
      getCurrentReservationMock,
      getInformationalEvidenceMock,
      getTemplateApprovalMock,
      sendMock,
    }
  }

  function createMockSource(overrides: Partial<OutboxSourcePort> = {}) {
    const listDueJobsMock =
      overrides.listDueJobs ??
      vi.fn<(limit: number, now: Date) => Promise<Job[]>>().mockResolvedValue([baseJob1])
    const expireSendingMock =
      overrides.expireSending ??
      vi.fn<() => Promise<number>>().mockResolvedValue(0)

    const source: OutboxSourcePort = {
      listDueJobs: listDueJobsMock,
      expireSending: expireSendingMock,
      ...overrides,
    }

    return {
      source,
      listDueJobsMock,
      expireSendingMock,
    }
  }

  describe('1. limit parameter validation', () => {
    it('throws a static error without provider text when limit is invalid', async () => {
      const { deps } = createMockProcessorDeps()
      const { source } = createMockSource()

      const invalidLimits = [0, -1, 51, 1.5, NaN, '20' as unknown as number]

      for (const invalid of invalidLimits) {
        await expect(
          runNotificationOutboxBatch({
            processorDeps: deps,
            source,
            limit: invalid,
          }),
        ).rejects.toThrow('Invalid limit: limit must be an integer between 1 and 50')
      }
    })

    it('uses DEFAULT_OUTBOX_BATCH_LIMIT (20) when limit is omitted', async () => {
      const { deps } = createMockProcessorDeps()
      const { source, listDueJobsMock } = createMockSource()

      await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(listDueJobsMock).toHaveBeenCalledWith(DEFAULT_OUTBOX_BATCH_LIMIT, expect.any(Date))
    })
  })

  describe('2. disabled behavior', () => {
    it('calls nothing (source=0, store=0, send=0, now=0) when disabled', async () => {
      const nowMock = vi.fn().mockReturnValue(new Date('2026-11-06T10:00:00.000Z'))
      const { deps, claimMock, sendMock } = createMockProcessorDeps({
        enabled: false,
        now: nowMock,
      })
      const { source, listDueJobsMock, expireSendingMock } = createMockSource()

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(nowMock).not.toHaveBeenCalled()
      expect(expireSendingMock).not.toHaveBeenCalled()
      expect(listDueJobsMock).not.toHaveBeenCalled()
      expect(claimMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()

      expect(result).toEqual({
        enabled: false,
        processed: 0,
        counts: {
          DISABLED: 0,
          NOT_DUE: 0,
          CLAIM_FAILED: 0,
          BLOCKED: 0,
          SUPERSEDED: 0,
          CAS_LOST: 0,
          UNKNOWN: 0,
          SENT: 0,
        },
        errors: 0,
        expired: 0,
      })
    })
  })

  describe('2-1. now evaluation & validity check', () => {
    it('returns errors: 1 and stops before any source/store calls if now() throws', async () => {
      const throwingNow = vi.fn().mockImplementation(() => {
        throw new Error('Fatal now calculation error')
      })
      const { deps, claimMock, sendMock } = createMockProcessorDeps({
        now: throwingNow,
      })
      const { source, listDueJobsMock, expireSendingMock } = createMockSource()

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(throwingNow).toHaveBeenCalledTimes(1)
      expect(expireSendingMock).not.toHaveBeenCalled()
      expect(listDueJobsMock).not.toHaveBeenCalled()
      expect(claimMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()

      expect(result).toEqual({
        enabled: true,
        processed: 0,
        counts: {
          DISABLED: 0,
          NOT_DUE: 0,
          CLAIM_FAILED: 0,
          BLOCKED: 0,
          SUPERSEDED: 0,
          CAS_LOST: 0,
          UNKNOWN: 0,
          SENT: 0,
        },
        errors: 1,
        expired: 0,
      })
    })

    it('returns errors: 1 and stops if now is an Invalid Date', async () => {
      const { deps } = createMockProcessorDeps({
        now: new Date('invalid date string'),
      })
      const { source, listDueJobsMock, expireSendingMock } = createMockSource()

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(expireSendingMock).not.toHaveBeenCalled()
      expect(listDueJobsMock).not.toHaveBeenCalled()
      expect(result.errors).toBe(1)
      expect(result.processed).toBe(0)
    })
  })

  describe('3. source failures & private canary isolation', () => {
    const CANARY_SECRET = 'CANARY_SENSITIVE_SECRET_TOKEN_DO_NOT_LEAK'

    it('handles expireSending failure: records error, stops immediately, leaks no canary', async () => {
      const { deps, claimMock } = createMockProcessorDeps()
      const { source, listDueJobsMock } = createMockSource({
        expireSending: vi.fn().mockRejectedValue(new Error(`Database error: ${CANARY_SECRET}`)),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.enabled).toBe(true)
      expect(result.errors).toBe(1)
      expect(result.processed).toBe(0)
      expect(result.expired).toBe(0)
      expect(listDueJobsMock).not.toHaveBeenCalled()
      expect(claimMock).not.toHaveBeenCalled()

      // 결과 객체 직렬화 시 canary 문자열이나 민감 정보가 전혀 포함되지 않아야 함
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(CANARY_SECRET)
      expect(Object.keys(result).sort()).toEqual(['counts', 'enabled', 'errors', 'expired', 'processed'].sort())
    })

    it('handles listDueJobs failure: records error, stops, leaks no canary', async () => {
      const { deps, claimMock } = createMockProcessorDeps()
      const { source } = createMockSource({
        expireSending: vi.fn().mockResolvedValue(3),
        listDueJobs: vi.fn().mockRejectedValue(new Error(`RPC list error: ${CANARY_SECRET}`)),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.enabled).toBe(true)
      expect(result.errors).toBe(1)
      expect(result.processed).toBe(0)
      expect(result.expired).toBe(3)
      expect(claimMock).not.toHaveBeenCalled()

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(CANARY_SECRET)
    })

    it('strictly validates expireSending return value (Number.isInteger && isFinite && >= 0); stops and errors: 1 on invalid', async () => {
      const invalidExpireValues = [-1, 1.5, NaN, Infinity, '5' as unknown as number, null as unknown as number]

      for (const invalidVal of invalidExpireValues) {
        const { deps } = createMockProcessorDeps()
        const { source, listDueJobsMock } = createMockSource({
          expireSending: vi.fn().mockResolvedValue(invalidVal),
        })

        const result = await runNotificationOutboxBatch({
          processorDeps: deps,
          source,
        })

        expect(result.errors).toBe(1)
        expect(result.expired).toBe(0)
        expect(listDueJobsMock).not.toHaveBeenCalled()
      }
    })

    it('strictly checks that listDueJobs returns an Array; stops and errors: 1 if non-array', async () => {
      const nonArrayReturns = [null, undefined, { jobs: [] }, 123, 'not-an-array']

      for (const nonArray of nonArrayReturns) {
        const { deps, claimMock } = createMockProcessorDeps()
        const { source } = createMockSource({
          expireSending: vi.fn().mockResolvedValue(2),
          listDueJobs: vi.fn().mockResolvedValue(nonArray as unknown as Job[]),
        })

        const result = await runNotificationOutboxBatch({
          processorDeps: deps,
          source,
        })

        expect(result.errors).toBe(1)
        expect(result.processed).toBe(0)
        expect(result.expired).toBe(2)
        expect(claimMock).not.toHaveBeenCalled()
      }
    })
  })

  describe('3-1. malformed row handling in due jobs', () => {
    it('skips malformed rows, increments errors++, leaks no raw data, and processes valid jobs', async () => {
      const malformedRows = [
        null,
        undefined,
        'string-instead-of-object',
        {},
        { id: '' },
        { id: '   ' },
        { noIdProperty: 123 },
      ]
      const mixedJobs = [...malformedRows, baseJob1] as unknown as Job[]

      const { deps, sendMock } = createMockProcessorDeps()
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue(mixedJobs),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      // malformed row 7개는 errors++ 되고 건너뜀
      expect(result.errors).toBe(7)
      // 유효한 baseJob1 1개는 정상 처리
      expect(result.processed).toBe(1)
      expect(result.counts.SENT).toBe(1)
      expect(sendMock).toHaveBeenCalledTimes(1)

      // 직렬화 결과에 malformed row 데이터나 PII 없음
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('string-instead-of-object')
      expect(serialized).not.toContain('noIdProperty')
    })
  })

  describe('4. duplicate job deduplication', () => {
    it('processes duplicate job IDs only once', async () => {
      const { deps, sendMock } = createMockProcessorDeps()
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1, baseJob1, baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.processed).toBe(1)
      expect(result.counts.SENT).toBe(1)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('5. slice up to limit', () => {
    it('slices returned jobs to effective limit', async () => {
      const jobs = Array.from({ length: 15 }, (_, i) => ({
        ...baseJob1,
        id: `job-bulk-${i}`,
      }))
      const { deps, sendMock } = createMockProcessorDeps()
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue(jobs),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
        limit: 5,
      })

      expect(result.processed).toBe(5)
      expect(sendMock).toHaveBeenCalledTimes(5)
    })
  })

  describe('6. unapproved / no evidence job BLOCKED and send 0', () => {
    it('blocks unapproved template job with 0 send calls', async () => {
      const { deps, sendMock } = createMockProcessorDeps({
        repository: {
          getCurrentReservation: vi.fn().mockResolvedValue(baseSnapshot),
          getInformationalEvidence: vi.fn().mockResolvedValue(baseEvidence),
          getTemplateApproval: vi.fn().mockResolvedValue({ approved: false, templateId: '' }),
        },
      })
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.processed).toBe(1)
      expect(result.counts.BLOCKED).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('blocks missing evidence job with 0 send calls', async () => {
      const { deps, sendMock } = createMockProcessorDeps({
        repository: {
          getCurrentReservation: vi.fn().mockResolvedValue(baseSnapshot),
          getInformationalEvidence: vi.fn().mockResolvedValue(null),
          getTemplateApproval: vi.fn().mockResolvedValue(baseApproval),
        },
      })
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.processed).toBe(1)
      expect(result.counts.BLOCKED).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('7. post-send UNKNOWN counted 1 and never retried', () => {
    it('counts UNKNOWN exactly once when send throws and never retries', async () => {
      const sendThrowMock = vi.fn().mockRejectedValue(new Error('Solapi network reset'))
      const { deps } = createMockProcessorDeps({
        send: sendThrowMock,
      })
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.processed).toBe(1)
      expect(result.counts.UNKNOWN).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendThrowMock).toHaveBeenCalledTimes(1)
    })

    it('counts UNKNOWN exactly once when send returns accepted: false and never retries', async () => {
      const sendRejectMock = vi.fn().mockResolvedValue({ accepted: false })
      const { deps } = createMockProcessorDeps({
        send: sendRejectMock,
      })
      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.processed).toBe(1)
      expect(result.counts.UNKNOWN).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendRejectMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('8. per-job exception isolation', () => {
    it('increments errors and continues to next job without retrying failed job', async () => {
      let nowCalls = 0
      const flakyNow = () => {
        nowCalls++
        if (nowCalls === 2) {
          // 1번째 호출은 runNotificationOutboxBatch 내부, 2번째 호출은 job1의 processNotificationJob 내부
          throw new Error('Fatal unhandled runtime exception on job 1')
        }
        return new Date('2026-11-06T10:00:00.000Z')
      }

      const { deps, sendMock } = createMockProcessorDeps({
        now: flakyNow,
      })

      const { source } = createMockSource({
        listDueJobs: vi.fn().mockResolvedValue([baseJob1, baseJob2]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(result.errors).toBe(1)
      expect(result.processed).toBe(1)
      expect(result.counts.SENT).toBe(1)
      expect(sendMock).toHaveBeenCalledTimes(1) // job 2만 send됨
    })
  })

  describe('9. 3-RPC exact order integration with SupabaseNotificationOutboxStore', () => {
    it('executes claim -> markSending -> finish in exact sequence via mock RPC client', async () => {
      const rpcCallOrder: string[] = []
      const mockRpcClient: OutboxSupabaseRpcClient = {
        async rpc<T = unknown>(fn: string, params: Record<string, unknown>) {
          rpcCallOrder.push(fn)
          if (fn === 'claim_kakao_notification_job') {
            return { data: true as unknown as T, error: null }
          }
          if (fn === 'mark_kakao_notification_sending') {
            return { data: true as unknown as T, error: null }
          }
          if (fn === 'finish_kakao_notification_job') {
            expect(params.p_status).toBe('SENT')
            return { data: true as unknown as T, error: null }
          }
          return { data: null, error: { message: 'unknown rpc' } }
        },
      }

      const fixedLease = '00000000-0000-0000-0000-000000000001'
      const realStore = new SupabaseNotificationOutboxStore(mockRpcClient, () => fixedLease)

      const { deps, sendMock } = createMockProcessorDeps({
        store: realStore,
      })

      const { source, expireSendingMock } = createMockSource({
        expireSending: vi.fn().mockResolvedValue(2),
        listDueJobs: vi.fn().mockResolvedValue([baseJob1]),
      })

      const result = await runNotificationOutboxBatch({
        processorDeps: deps,
        source,
      })

      expect(expireSendingMock).toHaveBeenCalledTimes(1)
      expect(rpcCallOrder).toEqual([
        'claim_kakao_notification_job',
        'mark_kakao_notification_sending',
        'finish_kakao_notification_job',
      ])
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(result).toEqual({
        enabled: true,
        processed: 1,
        counts: {
          DISABLED: 0,
          NOT_DUE: 0,
          CLAIM_FAILED: 0,
          BLOCKED: 0,
          SUPERSEDED: 0,
          CAS_LOST: 0,
          UNKNOWN: 0,
          SENT: 1,
        },
        errors: 0,
        expired: 2,
      })

      // 반환 결과에는 절대 job ids, phone, name, lease, 에러 원문 등 PII/내부 정보가 없어야 함
      const keys = Object.keys(result)
      expect(keys.sort()).toEqual(['counts', 'enabled', 'errors', 'expired', 'processed'].sort())
    })
  })
})
