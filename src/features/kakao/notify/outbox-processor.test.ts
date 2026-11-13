import { describe, expect, it, vi } from 'vitest'
import { createOutboxAllowlist } from './allowlist'
import {
  normalize010Phone,
  processNotificationJob,
  OUTBOX_REASON,
  type InformationalEvidence,
  type Job,
  type OutboxProcessorDeps,
  type ReservationSnapshot,
  type TemplateApproval,
} from './outbox-processor'

describe('outbox-processor', () => {
  const baseJob: Job = {
    id: 'job-123',
    workspaceId: 'ws-456',
    reservationId: 'res-789',
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
    payload: { customerName: '홍길동' },
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

  function createMockDeps(overrides: Partial<OutboxProcessorDeps> = {}): {
    deps: OutboxProcessorDeps
    claimMock: ReturnType<typeof vi.fn>
    markSendingMock: ReturnType<typeof vi.fn>
    finishMock: ReturnType<typeof vi.fn>
    getCurrentReservationMock: ReturnType<typeof vi.fn>
    getInformationalEvidenceMock: ReturnType<typeof vi.fn>
    getTemplateApprovalMock: ReturnType<typeof vi.fn>
    sendMock: ReturnType<typeof vi.fn>
  } {
    const claimMock = vi.fn().mockResolvedValue('lease-token-abc')
    const markSendingMock = vi.fn().mockResolvedValue(true)
    const finishMock = vi.fn().mockResolvedValue(true)

    const getCurrentReservationMock = vi.fn().mockResolvedValue({ ...baseSnapshot })
    const getInformationalEvidenceMock = vi.fn().mockResolvedValue({ ...baseEvidence })
    const getTemplateApprovalMock = vi.fn().mockResolvedValue({ ...baseApproval })

    const sendMock = vi.fn().mockResolvedValue({ accepted: true })

    const defaultDeps: OutboxProcessorDeps = {
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
    }

    return {
      deps: { ...defaultDeps, ...overrides },
      claimMock,
      markSendingMock,
      finishMock,
      getCurrentReservationMock,
      getInformationalEvidenceMock,
      getTemplateApprovalMock,
      sendMock,
    }
  }

  describe('normalize010Phone helper', () => {
    it('normalizes valid 010 domestic numbers', () => {
      expect(normalize010Phone('01012345678')).toBe('01012345678')
      expect(normalize010Phone('010-1234-5678')).toBe('01012345678')
      expect(normalize010Phone('010 9876 5432')).toBe('01098765432')
    })

    it('normalizes +82 10 international prefix numbers', () => {
      expect(normalize010Phone('+821012345678')).toBe('01012345678')
      expect(normalize010Phone('+82 10-1234-5678')).toBe('01012345678')
    })

    it('rejects invalid or non-010 numbers', () => {
      expect(normalize010Phone('01112345678')).toBeNull()
      expect(normalize010Phone('0212345678')).toBeNull()
      expect(normalize010Phone('010123456')).toBeNull()
      expect(normalize010Phone('0101234567899')).toBeNull()
      expect(normalize010Phone('')).toBeNull()
      expect(normalize010Phone('invalid')).toBeNull()
    })

    it('rejects numbers mixed with letters or malicious characters (does not strip arbitrary non-digits)', () => {
      expect(normalize010Phone('010-1234-abcd5678')).toBeNull()
      expect(normalize010Phone('010-1234-5678;DROP TABLE')).toBeNull()
      expect(normalize010Phone('010.1234.5678')).toBeNull()
      expect(normalize010Phone('010-1234-567a')).toBeNull()
      expect(normalize010Phone('+82 10-1234-567x')).toBeNull()
    })
  })

  describe('killswitch and scheduling checks (before claim)', () => {
    it('returns DISABLED when enabled is false and does not claim', async () => {
      const { deps, claimMock } = createMockDeps({ enabled: false })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('DISABLED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.DISABLED)
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('returns NOT_DUE when dueAt is in the future and does not claim', async () => {
      const { deps, claimMock } = createMockDeps({
        now: new Date('2026-11-06T09:00:00.000Z'),
      })
      const futureJob: Job = {
        ...baseJob,
        dueAt: '2026-11-06T10:00:00.000Z',
      }

      const outcome = await processNotificationJob(futureJob, deps)

      expect(outcome.status).toBe('NOT_DUE')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.NOT_DUE)
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('supports now provided as a function', async () => {
      const { deps, claimMock } = createMockDeps({
        now: () => new Date('2026-11-06T09:00:00.000Z'),
      })
      const futureJob: Job = {
        ...baseJob,
        dueAt: '2026-11-06T10:00:00.000Z',
      }

      const outcome = await processNotificationJob(futureJob, deps)

      expect(outcome.status).toBe('NOT_DUE')
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('rejects invalid or offset-less dueAt timestamps before claiming', async () => {
      const { deps, claimMock } = createMockDeps()
      const invalidJob: Job = {
        ...baseJob,
        dueAt: '2026-11-06 10:00:00', // missing timezone offset
      }

      const outcome = await processNotificationJob(invalidJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_SCHEDULE)
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('rejects NaN / Invalid Date for now or dueAt before claiming', async () => {
      const { deps, claimMock } = createMockDeps({
        now: new Date('invalid-date'),
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_SCHEDULE)
      expect(claimMock).not.toHaveBeenCalled()
    })

    it('rejects garbage or offset-less reservationUpdatedAt before claiming', async () => {
      const { deps, claimMock } = createMockDeps()
      const garbageJob: Job = {
        ...baseJob,
        reservationUpdatedAt: 'not-a-valid-date-garbage',
      }

      const outcome = await processNotificationJob(garbageJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_VERSION)
      expect(claimMock).not.toHaveBeenCalled()
    })

    describe('calendar rollover rejections (claim: 0, send: 0)', () => {
      it.each([
        { name: 'February 31st', invalidDate: '2026-02-31T10:00:00Z' },
        { name: 'February 29th on common year 2026', invalidDate: '2026-02-29T10:00:00Z' },
        { name: '13th month', invalidDate: '2026-13-01T10:00:00Z' },
        { name: '24th hour', invalidDate: '2026-11-06T24:00:00Z' },
        { name: '60th minute', invalidDate: '2026-11-06T10:60:00Z' },
      ])('rejects $name with claim 0 and send 0', async ({ invalidDate }) => {
        const { deps, claimMock, sendMock } = createMockDeps()
        const invalidJob: Job = {
          ...baseJob,
          dueAt: invalidDate,
          reservationUpdatedAt: invalidDate,
        }

        const outcome = await processNotificationJob(invalidJob, deps)

        expect(outcome.status).toBe('BLOCKED')
        expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_SCHEDULE)
        expect(claimMock).not.toHaveBeenCalled()
        expect(sendMock).not.toHaveBeenCalled()
      })

      it('accepts valid leap year February 29th with PostgreSQL microseconds and executes send', async () => {
        const leapDate = '2024-02-29T10:00:00.123456Z'
        const { deps, sendMock } = createMockDeps({
          now: new Date('2024-03-01T00:00:00Z'),
        })
        const leapJob: Job = {
          ...baseJob,
          dueAt: leapDate,
          reservationUpdatedAt: leapDate,
        }
        deps.repository.getCurrentReservation = vi.fn().mockResolvedValue({
          ...baseSnapshot,
          version: leapDate,
        })

        const outcome = await processNotificationJob(leapJob, deps)

        expect(outcome.status).toBe('SENT')
        expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
        expect(sendMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('claim handling and exceptions', () => {
    it('returns CLAIM_FAILED when store.claim returns null (duplicate claim / active lock)', async () => {
      const { deps, claimMock, getCurrentReservationMock } = createMockDeps()
      claimMock.mockResolvedValue(null)

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('CLAIM_FAILED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CLAIM_FAILED)
      expect(claimMock).toHaveBeenCalledWith('job-123')
      expect(getCurrentReservationMock).not.toHaveBeenCalled()
    })

    it('returns CLAIM_FAILED without throwing when store.claim throws an error (PII protection)', async () => {
      const { deps, claimMock, getCurrentReservationMock } = createMockDeps()
      claimMock.mockRejectedValue(new Error('DB pool error phone=01012345678 customer=김민감'))

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('CLAIM_FAILED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CLAIM_FAILED)
      expect(getCurrentReservationMock).not.toHaveBeenCalled()
    })
  })

  describe('reservation and snapshot validation', () => {
    it('blocks when reservation is not found in repository', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue(null)

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.RESERVATION_NOT_FOUND)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.RESERVATION_NOT_FOUND,
      )
    })

    it('blocks when workspaceId or reservationId does not match', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        workspaceId: 'other-ws',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.WORKSPACE_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.WORKSPACE_MISMATCH,
      )
    })

    it('blocks when snapshot version is a garbage string', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const garbageJob: Job = {
        ...baseJob,
        reservationUpdatedAt: '2026-11-06T10:00:00.000Z',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        version: 'garbage-version-string',
      })

      const outcome = await processNotificationJob(garbageJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_VERSION)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.INVALID_VERSION,
      )
    })

    it('blocks when snapshot version is an invalid Date object without throwing RangeError', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        version: new Date('invalid-date'),
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_VERSION)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.INVALID_VERSION,
      )
    })

    it('marks SUPERSEDED when job version is stale compared to repository snapshot version', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        version: '2026-11-06T10:05:00.000Z', // newer version in repo
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STALE_RESERVATION)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STALE_RESERVATION,
      )
    })

    it('detects PostgreSQL microsecond differences in version strings without ms truncation', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const microJob: Job = {
        ...baseJob,
        reservationUpdatedAt: '2026-11-06T10:00:00.123456Z',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        version: '2026-11-06T10:00:00.123789Z', // different microseconds
      })

      const outcome = await processNotificationJob(microJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STALE_RESERVATION)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STALE_RESERVATION,
      )
    })

    it('fails closed and supersedes when offset representations differ (exact raw string policy)', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const offsetJob: Job = {
        ...baseJob,
        reservationUpdatedAt: '2026-11-06T10:00:00Z',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        version: '2026-11-06T10:00:00+00:00', // same instant, different offset syntax -> fail closed
      })

      const outcome = await processNotificationJob(offsetJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STALE_RESERVATION)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STALE_RESERVATION,
      )
    })

    it('matches BOOKING_CHANGED event with CONFIRMED status in DB', async () => {
      const { deps, getCurrentReservationMock, sendMock } = createMockDeps()
      const changeJob: Job = {
        ...baseJob,
        event: 'BOOKING_CHANGED',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CONFIRMED',
      })

      const outcome = await processNotificationJob(changeJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('rejects BOOKING_CHANGED event when status is CHANGED (non-existent in DB)', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const changeJob: Job = {
        ...baseJob,
        event: 'BOOKING_CHANGED',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CHANGED',
      })

      const outcome = await processNotificationJob(changeJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STATUS_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STATUS_MISMATCH,
      )
    })

    it('marks SUPERSEDED when event does not match snapshot status', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const cancelJob: Job = {
        ...baseJob,
        event: 'BOOKING_CANCELLED',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CONFIRMED',
      })

      const outcome = await processNotificationJob(cancelJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STATUS_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STATUS_MISMATCH,
      )
    })

    it('matches REMINDER_24H and REMINDER_2H events with CONFIRMED status in DB', async () => {
      const { deps, getCurrentReservationMock, sendMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CONFIRMED',
      })

      for (const event of ['REMINDER_24H', 'REMINDER_2H'] as const) {
        const reminderJob: Job = {
          ...baseJob,
          event,
        }
        const outcome = await processNotificationJob(reminderJob, deps)
        expect(outcome.status).toBe('SENT')
        expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      }
      expect(sendMock).toHaveBeenCalledTimes(2)
    })

    it('marks SUPERSEDED when REMINDER_24H or REMINDER_2H status is not CONFIRMED', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CANCELLED',
      })

      const reminderJob: Job = {
        ...baseJob,
        event: 'REMINDER_24H',
      }
      const outcome = await processNotificationJob(reminderJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STATUS_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STATUS_MISMATCH,
      )
    })

    it('matches PAYMENT_CONFIRMED event with CONFIRMED status in DB', async () => {
      const { deps, getCurrentReservationMock, sendMock } = createMockDeps()
      const paymentJob: Job = {
        ...baseJob,
        event: 'PAYMENT_CONFIRMED',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CONFIRMED',
      })

      const outcome = await processNotificationJob(paymentJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('rejects PAYMENT_CONFIRMED event when status is not CONFIRMED (e.g. CANCELLED)', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      const paymentJob: Job = {
        ...baseJob,
        event: 'PAYMENT_CONFIRMED',
      }
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        status: 'CANCELLED',
      })

      const outcome = await processNotificationJob(paymentJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.STATUS_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.STATUS_MISMATCH,
      )
    })

    it('blocks when snapshot phone is not a valid 010 number', async () => {
      const { deps, getCurrentReservationMock, finishMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        phone: '02-999-9999',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_PHONE)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.INVALID_PHONE,
      )
    })

    it('blocks when snapshot phone contains malicious injected characters', async () => {
      const { deps, getCurrentReservationMock, finishMock, sendMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        phone: '010-1234-5678;DROP TABLE',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.INVALID_PHONE)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.INVALID_PHONE,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('informational evidence and template approval validation', () => {
    it('blocks when informational evidence is missing (absence of consent is not granted)', async () => {
      const { deps, getInformationalEvidenceMock, finishMock } = createMockDeps()
      getInformationalEvidenceMock.mockResolvedValue(null)

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_MISSING)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.EVIDENCE_MISSING,
      )
    })

    it('blocks when informational evidence granted is false', async () => {
      const { deps, getInformationalEvidenceMock, finishMock } = createMockDeps()
      getInformationalEvidenceMock.mockResolvedValue({
        ...baseEvidence,
        granted: false,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_NOT_GRANTED)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.EVIDENCE_NOT_GRANTED,
      )
    })

    it('blocks when evidence phone does not match snapshot normalized phone', async () => {
      const { deps, getInformationalEvidenceMock, finishMock } = createMockDeps()
      getInformationalEvidenceMock.mockResolvedValue({
        ...baseEvidence,
        subjectPhone: '010-9999-8888',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH,
      )
    })

    it('blocks when evidence phone contains malicious characters even if digits seem to match', async () => {
      const { deps, getInformationalEvidenceMock, finishMock, sendMock } = createMockDeps()
      getInformationalEvidenceMock.mockResolvedValue({
        ...baseEvidence,
        subjectPhone: '010-1234-abcd5678', // malicious letters mixed
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('blocks when template approval is missing or approved is false', async () => {
      const { deps, getTemplateApprovalMock, finishMock } = createMockDeps()
      getTemplateApprovalMock.mockResolvedValue({
        approved: false,
        templateId: 'tpl-1',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.TEMPLATE_NOT_APPROVED)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.TEMPLATE_NOT_APPROVED,
      )
    })

    it('blocks when templateId is blank', async () => {
      const { deps, getTemplateApprovalMock, finishMock } = createMockDeps()
      getTemplateApprovalMock.mockResolvedValue({
        approved: true,
        templateId: '   ',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.TEMPLATE_ID_BLANK)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.TEMPLATE_ID_BLANK,
      )
    })
  })

  describe('repository exception safety (PII protection and READ_FAILED handling)', () => {
    it.each([
      {
        name: '1st getCurrentReservation throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getCurrentReservationMock.mockRejectedValueOnce(new Error('DB read fail user=01012345678'))
        },
      },
      {
        name: '1st getInformationalEvidence throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getInformationalEvidenceMock.mockRejectedValueOnce(new Error('Consent table error user=01012345678'))
        },
      },
      {
        name: '1st getTemplateApproval throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getTemplateApprovalMock.mockRejectedValueOnce(new Error('Approval API error key=secret123'))
        },
      },
      {
        name: '2nd getCurrentReservation throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getCurrentReservationMock
            .mockResolvedValueOnce({ ...baseSnapshot })
            .mockRejectedValueOnce(new Error('Second read crash phone=01012345678'))
        },
      },
      {
        name: '2nd getInformationalEvidence throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getCurrentReservationMock
            .mockResolvedValueOnce({ ...baseSnapshot })
            .mockResolvedValueOnce({ ...baseSnapshot })
          m.getInformationalEvidenceMock
            .mockResolvedValueOnce({ ...baseEvidence })
            .mockRejectedValueOnce(new Error('Second evidence crash phone=01012345678'))
        },
      },
      {
        name: '2nd getTemplateApproval throws',
        setup: (m: ReturnType<typeof createMockDeps>) => {
          m.getCurrentReservationMock
            .mockResolvedValueOnce({ ...baseSnapshot })
            .mockResolvedValueOnce({ ...baseSnapshot })
          m.getTemplateApprovalMock
            .mockResolvedValueOnce({ ...baseApproval })
            .mockRejectedValueOnce(new Error('Second approval crash key=secret123'))
        },
      },
    ])('handles $name safely by returning BLOCKED and READ_FAILED without calling send', async ({ setup }) => {
      const mocks = createMockDeps()
      setup(mocks)

      const outcome = await processNotificationJob(baseJob, mocks.deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.READ_FAILED)
      expect(outcome.finishRecorded).toBe(true)
      expect(mocks.finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.READ_FAILED,
      )
      expect(mocks.sendMock).not.toHaveBeenCalled()
    })
  })

  describe('double-read (revocation, customer/phone change before send) and CAS guard', () => {
    it('marks SUPERSEDED when double-read detects reservation version changed right before send', async () => {
      const { deps, getCurrentReservationMock, finishMock, sendMock } = createMockDeps()
      getCurrentReservationMock
        .mockResolvedValueOnce({ ...baseSnapshot })
        .mockResolvedValueOnce({
          ...baseSnapshot,
          version: '2026-11-06T10:00:05.000Z',
        })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SUPERSEDED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CHANGED_BEFORE_SEND)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SUPERSEDED',
        OUTBOX_REASON.CHANGED_BEFORE_SEND,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('blocks send when secondSnapshot phone or customerId changes before send', async () => {
      const { deps, getCurrentReservationMock, finishMock, sendMock } = createMockDeps()
      getCurrentReservationMock
        .mockResolvedValueOnce({ ...baseSnapshot })
        .mockResolvedValueOnce({
          ...baseSnapshot,
          phone: '010-8888-7777',
        })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CHANGED_BEFORE_SEND)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.CHANGED_BEFORE_SEND,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('blocks send when secondSnapshot evidence check reveals consent revoked before send', async () => {
      const { deps, getCurrentReservationMock, getInformationalEvidenceMock, finishMock, sendMock } = createMockDeps()
      getCurrentReservationMock
        .mockResolvedValueOnce({ ...baseSnapshot })
        .mockResolvedValueOnce({ ...baseSnapshot })

      getInformationalEvidenceMock
        .mockResolvedValueOnce({ ...baseEvidence })
        .mockResolvedValueOnce({ ...baseEvidence, granted: false })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.EVIDENCE_NOT_GRANTED)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.EVIDENCE_NOT_GRANTED,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('blocks send when template approval is revoked right before send', async () => {
      const { deps, getCurrentReservationMock, getTemplateApprovalMock, finishMock, sendMock } = createMockDeps()
      getCurrentReservationMock
        .mockResolvedValueOnce({ ...baseSnapshot })
        .mockResolvedValueOnce({ ...baseSnapshot })

      getTemplateApprovalMock
        .mockResolvedValueOnce({ ...baseApproval })
        .mockResolvedValueOnce({ approved: false, templateId: 'tpl-confirmed-001' })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.TEMPLATE_NOT_APPROVED)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.TEMPLATE_NOT_APPROVED,
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('prevents send and returns CAS_LOST when markSending returns false (CAS loss)', async () => {
      const { deps, markSendingMock, sendMock } = createMockDeps()
      markSendingMock.mockResolvedValue(false)

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('CAS_LOST')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CAS_LOSS)
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('safely catches markSending throwing errors with sensitive info and returns CAS_LOST', async () => {
      const { deps, markSendingMock, sendMock } = createMockDeps()
      markSendingMock.mockRejectedValue(new Error('Sensitive DB socket error phone=01012345678 customer=김민감'))

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('CAS_LOST')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.CAS_LOSS)
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('send execution and failure handling', () => {
    it('returns BLOCKED and SEND_PRECHECK_FAILED when send returns notSent: true (precheck failure before external network call)', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({ accepted: false, notSent: true })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SEND_PRECHECK_FAILED)
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.SEND_PRECHECK_FAILED,
      )
    })

    it('returns UNKNOWN without automatic retry when send throws an exception', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockRejectedValue(new Error('Network gateway timeout'))

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SEND_EXCEPTION)
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        OUTBOX_REASON.SEND_EXCEPTION,
      )
    })

    it('returns UNKNOWN when send returns accepted: false (delivery unconfirmed/rejected)', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({ accepted: false })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SEND_REJECTED)
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        OUTBOX_REASON.SEND_REJECTED,
      )
    })

    it('records SEND_REJECTED_<failureCode> for HTTP 401 error', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({
        accepted: false,
        failureCode: 'HTTP_401_INVALID_API_KEY',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe('SEND_REJECTED_HTTP_401_INVALID_API_KEY')
      expect(outcome.reasonCode).toMatch(/^[A-Z0-9_]{1,64}$/)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        'SEND_REJECTED_HTTP_401_INVALID_API_KEY',
      )
    })

    it('records SEND_REJECTED_<failureCode> for failedMessageList status code', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({
        accepted: false,
        failureCode: 'SOLAPI_4001',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe('SEND_REJECTED_SOLAPI_4001')
      expect(outcome.reasonCode).toMatch(/^[A-Z0-9_]{1,64}$/)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        'SEND_REJECTED_SOLAPI_4001',
      )
    })

    it('records SEND_REJECTED_<failureCode> for local pre-rejections (LOCAL_CONSENT, LOCAL_AD, LOCAL_PHONE, etc.)', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      const localCodes = [
        'LOCAL_CONSENT',
        'LOCAL_AD',
        'LOCAL_PHONE',
        'LOCAL_VARIABLES',
        'LOCAL_TEMPLATE_UNMAPPED',
        'NETWORK_EXCEPTION',
      ]

      for (const code of localCodes) {
        sendMock.mockResolvedValueOnce({
          accepted: false,
          failureCode: code,
        })

        const outcome = await processNotificationJob(baseJob, deps)

        expect(outcome.status).toBe('UNKNOWN')
        expect(outcome.reasonCode).toBe(`SEND_REJECTED_${code}`)
        expect(outcome.reasonCode).toMatch(/^[A-Z0-9_]{1,64}$/)
        expect(finishMock).toHaveBeenCalledWith(
          'job-123',
          'lease-token-abc',
          'UNKNOWN',
          `SEND_REJECTED_${code}`,
        )
      }
    })

    it('never leaks secret, phone, or raw message text into reasonCode and truncates to 64 chars', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      // 64자를 넘는 매우 긴 failureCode
      const excessivelyLongCode = 'VERY_LONG_ERROR_CODE_THAT_EXCEEDS_THE_LIMIT_OF_SIXTY_FOUR_CHARACTERS_XYZ'
      sendMock.mockResolvedValue({
        accepted: false,
        failureCode: excessivelyLongCode,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode.length).toBeLessThanOrEqual(64)
      expect(outcome.reasonCode).toMatch(/^[A-Z0-9_]{1,64}$/)
      expect(outcome.reasonCode).not.toContain('01012345678')
      expect(outcome.reasonCode).not.toContain('secret')
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        outcome.reasonCode,
      )
    })

    it('falls back to SEND_REJECTED if failureCode contains invalid characters', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({
        accepted: false,
        failureCode: 'invalid;DROP TABLE;-- lowercase',
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SEND_REJECTED)
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'UNKNOWN',
        OUTBOX_REASON.SEND_REJECTED,
      )
    })

    it('returns UNKNOWN and prevents resend when send succeeded but post-send finish fails', async () => {
      const { deps, sendMock, finishMock } = createMockDeps()
      sendMock.mockResolvedValue({ accepted: true })
      finishMock.mockResolvedValue(false)

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('UNKNOWN')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.POST_SEND_RECORD_FAILED)
      expect(outcome.finishRecorded).toBe(false)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('successful send execution', () => {
    it('executes send exactly once, marks SENT, and returns SENT outcome', async () => {
      const { deps, sendMock, finishMock, markSendingMock } = createMockDeps()

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(outcome.finishRecorded).toBe(true)

      expect(markSendingMock).toHaveBeenCalledWith('job-123', 'lease-token-abc')
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: 'res-789' }),
        baseJob,
        'tpl-confirmed-001',
      )
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'SENT',
        OUTBOX_REASON.SENT_SUCCESS,
      )
    })
  })

  describe('security and privacy protection', () => {
    it('never contains phone numbers, customer names, or secrets in returned reasonCodes', async () => {
      const { deps, getCurrentReservationMock } = createMockDeps()
      getCurrentReservationMock.mockResolvedValue({
        ...baseSnapshot,
        phone: '010-9999-8888',
        payload: {
          customerName: '민감고객명',
          secretToken: 'secret-123456',
        },
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(Object.values(OUTBOX_REASON)).toContain(outcome.reasonCode)
      expect(outcome.reasonCode).not.toContain('민감고객명')
      expect(outcome.reasonCode).not.toContain('010')
      expect(outcome.reasonCode).not.toContain('secret')
    })
  })

  describe('test allowlist gate (claim: 1, markSending: 0, send: 0)', () => {
    it('미설정 시 기존 동작을 유지하여 정상 발송(SENT)을 수행한다 (하위호환)', async () => {
      const { deps, sendMock, markSendingMock } = createMockDeps({
        allowlist: undefined,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(markSendingMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('allowlist에 포함된 번호인 경우 정상 발송(SENT) 진행 및 send 1회 호출', async () => {
      const allowlist = createOutboxAllowlist('010-1234-5678, 010-9999-8888')
      const { deps, sendMock, markSendingMock } = createMockDeps({
        allowlist,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.SENT_SUCCESS)
      expect(markSendingMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('allowlist에 포함되지 않은 번호인 경우 claim 이후 markSending 이전에 BLOCKED/NOT_ALLOWLISTED로 차단 (send 0회)', async () => {
      const allowlist = createOutboxAllowlist('010-9999-8888, 010-7777-6666')
      const { deps, claimMock, markSendingMock, sendMock, finishMock } = createMockDeps({
        allowlist,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.NOT_ALLOWLISTED)
      expect(claimMock).toHaveBeenCalledTimes(1)
      expect(markSendingMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.NOT_ALLOWLISTED,
      )
    })

    it('allowlist가 유효 항목 0개로 설정된 경우 fail-closed(전원 차단)되어 send 0회로 BLOCKED 된다', async () => {
      const allowlist = createOutboxAllowlist('invalid, not-a-number, 02-123-4567')
      const { deps, claimMock, markSendingMock, sendMock, finishMock } = createMockDeps({
        allowlist,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('BLOCKED')
      expect(outcome.reasonCode).toBe(OUTBOX_REASON.NOT_ALLOWLISTED)
      expect(claimMock).toHaveBeenCalledTimes(1)
      expect(markSendingMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        OUTBOX_REASON.NOT_ALLOWLISTED,
      )
    })

    it('함수 형태의 allowlist 프레디케이트 주입도 지원한다', async () => {
      const isPhoneAllowed = (phone: string) => phone === '01012345678'
      const { deps, sendMock, markSendingMock } = createMockDeps({
        allowlist: isPhoneAllowed,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.status).toBe('SENT')
      expect(markSendingMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('차단 시 반환 outcome 및 finish 호출에 고객 전화번호가 노출되지 않는다', async () => {
      const allowlist = createOutboxAllowlist('010-9999-8888')
      const { deps, finishMock } = createMockDeps({
        allowlist,
      })

      const outcome = await processNotificationJob(baseJob, deps)

      expect(outcome.reasonCode).toBe('NOT_ALLOWLISTED')
      expect(outcome.reasonCode).not.toContain('010')
      expect(outcome.reasonCode).not.toContain('12345678')
      expect(JSON.stringify(outcome)).not.toContain('01012345678')
      expect(finishMock).toHaveBeenCalledWith(
        'job-123',
        'lease-token-abc',
        'BLOCKED',
        'NOT_ALLOWLISTED',
      )
    })
  })
})
