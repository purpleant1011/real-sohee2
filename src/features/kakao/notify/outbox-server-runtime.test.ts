import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runServerNotificationOutbox,
  SERVER_OUTBOX_LIMIT,
  type OutboxPolicyReadersFactory,
  type SolapiOutboxSenderFactory,
} from './outbox-server-runtime'
import type { SupabaseOutboxClient } from './supabase-outbox-ports'
import type { SolapiEnv } from './solapi-factory'

describe('runServerNotificationOutbox', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.KAKAO_OUTBOX_ENABLED
    delete process.env.SOLAPI_ENABLED
    delete process.env.SOLAPI_API_KEY
    delete process.env.SOLAPI_API_SECRET
    delete process.env.SOLAPI_PF_ID
    delete process.env.SOLAPI_WEBHOOK_SECRET
    delete process.env.SOLAPI_TEMPLATE_IDS
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('환경변수 플래그 사전 차단 (Fail-Closed)', () => {
    it('KAKAO_OUTBOX_ENABLED와 SOLAPI_ENABLED가 둘 다 미설정이면 adminClient 및 runtime을 호출하지 않고 disabled 통계를 반환한다', async () => {
      const createAdminClientMock = vi.fn()
      const createPolicyReadersMock = vi.fn()
      const createSenderMock = vi.fn()
      const createRuntimeMock = vi.fn()

      const result = await runServerNotificationOutbox({
        env: {},
        createAdminClient: createAdminClientMock,
        createPolicyReaders: createPolicyReadersMock,
        createSender: createSenderMock,
        createRuntime: createRuntimeMock,
      })

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

      expect(createAdminClientMock).not.toHaveBeenCalled()
      expect(createPolicyReadersMock).not.toHaveBeenCalled()
      expect(createSenderMock).not.toHaveBeenCalled()
      expect(createRuntimeMock).not.toHaveBeenCalled()
    })

    it('KAKAO_OUTBOX_ENABLED만 true이고 SOLAPI_ENABLED가 false이면 호출 0건 격리된다', async () => {
      const createAdminClientMock = vi.fn()
      const createPolicyReadersMock = vi.fn()

      const result = await runServerNotificationOutbox({
        env: { KAKAO_OUTBOX_ENABLED: 'true', SOLAPI_ENABLED: 'false' },
        createAdminClient: createAdminClientMock,
        createPolicyReaders: createPolicyReadersMock,
      })

      expect(result.enabled).toBe(false)
      expect(createAdminClientMock).not.toHaveBeenCalled()
      expect(createPolicyReadersMock).not.toHaveBeenCalled()
    })

    it('SOLAPI_ENABLED만 true이고 KAKAO_OUTBOX_ENABLED가 false이면 호출 0건 격리된다', async () => {
      const createAdminClientMock = vi.fn()
      const createPolicyReadersMock = vi.fn()

      const result = await runServerNotificationOutbox({
        env: { KAKAO_OUTBOX_ENABLED: 'false', SOLAPI_ENABLED: 'true' },
        createAdminClient: createAdminClientMock,
        createPolicyReaders: createPolicyReadersMock,
      })

      expect(result.enabled).toBe(false)
      expect(createAdminClientMock).not.toHaveBeenCalled()
      expect(createPolicyReadersMock).not.toHaveBeenCalled()
    })
  })

  describe('enabled 상태 정상 통합 실행', () => {
    const validEnv: SolapiEnv = {
      KAKAO_OUTBOX_ENABLED: 'true',
      SOLAPI_ENABLED: 'true',
      SOLAPI_API_KEY: 'test-api-key',
      SOLAPI_API_SECRET: 'test-api-secret',
      SOLAPI_PF_ID: 'test-pf-id',
      SOLAPI_WEBHOOK_SECRET: 'test-webhook-secret',
      SOLAPI_TEMPLATE_IDS: JSON.stringify({
        SOHEE_BOOKING_CONFIRMED_V1: 'KA01TP240001',
      }),
    }

    it('둘 다 true일 때 adminClient가 생성되고 limit=20으로 runtime이 호출된다 (mock reader 주입)', async () => {
      const fakeClient: SupabaseOutboxClient = { rpc: vi.fn(), from: vi.fn() }
      const createAdminClientMock = vi.fn().mockReturnValue(fakeClient)

      const fakeEvidenceReader = vi.fn().mockResolvedValue({
        granted: true,
        subjectPhone: '01012345678',
        workspaceId: 'ws-1',
        reservationId: 'res-1',
      })
      const fakeApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })

      const createPolicyReadersMock: OutboxPolicyReadersFactory = vi.fn().mockReturnValue({
        evidenceReader: fakeEvidenceReader,
        templateApprovalReader: fakeApprovalReader,
      })

      const fakeSend = vi.fn().mockResolvedValue({ accepted: true })
      const createSenderMock: SolapiOutboxSenderFactory = vi.fn().mockReturnValue(fakeSend)

      const runtimeRunMock = vi.fn().mockResolvedValue({
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
        expired: 0,
      })

      const createRuntimeMock = vi.fn().mockReturnValue({
        run: runtimeRunMock,
      })

      const result = await runServerNotificationOutbox({
        env: validEnv,
        createAdminClient: createAdminClientMock,
        createPolicyReaders: createPolicyReadersMock,
        createSender: createSenderMock,
        createRuntime: createRuntimeMock,
      })

      expect(createAdminClientMock).toHaveBeenCalledTimes(1)
      expect(createPolicyReadersMock).toHaveBeenCalledWith(fakeClient, validEnv, undefined)
      expect(createSenderMock).toHaveBeenCalledWith(validEnv)
      expect(createRuntimeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client: fakeClient,
          env: validEnv,
          evidenceReader: fakeEvidenceReader,
          templateApprovalReader: fakeApprovalReader,
          send: fakeSend,
          limit: SERVER_OUTBOX_LIMIT,
        }),
      )
      expect(runtimeRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: SERVER_OUTBOX_LIMIT,
        }),
      )
      expect(result.enabled).toBe(true)
      expect(result.counts.SENT).toBe(1)
    })

    it('실제 policy factory 연동: createPolicyReaders 미주입 시 정적 createOutboxPolicyReaders가 실제 호출되어 evidence/approval reader 두 개 모두 런타임에 전달된다', async () => {
      const fakeClient: SupabaseOutboxClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }
      const createAdminClientMock = vi.fn().mockReturnValue(fakeClient)
      const fakeSend = vi.fn().mockResolvedValue({ accepted: true })

      let capturedEvidenceReader: unknown = null
      let capturedApprovalReader: unknown = null

      const createRuntimeMock = vi.fn().mockImplementation((params) => {
        capturedEvidenceReader = params.evidenceReader
        capturedApprovalReader = params.templateApprovalReader
        return {
          run: vi.fn().mockResolvedValue({
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
            errors: 0,
            expired: 0,
          }),
        }
      })

      const result = await runServerNotificationOutbox({
        env: validEnv,
        createAdminClient: createAdminClientMock,
        createSender: vi.fn().mockReturnValue(fakeSend),
        createRuntime: createRuntimeMock,
      })

      expect(createAdminClientMock).toHaveBeenCalledTimes(1)
      expect(createRuntimeMock).toHaveBeenCalledTimes(1)
      // reader 두 개 모두 런타임에 실제 함수로 전달됨 확인
      expect(typeof capturedEvidenceReader).toBe('function')
      expect(typeof capturedApprovalReader).toBe('function')
      expect(result.enabled).toBe(true)
    })

    it('정책 리더 factory 실행 중 예외 throw 시 에러가 상위로 전파된다 (route 500 처리용)', async () => {
      const fakeClient: SupabaseOutboxClient = { rpc: vi.fn(), from: vi.fn() }
      const throwingPolicyReadersFactory: OutboxPolicyReadersFactory = vi.fn().mockImplementation(() => {
        throw new Error('POLICY_FACTORY_FAILED')
      })

      await expect(
        runServerNotificationOutbox({
          env: validEnv,
          createAdminClient: vi.fn().mockReturnValue(fakeClient),
          createPolicyReaders: throwingPolicyReadersFactory,
        }),
      ).rejects.toThrow('POLICY_FACTORY_FAILED')
    })

    it('결과불명 UNKNOWN 상태 발생 시 자동 재시도를 수행하지 않는다', async () => {
      const fakeClient: SupabaseOutboxClient = { rpc: vi.fn(), from: vi.fn() }
      const createAdminClientMock = vi.fn().mockReturnValue(fakeClient)

      const runtimeRunMock = vi.fn().mockResolvedValue({
        enabled: true,
        processed: 1,
        counts: {
          DISABLED: 0,
          NOT_DUE: 0,
          CLAIM_FAILED: 0,
          BLOCKED: 0,
          SUPERSEDED: 0,
          CAS_LOST: 0,
          UNKNOWN: 1,
          SENT: 0,
        },
        errors: 0,
        expired: 0,
      })

      const result = await runServerNotificationOutbox({
        env: validEnv,
        createAdminClient: createAdminClientMock,
        createRuntime: vi.fn().mockReturnValue({ run: runtimeRunMock }),
        createPolicyReaders: vi.fn().mockReturnValue({
          evidenceReader: vi.fn(),
          templateApprovalReader: vi.fn(),
        }),
        createSender: vi.fn().mockReturnValue(vi.fn()),
      })

      expect(result.counts.UNKNOWN).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(runtimeRunMock).toHaveBeenCalledTimes(1) // 추가 재시도 호출 없음
    })
  })
})
