/**
 * 카카오 알림톡 Outbox 런타임 통합 검증 (Notification Outbox Runtime Integration Tests)
 *
 * [원칙 및 제약사항 준수]
 * 1. 실제 모듈(outbox-runtime, repository, store, ports, runner, processor)은 mock하지 않고 직접 조립합니다.
 * 2. Supabase client 네트워크 경계만 fake builder/rpc로 주입합니다.
 * 3. generic Supabase client 테스트 캐스트에 unknown을 허용하고 any는 일체 금지합니다.
 * 4. UUID 토큰 생성은 실제 crypto.randomUUID()를 사용하며, 테스트 고정 mock crypto는 금지합니다.
 * 5. 민감 정보(secret, phone, name, lease token)의 직렬화 누출을 엄격히 검증합니다.
 */

import { describe, expect, it, vi } from 'vitest'
import { createNotificationOutboxRuntime } from './outbox-runtime'
import type { SolapiEnv } from './solapi-factory'
import type { Job, SendFn } from './outbox-processor'
import type { SupabaseOutboxClient } from './supabase-outbox-ports'
import type {
  InformationalEvidenceReader,
  TemplateApprovalReader,
} from './outbox-repository'

describe('Notification Outbox Runtime 통합 검증 (Integration)', () => {
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
    SOLAPI_API_KEY: 'test-api-key-secret-111',
    SOLAPI_API_SECRET: 'test-api-secret-222',
    SOLAPI_PF_ID: 'test-pf-id-333',
    SOLAPI_WEBHOOK_SECRET: 'test-webhook-secret-444',
    SOLAPI_TEMPLATE_IDS: validTemplateIds,
  }

  const dummyJobRow = {
    id: 'job-int-001',
    workspace_id: 'ws-int-111',
    reservation_id: 'res-int-222',
    reservation_updated_at: '2026-11-06T10:00:00.000000Z',
    event: 'BOOKING_CONFIRMED',
    due_at: '2026-11-06T10:00:00.000Z',
    status: 'READY',
    lease_until: null,
  }

  const dummyReservationRow = {
    id: 'res-int-222',
    workspace_id: 'ws-int-111',
    status: 'CONFIRMED',
    customer_id: 'cust-int-333',
    customer_name: '홍길동',
    customer_phone: '010-1234-5678',
    service_name: '헤어 컷',
    metadata: {
      bookingStartsAt: '2026-11-07T14:00:00.000Z',
      shopName: '소희헤어살롱',
    },
    updated_at: '2026-11-06T10:00:00.000000Z',
  }

  const dummyBusinessProfileRow = {
    business_name: '소희헤어살롱',
    location: '서울시 강남구 테헤란로 123',
  }

  type FakeRpcParams = {
    p_job_id?: string
    p_lease_token?: string
    p_status?: string
    p_reason_code?: string | null
  }

  interface FakeClientOptions {
    jobs?: Array<Record<string, unknown>>
    reservationRow?: Record<string, unknown> | null
    profileRow?: Record<string, unknown> | null
    markSendingSuccess?: boolean
    claimSuccess?: boolean
    finishSuccess?: boolean
  }

  type QueryBuilderChain = {
    select: (cols: string) => QueryBuilderChain
    or: (filter: string) => QueryBuilderChain
    order: (col: string, options: { ascending: boolean }) => QueryBuilderChain
    limit: (count: number) => Promise<{ data: unknown; error: unknown }>
    eq: (col: string, val: string) => QueryBuilderChain
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>
  }

  function createFakeSupabaseClient(options: FakeClientOptions = {}) {
    const callLog: string[] = []
    const rpcInvocations: Array<{ fn: string; params?: FakeRpcParams }> = []

    const rpc = async (
      fn: string,
      rawParams?: Record<string, unknown>,
    ): Promise<{ data: unknown; error: unknown }> => {
      const params = rawParams as FakeRpcParams | undefined
      rpcInvocations.push({ fn, params })

      if (fn === 'expire_kakao_notification_jobs') {
        callLog.push('rpc:expire_kakao_notification_jobs')
        return { data: 0, error: null }
      }

      if (fn === 'claim_kakao_notification_job') {
        const jobId = params?.p_job_id ?? ''
        callLog.push(`rpc:claim_kakao_notification_job:${jobId}`)
        return { data: options.claimSuccess ?? true, error: null }
      }

      if (fn === 'mark_kakao_notification_sending') {
        const jobId = params?.p_job_id ?? ''
        callLog.push(`rpc:mark_kakao_notification_sending:${jobId}`)
        return { data: options.markSendingSuccess ?? true, error: null }
      }

      if (fn === 'finish_kakao_notification_job') {
        const jobId = params?.p_job_id ?? ''
        const status = params?.p_status ?? ''
        const reason = params?.p_reason_code ?? 'null'
        callLog.push(`rpc:finish_kakao_notification_job:${jobId}:${status}:${reason}`)
        return { data: options.finishSuccess ?? true, error: null }
      }

      return { data: null, error: null }
    }

    const from = (table: string): QueryBuilderChain => {
      callLog.push(`from:${table}`)

      const chain: QueryBuilderChain = {
        select: () => chain,
        or: () => chain,
        order: () => chain,
        limit: async () => {
          return {
            data: options.jobs ?? [dummyJobRow],
            error: null,
          }
        },
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'business_profiles') {
            return {
              data: options.profileRow !== undefined ? options.profileRow : dummyBusinessProfileRow,
              error: null,
            }
          }
          return {
            data: options.reservationRow !== undefined ? options.reservationRow : dummyReservationRow,
            error: null,
          }
        },
      }

      return chain
    }

    const fakeClient = { rpc, from }
    const client = fakeClient as unknown as SupabaseOutboxClient

    return { client, callLog, rpcInvocations }
  }

  describe('정상 통합 실행 (End-to-End Pipeline Verification)', () => {
    it('expire → list → claim → 예약읽기/동의/승인 doublecheck → markSending → send 1 → finish SENT 전 과정을 증명한다', async () => {
      const { client, callLog, rpcInvocations } = createFakeSupabaseClient()
      const callSequence: string[] = []

      // 1. Evidence Reader (동의 확인)
      const evidenceReader: InformationalEvidenceReader = vi.fn().mockImplementation(async (q) => {
        callSequence.push(`evidenceReader:${q.reservationId}`)
        return {
          granted: true,
          subjectPhone: '010-1234-5678',
          workspaceId: 'ws-int-111',
          reservationId: 'res-int-222',
        }
      })

      // 2. Template Approval Reader (템플릿 승인 확인)
      const templateApprovalReader: TemplateApprovalReader = vi
        .fn()
        .mockImplementation(async (event) => {
          callSequence.push(`templateApprovalReader:${event}`)
          return {
            approved: true,
            templateId: 'KA01TP240001',
          }
        })

      // 3. Fake Send (외부 발송 통신 1회)
      let sendCallCount = 0
      let sentSnapshotPhone = ''
      let sentTemplateId = ''
      const fakeSend: SendFn = vi
        .fn()
        .mockImplementation(async (snapshot, _job: Job, templateId: string) => {
          sendCallCount++
          sentSnapshotPhone = snapshot.phone
          sentTemplateId = templateId
          callSequence.push(`fakeSend:${snapshot.reservationId}`)
          return { accepted: true }
        })

      const executionTime = new Date('2026-11-06T10:00:00.000Z')

      // 실제 런타임 조립 (outbox-runtime, ports, store, repository, runner, processor 모두 실제 인스턴스)
      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader,
        templateApprovalReader,
        send: fakeSend,
        now: executionTime,
      })

      const result = await runtime.run()

      // 배치 결과 검증
      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.errors).toBe(0)
      expect(result.counts.SENT).toBe(1)
      expect(sendCallCount).toBe(1)
      expect(sentSnapshotPhone).toBe('010-1234-5678')
      expect(sentTemplateId).toBe('KA01TP240001')

      // 4. 전체 파이프라인 호출 순서 및 RPC/DB 정밀 증명
      // (1) expire_kakao_notification_jobs
      // (2) from:kakao_notification_outbox (listDueJobs)
      // (3) claim_kakao_notification_job
      // (4) from:reservations (1차 예약 조회)
      // (5) from:business_profiles (1차 정규 매장 프로필 조회)
      // (6) evidenceReader (1차 동의 조회)
      // (7) templateApprovalReader (1차 템플릿 승인 조회)
      // (8) from:reservations (2차 Double-Read 예약 조회)
      // (9) from:business_profiles (2차 Double-Read 정규 매장 프로필 조회)
      // (10) evidenceReader (2차 Double-Read 동의 재검증)
      // (11) templateApprovalReader (2차 Double-Read 승인 재검증)
      // (12) mark_kakao_notification_sending (발송 직전 CAS)
      // (13) send 딱 1회 호출
      // (14) finish_kakao_notification_job (SENT 상태 및 SENT_SUCCESS 기록)

      expect(callLog).toEqual([
        'rpc:expire_kakao_notification_jobs',
        'from:kakao_notification_outbox',
        'rpc:claim_kakao_notification_job:job-int-001',
        'from:reservations',
        'from:business_profiles',
        'from:reservations',
        'from:business_profiles',
        'rpc:mark_kakao_notification_sending:job-int-001',
        'rpc:finish_kakao_notification_job:job-int-001:SENT:SENT_SUCCESS',
      ])

      // Double-Read 및 readers 2회 호출 증명
      expect(evidenceReader).toHaveBeenCalledTimes(2)
      expect(templateApprovalReader).toHaveBeenCalledTimes(2)
      expect(callSequence).toEqual([
        'evidenceReader:res-int-222',
        'templateApprovalReader:BOOKING_CONFIRMED',
        'evidenceReader:res-int-222',
        'templateApprovalReader:BOOKING_CONFIRMED',
        'fakeSend:res-int-222',
      ])

      // 5. 실제 crypto.randomUUID() 토큰 생성 및 리스 토큰 일관성 검증
      const claimInvocation = rpcInvocations.find((inv) => inv.fn === 'claim_kakao_notification_job')
      const markInvocation = rpcInvocations.find((inv) => inv.fn === 'mark_kakao_notification_sending')
      const finishInvocation = rpcInvocations.find((inv) => inv.fn === 'finish_kakao_notification_job')

      expect(claimInvocation?.params?.p_lease_token).toBeDefined()
      const leaseToken = claimInvocation?.params?.p_lease_token ?? ''

      // 실제 UUID 형식 준수 확인 (테스트 고정 mock crypto 없이 실제 crypto 동작 증명)
      expect(leaseToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(markInvocation?.params?.p_lease_token).toBe(leaseToken)
      expect(finishInvocation?.params?.p_lease_token).toBe(leaseToken)
      expect(finishInvocation?.params?.p_status).toBe('SENT')
      expect(finishInvocation?.params?.p_reason_code).toBe('SENT_SUCCESS')
    })
  })

  describe('Fail-Closed: evidence 없는 경우 (evidenceReader 미주입)', () => {
    it('evidenceReader가 없으면 런타임 전체가 disabled 처리되며 DB query 및 RPC 호출이 0건이다', async () => {
      const { client, callLog } = createFakeSupabaseClient()
      const sendMock = vi.fn()
      const templateApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: undefined, // 미주입
        templateApprovalReader,
        send: sendMock,
      })

      const result = await runtime.run()

      expect(result.enabled).toBe(false)
      expect(result.processed).toBe(0)
      expect(result.errors).toBe(0)
      expect(result.expired).toBe(0)
      expect(callLog).toHaveLength(0) // DB query, RPC 0건
      expect(sendMock).not.toHaveBeenCalled()
      expect(templateApprovalReader).not.toHaveBeenCalled()
    })
  })

  describe('Fail-Closed: evidenceReader 있지만 null 반환 시', () => {
    it('evidence가 null이면 BLOCKED 상태로 정산되고 send 호출 0건을 보장한다', async () => {
      const { client, callLog, rpcInvocations } = createFakeSupabaseClient()
      const sendMock = vi.fn()
      const nullEvidenceReader: InformationalEvidenceReader = vi.fn().mockResolvedValue(null)
      const templateApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader: nullEvidenceReader,
        templateApprovalReader,
        send: sendMock,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()

      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.BLOCKED).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendMock).not.toHaveBeenCalled() // send 0회

      // finish 호출 시 BLOCKED 및 EVIDENCE_MISSING 확인
      const finishInvocation = rpcInvocations.find((inv) => inv.fn === 'finish_kakao_notification_job')
      expect(finishInvocation?.params?.p_status).toBe('BLOCKED')
      expect(finishInvocation?.params?.p_reason_code).toBe('EVIDENCE_MISSING')

      // mark_kakao_notification_sending 은 호출되지 않아야 함
      expect(callLog).not.toContain('rpc:mark_kakao_notification_sending:job-int-001')
    })
  })

  describe('markSending false (CAS Loss)', () => {
    it('markSending CAS 획득 실패 시 send 0건 및 CAS_LOST로 정산된다', async () => {
      const { client, callLog } = createFakeSupabaseClient({
        markSendingSuccess: false, // CAS 경합 패배
      })
      const sendMock = vi.fn()
      const evidenceReader: InformationalEvidenceReader = vi.fn().mockResolvedValue({
        granted: true,
        subjectPhone: '010-1234-5678',
        workspaceId: 'ws-int-111',
        reservationId: 'res-int-222',
      })
      const templateApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader,
        templateApprovalReader,
        send: sendMock,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()

      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.CAS_LOST).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(sendMock).not.toHaveBeenCalled() // send 0회

      // markSending 시도 후 CAS_LOST 시 타 프로세스 점유 상태이므로 finish를 호출하지 않고 리스 만료에 위임
      expect(callLog).toContain('rpc:mark_kakao_notification_sending:job-int-001')
      const finishCalls = callLog.filter((log) => log.startsWith('rpc:finish_kakao_notification_job'))
      expect(finishCalls).toHaveLength(0)
    })
  })

  describe('send 예외 발생 시 (throw Exception)', () => {
    it('외부 send 중 예외 throw 시 미접수 단정 없이 UNKNOWN 상태로 finish 정산되며 자동 재시도를 하지 않는다', async () => {
      const { client, rpcInvocations } = createFakeSupabaseClient()
      const throwingSend: SendFn = vi.fn().mockRejectedValue(new Error('Solapi network drop 504 Gateway Timeout'))
      const evidenceReader: InformationalEvidenceReader = vi.fn().mockResolvedValue({
        granted: true,
        subjectPhone: '010-1234-5678',
        workspaceId: 'ws-int-111',
        reservationId: 'res-int-222',
      })
      const templateApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader,
        templateApprovalReader,
        send: throwingSend,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()

      expect(result.enabled).toBe(true)
      expect(result.processed).toBe(1)
      expect(result.counts.UNKNOWN).toBe(1)
      expect(result.counts.SENT).toBe(0)
      expect(throwingSend).toHaveBeenCalledTimes(1) // 자체 자동 재시도 절대 금지

      // finish 호출 시 UNKNOWN 및 SEND_EXCEPTION 상태 정산 확인
      const finishInvocation = rpcInvocations.find((inv) => inv.fn === 'finish_kakao_notification_job')
      expect(finishInvocation?.params?.p_status).toBe('UNKNOWN')
      expect(finishInvocation?.params?.p_reason_code).toBe('SEND_EXCEPTION')
    })
  })

  describe('보안 및 데이터 무결성: serialized result secret/phone/name/lease 미노출', () => {
    it('반환된 배치 결과 객체 및 JSON 직렬화 문자열에 비밀값, 전화번호, 이름, 리스 토큰이 일체 노출되지 않는다', async () => {
      const { client, rpcInvocations } = createFakeSupabaseClient()
      const evidenceReader: InformationalEvidenceReader = vi.fn().mockResolvedValue({
        granted: true,
        subjectPhone: '010-1234-5678',
        workspaceId: 'ws-int-111',
        reservationId: 'res-int-222',
      })
      const templateApprovalReader: TemplateApprovalReader = vi.fn().mockResolvedValue({
        approved: true,
        templateId: 'KA01TP240001',
      })
      const fakeSend: SendFn = vi.fn().mockResolvedValue({ accepted: true })

      const runtime = createNotificationOutboxRuntime({
        client,
        env: validEnv,
        evidenceReader,
        templateApprovalReader,
        send: fakeSend,
        now: new Date('2026-11-06T10:00:00.000Z'),
      })

      const result = await runtime.run()

      // 생성된 실제 리스 토큰 확인
      const claimInvocation = rpcInvocations.find((inv) => inv.fn === 'claim_kakao_notification_job')
      const generatedLeaseToken = claimInvocation?.params?.p_lease_token ?? ''
      expect(generatedLeaseToken).not.toBe('')

      // 1. JSON 직렬화 검증 (외부 응답 / 로그 출력 시 PII 및 비밀값 배제)
      const serialized = JSON.stringify(result)

      // API 키 및 시크릿 검증
      expect(serialized).not.toContain('test-api-key-secret-111')
      expect(serialized).not.toContain('test-api-secret-222')
      expect(serialized).not.toContain('test-pf-id-333')
      expect(serialized).not.toContain('test-webhook-secret-444')

      // 전화번호 PII 검증
      expect(serialized).not.toContain('010-1234-5678')
      expect(serialized).not.toContain('01012345678')

      // 고객 이름 PII 검증
      expect(serialized).not.toContain('홍길동')

      // 리스 토큰 및 내부 키 검증
      expect(serialized).not.toContain(generatedLeaseToken)
      expect(serialized).not.toContain('lease')
      expect(serialized).not.toContain('token')

      // 2. 결과 객체의 최상위 키 화이트리스트 검증 (통계 숫자 및 플래그만 허용)
      expect(Object.keys(result).sort()).toEqual(
        ['counts', 'enabled', 'errors', 'expired', 'processed'].sort(),
      )

      // 3. 런타임 클로저 객체 직렬화 검증
      expect(JSON.stringify(runtime)).toBe('{}')
    })
  })
})
