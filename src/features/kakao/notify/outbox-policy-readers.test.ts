import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  ALIMTALK_TEMPLATES,
  SOHEE_BOOKING_CONFIRMED,
  SOHEE_BOOKING_CHANGED,
} from './templates'
import { createOutboxPolicyReaders } from './outbox-policy-readers'
import type { SolapiEnv } from './solapi-factory'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// Mock SupabaseClient 팩토리 헬퍼
function createMockClient(handlers: {
  evidence?: (params: Record<string, unknown>) => unknown
  reservations?: (params: Record<string, unknown>) => unknown
  customerOptOuts?: (params: Record<string, unknown>) => unknown
  templateApprovals?: (params: Record<string, unknown>) => unknown
}): Pick<SupabaseClient, 'from'> {
  return {
    from: (table: string) => {
      if (table === 'kakao_notification_evidence') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          is: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          lte: (col: string, val: unknown) => {
            filters[`${col}_lte`] = val
            return builder
          },
          maybeSingle: async () => {
            try {
              const res = handlers.evidence ? handlers.evidence(filters) : null
              return { data: res, error: null }
            } catch (err) {
              return { data: null, error: err }
            }
          },
        }
        return builder as unknown as ReturnType<SupabaseClient['from']>
      }

      if (table === 'reservations') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          maybeSingle: async () => {
            try {
              const res = handlers.reservations ? handlers.reservations(filters) : null
              return { data: res, error: null }
            } catch (err) {
              return { data: null, error: err }
            }
          },
        }
        return builder as unknown as ReturnType<SupabaseClient['from']>
      }

      if (table === 'customer_opt_outs') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          maybeSingle: async () => {
            try {
              const res = handlers.customerOptOuts ? handlers.customerOptOuts(filters) : null
              return { data: res, error: null }
            } catch (err) {
              return { data: null, error: err }
            }
          },
        }
        return builder as unknown as ReturnType<SupabaseClient['from']>
      }

      if (table === 'kakao_template_approvals') {
        const filters: Record<string, unknown> = {}
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            filters[col] = val
            return builder
          },
          maybeSingle: async () => {
            try {
              const res = handlers.templateApprovals ? handlers.templateApprovals(filters) : null
              return { data: res, error: null }
            } catch (err) {
              return { data: null, error: err }
            }
          },
        }
        return builder as unknown as ReturnType<SupabaseClient['from']>
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('createOutboxPolicyReaders', () => {
  const baseNow = new Date('2026-11-06T12:00:00.000Z')
  const baseEnv: SolapiEnv = {
    SOLAPI_PF_ID: '@sohee_channel',
    SOLAPI_TEMPLATE_IDS: JSON.stringify({
      [SOHEE_BOOKING_CONFIRMED]: 'tpl_confirmed_123',
      [SOHEE_BOOKING_CHANGED]: 'tpl_changed_456',
    }),
  }

  describe('evidenceReader', () => {
    const validPhone = '010-1234-5678'
    const normalizedPhone = '+821012345678'
    const validPhoneSha256 = sha256(normalizedPhone)

    it('returns granted evidence when all conditions match valid proof and customer has not opted out', async () => {
      const client = createMockClient({
        evidence: (params) => {
          expect(params.workspace_id).toBe('ws-1')
          expect(params.reservation_id).toBe('res-1')
          expect(params.subject_phone_sha256).toBe(validPhoneSha256)
          expect(params.purpose).toBe('INFO')
          return {
            workspace_id: 'ws-1',
            reservation_id: 'res-1',
            subject_phone_sha256: validPhoneSha256,
            purpose: 'INFO',
            granted_at: '2026-11-06T10:00:00.000Z',
            revoked_at: null,
            evidence_ref: 'proof-session-ref-001',
          }
        },
        reservations: (params) => {
          expect(params.workspace_id).toBe('ws-1')
          expect(params.id).toBe('res-1')
          return {
            id: 'res-1',
            workspace_id: 'ws-1',
            customer_id: 'cust-100',
          }
        },
        customerOptOuts: () => null,
      })

      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toEqual({
        granted: true,
        subjectPhone: '01012345678', // query.phone 원문 '010-1234-5678' 대신 정규화된 010 번호 반환
        workspaceId: 'ws-1',
        reservationId: 'res-1',
      })
    })

    it('returns null when phone normalization fails (invalid phone number)', async () => {
      const client = createMockClient({})
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: '02-123-4567', // 지역번호 (유효하지 않은 알림톡 번호)
      })

      expect(res).toBeNull()
    })

    it('returns null when phone sha256 does not match DB evidence', async () => {
      const client = createMockClient({
        evidence: () => null,
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: '010-9999-9999',
      })

      expect(res).toBeNull()
    })

    it('returns null when purpose in evidence is not INFO', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'MARKETING',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('returns null when granted_at is in the future (future timestamp)', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T13:00:00.000Z', // 1 hour after baseNow
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('returns null when revoked_at is not null (evidence revoked)', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: '2026-11-06T11:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('returns null when evidence_ref is missing or empty string', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: '   ',
        }),
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('returns null when reservation does not exist', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
        reservations: () => null,
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('returns null when customer has an opt-out row in customer_opt_outs', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
        reservations: () => ({
          id: 'res-1',
          workspace_id: 'ws-1',
          customer_id: 'cust-opted-out',
        }),
        customerOptOuts: (params) => {
          expect(params.workspace_id).toBe('ws-1')
          expect(params.customer_id).toBe('cust-opted-out')
          return {
            id: 'optout-1',
            workspace_id: 'ws-1',
            customer_id: 'cust-opted-out',
            source: 'customer_request',
          }
        },
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('confirms absence of opt-out row alone is NOT a grant basis when evidence is missing', async () => {
      const client = createMockClient({
        evidence: () => null, // evidence 없음
        reservations: () => ({
          id: 'res-1',
          workspace_id: 'ws-1',
          customer_id: 'cust-100',
        }),
        customerOptOuts: () => null, // opt-out도 없음
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('throws static error without leaking PII or raw error when DB query fails', async () => {
      const client = createMockClient({
        evidence: () => {
          throw new Error('Postgres connection reset at 10.0.0.1 for phone ' + validPhone)
        },
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      await expect(
        evidenceReader({
          workspaceId: 'ws-1',
          reservationId: 'res-1',
          phone: validPhone,
        }),
      ).rejects.toThrow('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
    })

    it('returns null when recipient phone_sha256 has an opt-out row in customer_opt_outs (번호 기준 수신거부 시 근거 null)', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
        reservations: () => ({
          id: 'res-1',
          workspace_id: 'ws-1',
          customer_id: 'cust-not-opted-out',
        }),
        customerOptOuts: (params) => {
          if (params.phone_sha256 === validPhoneSha256) {
            expect(params.workspace_id).toBe('ws-1')
            return {
              id: 'optout-phone-1',
              workspace_id: 'ws-1',
              phone_sha256: validPhoneSha256,
            }
          }
          return null
        },
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await evidenceReader({
        workspaceId: 'ws-1',
        reservationId: 'res-1',
        phone: validPhone,
      })

      expect(res).toBeNull()
    })

    it('throws static error when customer_opt_outs phone_sha256 query fails (fail-closed)', async () => {
      const client = createMockClient({
        evidence: () => ({
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          subject_phone_sha256: validPhoneSha256,
          purpose: 'INFO',
          granted_at: '2026-11-06T10:00:00.000Z',
          revoked_at: null,
          evidence_ref: 'proof-001',
        }),
        reservations: () => ({
          id: 'res-1',
          workspace_id: 'ws-1',
          customer_id: 'cust-clean',
        }),
        customerOptOuts: (params) => {
          if (params.phone_sha256) {
            throw new Error('Database error during phone opt-out lookup')
          }
          return null
        },
      })
      const { evidenceReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      await expect(
        evidenceReader({
          workspaceId: 'ws-1',
          reservationId: 'res-1',
          phone: validPhone,
        }),
      ).rejects.toThrow('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
    })
  })

  describe('templateApprovalReader', () => {
    const confirmedTemplate = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED
    const expectedBodySha256 = sha256(confirmedTemplate.templateBody)

    it('returns approved true with templateId when template is approved within 24 hours and all mappings match', async () => {
      const client = createMockClient({
        templateApprovals: (params) => {
          expect(params.template_code).toBe(SOHEE_BOOKING_CONFIRMED)
          return {
            template_code: SOHEE_BOOKING_CONFIRMED,
            template_id: 'tpl_confirmed_123',
            channel_id: '@sohee_channel',
            body_sha256: expectedBodySha256,
            state: 'APPROVED',
            verified_at: '2026-11-06T10:00:00.000Z', // 2 hours before baseNow
            evidence_ref: 'proof-solapi-audit-001',
          }
        },
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')

      expect(res).toEqual({
        approved: true,
        templateId: 'tpl_confirmed_123',
      })
    })

    it('returns approved true with templateId for REMINDER_24H and REMINDER_2H events', async () => {
      const r24Template = ALIMTALK_TEMPLATES.REMINDER_24H
      const r2Template = ALIMTALK_TEMPLATES.REMINDER_2H
      const reminderEnv: SolapiEnv = {
        SOLAPI_PF_ID: '@sohee_channel',
        SOLAPI_TEMPLATE_IDS: JSON.stringify({
          SOHEE_REMINDER_24H_V1: 'tpl_reminder_24h_123',
          SOHEE_REMINDER_2H_V1: 'tpl_reminder_2h_456',
        }),
      }

      const client = createMockClient({
        templateApprovals: (params) => {
          if (params.template_code === 'SOHEE_REMINDER_24H_V1') {
            return {
              template_code: 'SOHEE_REMINDER_24H_V1',
              template_id: 'tpl_reminder_24h_123',
              channel_id: '@sohee_channel',
              body_sha256: sha256(r24Template.templateBody),
              state: 'APPROVED',
              verified_at: '2026-11-06T10:00:00.000Z',
              evidence_ref: 'proof-r24-001',
            }
          }
          if (params.template_code === 'SOHEE_REMINDER_2H_V1') {
            return {
              template_code: 'SOHEE_REMINDER_2H_V1',
              template_id: 'tpl_reminder_2h_456',
              channel_id: '@sohee_channel',
              body_sha256: sha256(r2Template.templateBody),
              state: 'APPROVED',
              verified_at: '2026-11-06T10:00:00.000Z',
              evidence_ref: 'proof-r2-001',
            }
          }
          return null
        },
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, reminderEnv, () => baseNow)
      const res24 = await templateApprovalReader('REMINDER_24H')
      expect(res24).toEqual({
        approved: true,
        templateId: 'tpl_reminder_24h_123',
      })

      const res2 = await templateApprovalReader('REMINDER_2H')
      expect(res2).toEqual({
        approved: true,
        templateId: 'tpl_reminder_2h_456',
      })
    })

    it('returns null for unknown event code', async () => {
      const client = createMockClient({})
      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)

      const res = await templateApprovalReader('UNKNOWN_EVENT' as unknown as Parameters<typeof templateApprovalReader>[0])
      expect(res).toBeNull()
    })

    it('returns approved true with templateId for PAYMENT_CONFIRMED event when approved in DB and env', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: 'SOHEE_PAYMENT_CONFIRMED_V1',
          template_id: 'tpl_payment_123',
          channel_id: '@sohee_channel',
          body_sha256: sha256(ALIMTALK_TEMPLATES.PAYMENT_CONFIRMED.templateBody),
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const envWithPayment: SolapiEnv = {
        ...baseEnv,
        SOLAPI_TEMPLATE_IDS: JSON.stringify({
          SOHEE_PAYMENT_CONFIRMED_V1: 'tpl_payment_123',
        }),
      }

      const { templateApprovalReader } = createOutboxPolicyReaders(client, envWithPayment, () => baseNow)
      const res = await templateApprovalReader('PAYMENT_CONFIRMED')
      expect(res).toEqual({
        approved: true,
        templateId: 'tpl_payment_123',
      })
    })

    it('sanitizes templateIdMap correctly and rejects arrays, null, blank string, and prototype keys', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      // Array input
      const { templateApprovalReader: arrayReader } = createOutboxPolicyReaders(
        client,
        { ...baseEnv, SOLAPI_TEMPLATE_IDS: JSON.stringify(['tpl_confirmed_123']) },
        () => baseNow,
      )
      expect(await arrayReader('BOOKING_CONFIRMED')).toBeNull()

      // Prototype pollution / blank / non-string values
      const corruptedEnv: SolapiEnv = {
        ...baseEnv,
        SOLAPI_TEMPLATE_IDS: JSON.stringify({
          __proto__: { [SOHEE_BOOKING_CONFIRMED]: 'tpl_injected' },
          [SOHEE_BOOKING_CONFIRMED]: '   ', // blank string
        }),
      }
      const { templateApprovalReader: corruptedReader } = createOutboxPolicyReaders(
        client,
        corruptedEnv,
        () => baseNow,
      )
      expect(await corruptedReader('BOOKING_CONFIRMED')).toBeNull()
    })

    it('returns null when body_sha256 does not match current local template body', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: sha256('different-body-modified'),
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns null when channel_id in DB does not match env.SOLAPI_PF_ID', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@other_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns null when template_id in DB does not match env.SOLAPI_TEMPLATE_IDS mapping', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_different_id_999',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns null when state is REJECTED', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'REJECTED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns null when state is PENDING', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'PENDING',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns null when verified_at is in the future (future timestamp)', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: '2026-11-06T13:00:00.000Z', // 1 hour future
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('returns approved true when verified_at is 24 hours ago under default 30-day (720h) policy', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: new Date(baseNow.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')

      expect(res).toEqual({
        approved: true,
        templateId: 'tpl_confirmed_123',
      })
    })

    it('returns approved true when verified_at is 29 days ago under default 30-day validity', async () => {
      const verifiedAt29DaysAgo = new Date(baseNow.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString()
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: verifiedAt29DaysAgo,
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')

      expect(res).toEqual({
        approved: true,
        templateId: 'tpl_confirmed_123',
      })
    })

    it('returns null when verified_at is 31 days ago (exceeds default 30-day/720h validity)', async () => {
      const verifiedAt31DaysAgo = new Date(baseNow.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString()
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: verifiedAt31DaysAgo,
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('respects KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS=6 (7 hours ago rejected, 5 hours ago approved)', async () => {
      const customEnv: SolapiEnv = {
        ...baseEnv,
        KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS: '6',
      }

      const client7HoursAgo = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: new Date(baseNow.getTime() - 7 * 60 * 60 * 1000).toISOString(),
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader: reader7h } = createOutboxPolicyReaders(client7HoursAgo, customEnv, () => baseNow)
      const res7h = await reader7h('BOOKING_CONFIRMED')
      expect(res7h).toBeNull()

      const client5HoursAgo = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: new Date(baseNow.getTime() - 5 * 60 * 60 * 1000).toISOString(),
          evidence_ref: 'proof-001',
        }),
      })

      const { templateApprovalReader: reader5h } = createOutboxPolicyReaders(client5HoursAgo, customEnv, () => baseNow)
      const res5h = await reader5h('BOOKING_CONFIRMED')
      expect(res5h).toEqual({
        approved: true,
        templateId: 'tpl_confirmed_123',
      })
    })

    it('falls back to default 720 hours when KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS is invalid or out of range', async () => {
      const invalidValues = ['not-a-number', 'NaN', '0', '-10', '2161', '6.5', '']

      for (const val of invalidValues) {
        const fallbackEnv: SolapiEnv = {
          ...baseEnv,
          KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS: val,
        }

        // 29일 전 (통과해야 함)
        const client29d = createMockClient({
          templateApprovals: () => ({
            template_code: SOHEE_BOOKING_CONFIRMED,
            template_id: 'tpl_confirmed_123',
            channel_id: '@sohee_channel',
            body_sha256: expectedBodySha256,
            state: 'APPROVED',
            verified_at: new Date(baseNow.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString(),
            evidence_ref: 'proof-001',
          }),
        })

        const { templateApprovalReader: reader29d } = createOutboxPolicyReaders(client29d, fallbackEnv, () => baseNow)
        const res29d = await reader29d('BOOKING_CONFIRMED')
        expect(res29d, `Should approve 29 days ago for env value: "${val}"`).toEqual({
          approved: true,
          templateId: 'tpl_confirmed_123',
        })

        // 31일 전 (거부되어야 함)
        const client31d = createMockClient({
          templateApprovals: () => ({
            template_code: SOHEE_BOOKING_CONFIRMED,
            template_id: 'tpl_confirmed_123',
            channel_id: '@sohee_channel',
            body_sha256: expectedBodySha256,
            state: 'APPROVED',
            verified_at: new Date(baseNow.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
            evidence_ref: 'proof-001',
          }),
        })

        const { templateApprovalReader: reader31d } = createOutboxPolicyReaders(client31d, fallbackEnv, () => baseNow)
        const res31d = await reader31d('BOOKING_CONFIRMED')
        expect(res31d, `Should reject 31 days ago for env value: "${val}"`).toBeNull()
      }
    })

    it('returns null when evidence_ref is missing or empty string', async () => {
      const client = createMockClient({
        templateApprovals: () => ({
          template_code: SOHEE_BOOKING_CONFIRMED,
          template_id: 'tpl_confirmed_123',
          channel_id: '@sohee_channel',
          body_sha256: expectedBodySha256,
          state: 'APPROVED',
          verified_at: '2026-11-06T10:00:00.000Z',
          evidence_ref: '   ',
        }),
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      const res = await templateApprovalReader('BOOKING_CONFIRMED')
      expect(res).toBeNull()
    })

    it('throws static error when DB query fails', async () => {
      const client = createMockClient({
        templateApprovals: () => {
          throw new Error('Connection timeout')
        },
      })

      const { templateApprovalReader } = createOutboxPolicyReaders(client, baseEnv, () => baseNow)
      await expect(templateApprovalReader('BOOKING_CONFIRMED')).rejects.toThrow(
        'FAILED_TO_READ_TEMPLATE_APPROVAL',
      )
    })
  })
})
