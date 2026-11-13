import { describe, expect, it, vi } from 'vitest'
import {
  OutboxRepository,
  createOutboxRepository,
  type InformationalEvidenceQuery,
  type InformationalEvidenceReader,
  type InformationalEvidenceReaderFn,
  type ReservationDbRow,
  type ReservationQueryFn,
  type ReservationReader,
  type TemplateApprovalReader,
  type TemplateApprovalReaderFn,
} from './outbox-repository'
import {
  processNotificationJob,
  OUTBOX_REASON,
  type Job,
  type ReservationSnapshot,
  type StorePort,
} from './outbox-processor'

describe('OutboxRepository', () => {
  const dummyReader: ReservationQueryFn = async () => null

  const sampleRow: ReservationDbRow = {
    id: 'res-100',
    workspace_id: 'ws-200',
    status: 'CONFIRMED',
    customer_id: 'cust-300',
    customer_name: '홍길동',
    customer_phone: '010-1234-5678',
    service_name: '속눈썹 펌',
    metadata: {
      bookingStartsAt: '2026-11-07T14:00:00.000Z',
      shopName: '소희 뷰티',
      unrelatedPii: '010-9999-8888 비밀메모',
    },
    updated_at: '2026-11-06T10:00:00.123456+00:00',
  }

  describe('getCurrentReservation', () => {
    it('rawmicroseconds유지: 타임스탬프 마이크로초 문자열을 절삭 없이 version으로 보존한다', async () => {
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue({ ...sampleRow })
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot).not.toBeNull()
      expect(snapshot?.version).toBe('2026-11-06T10:00:00.123456+00:00')
      expect(typeof snapshot?.version).toBe('string')
    })

    it('payload에 허용된 컬럼(customer_name, service_name, metadata bookingStartsAt)만 읽고 기타 PII는 제외한다', async () => {
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue({ ...sampleRow })
      const repo = new OutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload).toEqual({
        customerName: '홍길동',
        serviceName: '속눈썹 펌',
        bookingStartsAt: '2026-11-07T14:00:00.000Z',
        shopName: '소희 뷰티',
      })
      expect(snapshot?.payload?.unrelatedPii).toBeUndefined()
    })

    it('metadata에서 previousStartsAt, cancelReason, refundInfo, paymentInfo 명시적 문자열만 선별한다', async () => {
      const detailedRow: ReservationDbRow = {
        ...sampleRow,
        metadata: {
          previousStartsAt: '2026-11-06T10:00:00.000Z',
          cancelReason: '고객 단순 변심',
          refundInfo: '매장에 확인해 주세요',
          paymentInfo: '결제 확인 전',
          amount: 50000, // 숫자 등 비문자열 필드는 무시
          internalNote: '비밀 메모',
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(detailedRow)
      const repo = new OutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload).toEqual({
        customerName: '홍길동',
        serviceName: '속눈썹 펌',
        shopName: undefined,
        previousStartsAt: '2026-11-06T10:00:00.000Z',
        cancelReason: '고객 단순 변심',
        refundInfo: '매장에 확인해 주세요',
        paymentInfo: '결제 확인 전',
      })
      expect(snapshot?.payload?.amount).toBeUndefined()
      expect(snapshot?.payload?.internalNote).toBeUndefined()
    })

    it('row.payment_amount_krw가 있으면 payload.paymentAmountKrw에 숫자로 매핑된다', async () => {
      const paymentRow: ReservationDbRow = {
        ...sampleRow,
        payment_amount_krw: 45000,
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(paymentRow)
      const repo = new OutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')
      expect(snapshot?.payload?.paymentAmountKrw).toBe(45000)
    })

    it('cancel_reason 컬럼 우선: row.cancel_reason이 있으면 metadata.cancelReason보다 우선 매핑한다', async () => {
      const rowWithCancelReason: ReservationDbRow = {
        ...sampleRow,
        cancel_reason: '매장 사정으로 인한 취소',
        metadata: {
          cancelReason: '메타데이터 취소사유(무시되어야 함)',
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithCancelReason)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload?.cancelReason).toBe('매장 사정으로 인한 취소')
    })

    it('cancel_reason fallback: row.cancel_reason이 null/undefined 또는 blank면 metadata.cancelReason을 대체 사용한다', async () => {
      const rowWithBlankCancelReason: ReservationDbRow = {
        ...sampleRow,
        cancel_reason: '   ',
        metadata: {
          cancelReason: '고객 단순 변심',
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithBlankCancelReason)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload?.cancelReason).toBe('고객 단순 변심')
    })

    it('cancel_reason 없거나 blank면 payload에 cancelReason 키를 포함하지 않는다', async () => {
      const rowWithoutCancelReason: ReservationDbRow = {
        ...sampleRow,
        cancel_reason: null,
        metadata: {
          cancelReason: '   ',
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithoutCancelReason)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload).toBeDefined()
      expect('cancelReason' in (snapshot?.payload ?? {})).toBe(false)
    })

    it('previousBookingStartsAt 매핑: metadata.previousBookingStartsAt 문자열을 payload.previousStartsAt으로 매핑한다', async () => {
      const rowWithPrevBooking: ReservationDbRow = {
        ...sampleRow,
        metadata: {
          previousBookingStartsAt: '2026-11-06T10:00:00.000Z',
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithPrevBooking)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.payload?.previousStartsAt).toBe('2026-11-06T10:00:00.000Z')
    })

    it('previousBookingStartsAt이 비문자열(숫자/객체 등)이거나 blank면 payload에 previousStartsAt 키를 포함하지 않는다', async () => {
      const rowWithNonStringPrev: ReservationDbRow = {
        ...sampleRow,
        metadata: {
          previousBookingStartsAt: 1730887200000 as unknown as string,
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithNonStringPrev)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect('previousStartsAt' in (snapshot?.payload ?? {})).toBe(false)
    })

    it('metadata.requestDeclined가 true이면 snapshot payload.requestDeclined로 전달한다', async () => {
      const rowWithDeclined: ReservationDbRow = {
        ...sampleRow,
        status: 'CANCELLED',
        cancel_reason: '신청 마감',
        metadata: {
          ...sampleRow.metadata,
          requestDeclined: true,
        },
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithDeclined)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')
      expect(snapshot?.payload?.requestDeclined).toBe(true)
    })

    it('phone null blocked처리되도록emptystring: 전화번호가 null/undefined면 empty string으로 반환한다', async () => {
      const rowWithoutPhone: ReservationDbRow = {
        ...sampleRow,
        customer_phone: null,
        phone: null,
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithoutPhone)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot).not.toBeNull()
      expect(snapshot?.phone).toBe('')
    })

    it('customer_id가 null이면 customer_name을 customerId로 대체한다', async () => {
      const rowWithoutCustId: ReservationDbRow = {
        ...sampleRow,
        customer_id: null,
        customer_name: '홍길동',
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(rowWithoutCustId)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot?.customerId).toBe('홍길동')
    })

    it('cross workspace row reject: 조회된 row의 workspace_id가 다르면 거부(null)한다', async () => {
      const foreignRow: ReservationDbRow = {
        ...sampleRow,
        workspace_id: 'ws-attacker',
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(foreignRow)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot).toBeNull()
    })

    it('cross workspace row reject: 조회된 row의 reservation id가 다르면 거부(null)한다', async () => {
      const foreignRow: ReservationDbRow = {
        ...sampleRow,
        id: 'res-other',
      }
      const mockReader = vi.fn<ReservationQueryFn>().mockResolvedValue(foreignRow)
      const repo = createOutboxRepository({ reservationReader: mockReader })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot).toBeNull()
    })

    it('workspaceId 또는 reservationId가 비어있으면 쿼리를 실행하지 않고 거부(null)한다', async () => {
      const mockReader = vi.fn<ReservationQueryFn>()
      const repo = createOutboxRepository({ reservationReader: mockReader })

      expect(await repo.getCurrentReservation('', 'res-100')).toBeNull()
      expect(await repo.getCurrentReservation('ws-200', '')).toBeNull()
      expect(mockReader).not.toHaveBeenCalled()
    })

    it('errornoPII: reader에서 에러 발생 시 PII가 없는 generic 고정 오류를 던진다', async () => {
      const mockReader = vi.fn<ReservationQueryFn>().mockRejectedValue(
        new Error('Database syntax error near 010-1234-5678 customer 홍길동 secret-key-xyz')
      )
      const repo = createOutboxRepository({ reservationReader: mockReader })

      await expect(repo.getCurrentReservation('ws-200', 'res-100')).rejects.toThrow(
        'REPOSITORY_READ_FAILED'
      )

      try {
        await repo.getCurrentReservation('ws-200', 'res-100')
      } catch (err: unknown) {
        const error = err as Error
        expect(error.message).toBe('REPOSITORY_READ_FAILED')
        expect(String(error.cause ?? '')).not.toContain('010-1234-5678')
        expect(String(error.cause ?? '')).not.toContain('홍길동')
        expect(String(error.cause ?? '')).not.toContain('secret-key-xyz')
      }
    })

    it('객체 형태의 ReservationReaderPort도 정상 수용한다', async () => {
      const mockPort: ReservationReader = {
        queryReservation: vi.fn().mockResolvedValue({ ...sampleRow }),
      }
      const repo = createOutboxRepository({ reservationReader: mockPort })

      const snapshot = await repo.getCurrentReservation('ws-200', 'res-100')

      expect(snapshot).not.toBeNull()
      expect(mockPort.queryReservation).toHaveBeenCalledWith({
        workspaceId: 'ws-200',
        reservationId: 'res-100',
      })
    })
  })

  describe('getInformationalEvidence', () => {
    const dummySnapshot: ReservationSnapshot = {
      workspaceId: 'ws-200',
      reservationId: 'res-100',
      version: '2026-11-06T10:00:00.123456+00:00',
      status: 'CONFIRMED',
      customerId: '홍길동',
      phone: '010-1234-5678',
      payload: { serviceName: '속눈썹 펌' },
    }

    it('no evidence null: 운영근거저장소 reader가 없으면 기본 null로 fail-closed 한다', async () => {
      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        // evidenceReader 주입 안 함
      })

      const evidence = await repo.getInformationalEvidence(dummySnapshot)

      expect(evidence).toBeNull()
    })

    it('evidenceReader가 주입되었을 때 reservationId + workspaceId + phone을 필수 바인딩하여 조회한다', async () => {
      const evidenceReaderMock = vi.fn<InformationalEvidenceReaderFn>().mockImplementation((query: InformationalEvidenceQuery) => {
        return Promise.resolve({
          granted: true,
          subjectPhone: query.phone,
          workspaceId: query.workspaceId,
          reservationId: query.reservationId,
        })
      })

      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        evidenceReader: evidenceReaderMock,
      })

      const evidence = await repo.getInformationalEvidence(dummySnapshot)

      expect(evidence).toEqual({
        granted: true,
        subjectPhone: '010-1234-5678',
        workspaceId: 'ws-200',
        reservationId: 'res-100',
      })
      expect(evidenceReaderMock).toHaveBeenCalledWith({
        workspaceId: 'ws-200',
        reservationId: 'res-100',
        phone: '010-1234-5678',
      })
    })

    it('객체 형태의 InformationalEvidenceReaderPort도 정상 지원한다', async () => {
      const mockEvidencePort: InformationalEvidenceReader = {
        getEvidence: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: '010-1234-5678',
          workspaceId: 'ws-200',
          reservationId: 'res-100',
        }),
      }

      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        evidenceReader: mockEvidencePort,
      })

      const evidence = await repo.getInformationalEvidence(dummySnapshot)
      expect(evidence?.granted).toBe(true)
    })

    it('errornoPII: evidence reader 예외 발생 시 PII 없는 generic 오류를 던진다', async () => {
      const throwingReader = vi.fn<InformationalEvidenceReaderFn>().mockRejectedValue(
        new Error('Failed evidence lookup for 010-1234-5678 in DB table customer_consents')
      )
      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        evidenceReader: throwingReader,
      })

      await expect(repo.getInformationalEvidence(dummySnapshot)).rejects.toThrow(
        'EVIDENCE_READ_FAILED'
      )

      try {
        await repo.getInformationalEvidence(dummySnapshot)
      } catch (err: unknown) {
        const error = err as Error
        expect(error.message).toBe('EVIDENCE_READ_FAILED')
        expect(String(error.cause ?? '')).not.toContain('010-1234-5678')
      }
    })
  })

  describe('getTemplateApproval', () => {
    it('noapprovalnull: template reader가 없으면 null을 반환한다', async () => {
      const repo = createOutboxRepository({
        reservationReader: dummyReader,
      })

      const approval = await repo.getTemplateApproval('BOOKING_CONFIRMED')
      expect(approval).toBeNull()
    })

    it('template reader가 주입된 경우 승인 정보를 정상 반환한다', async () => {
      const mockApprovalReader = vi.fn<TemplateApprovalReaderFn>().mockResolvedValue({
        approved: true,
        templateId: 'tpl-confirmed-001',
      })

      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        templateApprovalReader: mockApprovalReader,
      })

      const approval = await repo.getTemplateApproval('BOOKING_CONFIRMED')
      expect(approval).toEqual({
        approved: true,
        templateId: 'tpl-confirmed-001',
      })
      expect(mockApprovalReader).toHaveBeenCalledWith('BOOKING_CONFIRMED')
    })

    it('객체 형태의 TemplateApprovalReaderPort도 정상 지원한다', async () => {
      const mockPort: TemplateApprovalReader = {
        getApproval: vi.fn().mockResolvedValue({
          approved: true,
          templateId: 'tpl-changed-002',
        }),
      }

      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        templateApprovalReader: mockPort,
      })

      const approval = await repo.getTemplateApproval('BOOKING_CHANGED')
      expect(approval?.approved).toBe(true)
    })

    it('template reader 예외 발생 시 generic 오류를 던진다', async () => {
      const throwingReader = vi.fn<TemplateApprovalReaderFn>().mockRejectedValue(
        new Error('Solapi API key expired in query')
      )
      const repo = createOutboxRepository({
        reservationReader: dummyReader,
        templateApprovalReader: throwingReader,
      })

      await expect(repo.getTemplateApproval('BOOKING_CONFIRMED')).rejects.toThrow(
        'TEMPLATE_APPROVAL_READ_FAILED'
      )
    })
  })

  describe('OutboxProcessor 통합 동작', () => {
    const job: Job = {
      id: 'job-999',
      workspaceId: 'ws-200',
      reservationId: 'res-100',
      reservationUpdatedAt: '2026-11-06T10:00:00.123456+00:00',
      event: 'BOOKING_CONFIRMED',
      dueAt: '2026-11-06T10:00:00.000Z',
    }

    const mockStore: StorePort = {
      claim: vi.fn().mockResolvedValue('lease-token-1'),
      markSending: vi.fn().mockResolvedValue(true),
      finish: vi.fn().mockResolvedValue(true),
    }

    it('phone이 null인 경우 empty string으로 전달되어 OutboxProcessor에서 BLOCKED (INVALID_PHONE) 처리된다', async () => {
      const rowWithoutPhone: ReservationDbRow = {
        ...sampleRow,
        customer_phone: null,
        phone: null,
      }
      const repo = createOutboxRepository({
        reservationReader: vi.fn().mockResolvedValue(rowWithoutPhone),
        evidenceReader: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: '',
          workspaceId: 'ws-200',
          reservationId: 'res-100',
        }),
        templateApprovalReader: vi.fn().mockResolvedValue({
          approved: true,
          templateId: 'tpl-1',
        }),
      })

      const outcome = await processNotificationJob(job, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: repo,
        store: mockStore,
        send: vi.fn().mockResolvedValue({ accepted: true }),
      })

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_PHONE)
    })

    it('evidenceReader가 없으면 OutboxProcessor에서 fail-closed BLOCKED (EVIDENCE_MISSING) 처리된다', async () => {
      const repo = createOutboxRepository({
        reservationReader: vi.fn().mockResolvedValue({ ...sampleRow }),
        // evidenceReader 없음
        templateApprovalReader: vi.fn().mockResolvedValue({
          approved: true,
          templateId: 'tpl-1',
        }),
      })

      const outcome = await processNotificationJob(job, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: repo,
        store: mockStore,
        send: vi.fn().mockResolvedValue({ accepted: true }),
      })

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_MISSING)
    })

    it('templateApprovalReader가 없으면 OutboxProcessor에서 BLOCKED (TEMPLATE_NOT_APPROVED) 처리된다', async () => {
      const repo = createOutboxRepository({
        reservationReader: vi.fn().mockResolvedValue({ ...sampleRow }),
        evidenceReader: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: '010-1234-5678',
          workspaceId: 'ws-200',
          reservationId: 'res-100',
        }),
        // templateApprovalReader 없음
      })

      const outcome = await processNotificationJob(job, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: repo,
        store: mockStore,
        send: vi.fn().mockResolvedValue({ accepted: true }),
      })

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.TEMPLATE_NOT_APPROVED)
    })

    it('cross workspace row인 경우 OutboxProcessor에서 BLOCKED (RESERVATION_NOT_FOUND) 처리된다', async () => {
      const foreignRow: ReservationDbRow = {
        ...sampleRow,
        workspace_id: 'ws-attacker',
      }
      const repo = createOutboxRepository({
        reservationReader: vi.fn().mockResolvedValue(foreignRow),
        evidenceReader: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: '010-1234-5678',
          workspaceId: 'ws-200',
          reservationId: 'res-100',
        }),
        templateApprovalReader: vi.fn().mockResolvedValue({
          approved: true,
          templateId: 'tpl-1',
        }),
      })

      const outcome = await processNotificationJob(job, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: repo,
        store: mockStore,
        send: vi.fn().mockResolvedValue({ accepted: true }),
      })

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.RESERVATION_NOT_FOUND)
    })

    it('rawmicroseconds가 보존되어 job의 마이크로초와 정확히 일치하면 정상 발송(SENT)된다', async () => {
      const repo = createOutboxRepository({
        reservationReader: vi.fn().mockResolvedValue({ ...sampleRow }),
        evidenceReader: vi.fn().mockResolvedValue({
          granted: true,
          subjectPhone: '010-1234-5678',
          workspaceId: 'ws-200',
          reservationId: 'res-100',
        }),
        templateApprovalReader: vi.fn().mockResolvedValue({
          approved: true,
          templateId: 'tpl-confirmed-001',
        }),
      })

      const outcome = await processNotificationJob(job, {
        enabled: true,
        now: new Date('2026-11-06T10:00:00.000Z'),
        repository: repo,
        store: mockStore,
        send: vi.fn().mockResolvedValue({ accepted: true }),
      })

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
    })
  })
})
