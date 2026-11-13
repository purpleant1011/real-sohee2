import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { normalizeKrPhone } from './alimtalk-contract'
import {
  buildOwnerAttestedEvidenceRow,
  type OwnerAttestedEvidenceRow,
} from './evidence-record'
import { createOutboxPolicyReaders } from './outbox-policy-readers'
import type { SolapiEnv } from './solapi-factory'

function calculateExpectedSha256(phone: string): string {
  return createHash('sha256').update(normalizeKrPhone(phone)).digest('hex')
}

describe('evidence-record', () => {
  const validTimestamp = new Date('2026-11-06T10:00:00.000Z')
  const defaultInput = {
    workspaceId: 'ws-111',
    reservationId: 'res-222',
    phone: '010-1234-5678',
    actorUserId: 'user-333',
    attested: true,
    recordedAt: validTimestamp,
  }

  describe('buildOwnerAttestedEvidenceRow - success cases', () => {
    it('returns a properly structured OwnerAttestedEvidenceRow for valid input', () => {
      const row = buildOwnerAttestedEvidenceRow(defaultInput)
      expect(row).not.toBeNull()
      const nonNullRow = row as OwnerAttestedEvidenceRow

      expect(nonNullRow.workspace_id).toBe('ws-111')
      expect(nonNullRow.reservation_id).toBe('res-222')
      expect(nonNullRow.purpose).toBe('INFO')
      expect(nonNullRow.granted_at).toBe('2026-11-06T10:00:00.000Z')
      expect(nonNullRow.subject_phone_sha256).toMatch(/^[0-9a-f]{64}$/)

      const parsedRef = JSON.parse(nonNullRow.evidence_ref)
      expect(parsedRef).toEqual({
        kind: 'OWNER_RECORDED_EVIDENCE',
        source: 'OWNER_ATTESTED_CHECKBOX',
        version: 'v1',
        workspace_id: 'ws-111',
        reservation_id: 'res-222',
        actor_id: 'user-333',
        recorded_at: '2026-11-06T10:00:00.000Z',
      })
      expect(nonNullRow.evidence_ref.length).toBeLessThanOrEqual(500)
    })

    it('trims whitespace around workspaceId, reservationId, and actorUserId', () => {
      const row = buildOwnerAttestedEvidenceRow({
        ...defaultInput,
        workspaceId: '  ws-trimmed  ',
        reservationId: '  res-trimmed  ',
        actorUserId: '  user-trimmed  ',
      })
      expect(row).not.toBeNull()
      expect(row?.workspace_id).toBe('ws-trimmed')
      expect(row?.reservation_id).toBe('res-trimmed')
      const parsedRef = JSON.parse(row!.evidence_ref)
      expect(parsedRef.workspace_id).toBe('ws-trimmed')
      expect(parsedRef.reservation_id).toBe('res-trimmed')
      expect(parsedRef.actor_id).toBe('user-trimmed')
    })
  })

  describe('privacy and PII isolation', () => {
    it('does not contain raw phone digits or customer identifiers in any row field or JSON string', () => {
      const rawPhone = '010-9876-5432'
      const row = buildOwnerAttestedEvidenceRow({
        ...defaultInput,
        phone: rawPhone,
      })
      expect(row).not.toBeNull()

      const rawSubstrings = ['010-9876-5432', '01098765432', '98765432', '+821098765432']
      const serialized = JSON.stringify(row)

      for (const sub of rawSubstrings) {
        expect(row?.workspace_id).not.toContain(sub)
        expect(row?.reservation_id).not.toContain(sub)
        expect(row?.subject_phone_sha256).not.toContain(sub)
        expect(row?.purpose).not.toContain(sub)
        expect(row?.granted_at).not.toContain(sub)
        expect(row?.evidence_ref).not.toContain(sub)
        expect(serialized).not.toContain(sub)
      }
    })
  })

  describe('null conditions (fail-closed)', () => {
    it('returns null when attested is not true', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, attested: false })).toBeNull()
      // @ts-expect-error testing invalid runtime attested value
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, attested: undefined })).toBeNull()
      // @ts-expect-error testing invalid runtime attested value
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, attested: null })).toBeNull()
      // @ts-expect-error testing invalid runtime attested value
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, attested: 'true' })).toBeNull()
    })

    it('returns null when phone is missing, empty, or whitespace', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: null })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: undefined })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '   ' })).toBeNull()
    })

    it('returns null when phone normalization fails (non-010 or invalid format)', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '02-123-4567' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '070-1234-5678' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '011-123-4567' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '+1234567890' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: 'invalid-number' })).toBeNull()
    })

    it('returns null when workspaceId is blank or not a string', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, workspaceId: '' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, workspaceId: '   ' })).toBeNull()
      // @ts-expect-error testing invalid runtime workspaceId
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, workspaceId: null })).toBeNull()
    })

    it('returns null when reservationId is blank or not a string', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, reservationId: '' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, reservationId: '   ' })).toBeNull()
      // @ts-expect-error testing invalid runtime reservationId
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, reservationId: null })).toBeNull()
    })

    it('returns null when actorUserId is blank or not a string', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, actorUserId: '' })).toBeNull()
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, actorUserId: '   ' })).toBeNull()
      // @ts-expect-error testing invalid runtime actorUserId
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, actorUserId: null })).toBeNull()
    })

    it('returns null when recordedAt is invalid Date', () => {
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, recordedAt: new Date('invalid') })).toBeNull()
      // @ts-expect-error testing invalid runtime recordedAt
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, recordedAt: null })).toBeNull()
      // @ts-expect-error testing invalid runtime recordedAt
      expect(buildOwnerAttestedEvidenceRow({ ...defaultInput, recordedAt: undefined })).toBeNull()
    })

    it('returns null when evidence_ref length exceeds 500 characters', () => {
      const veryLongId = 'a'.repeat(400)
      expect(
        buildOwnerAttestedEvidenceRow({
          ...defaultInput,
          workspaceId: veryLongId,
        }),
      ).toBeNull()
    })

    it('returns null when input is not an object', () => {
      // @ts-expect-error testing null input
      expect(buildOwnerAttestedEvidenceRow(null)).toBeNull()
      // @ts-expect-error testing undefined input
      expect(buildOwnerAttestedEvidenceRow(undefined)).toBeNull()
    })
  })

  describe('SHA256 parity with outbox-policy-readers.ts', () => {
    it('generates the exact same hash as outbox-policy-readers calculateSha256 logic', () => {
      const testPhones = [
        '010-1234-5678',
        '01012345678',
        '+82 10 1234 5678',
        '+821012345678',
        '010-9999-8888',
      ]

      for (const phone of testPhones) {
        const row = buildOwnerAttestedEvidenceRow({
          ...defaultInput,
          phone,
        })
        expect(row).not.toBeNull()
        const expected = calculateExpectedSha256(phone)
        expect(row?.subject_phone_sha256).toBe(expected)
      }
    })

    it('produces identical subject_phone_sha256 for equivalent representations of the same 010 number', () => {
      const row1 = buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '010-1234-5678' })
      const row2 = buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '01012345678' })
      const row3 = buildOwnerAttestedEvidenceRow({ ...defaultInput, phone: '+82 10 1234 5678' })

      expect(row1?.subject_phone_sha256).toBe(row2?.subject_phone_sha256)
      expect(row2?.subject_phone_sha256).toBe(row3?.subject_phone_sha256)
    })
  })

  describe('round-trip integration with createOutboxPolicyReaders', () => {
    it('allows evidenceReader to read this row as granted: true when stored in mock DB', async () => {
      const phone = '010-5555-6666'
      const recordedAt = new Date('2026-11-06T09:00:00.000Z')
      const row = buildOwnerAttestedEvidenceRow({
        workspaceId: 'ws-hotel-1',
        reservationId: 'res-room-99',
        phone,
        actorUserId: 'owner-user-7',
        attested: true,
        recordedAt,
      })
      expect(row).not.toBeNull()

      // Fake Supabase Client simulating the DB state with this evidence row
      const mockClient: Pick<SupabaseClient, 'from'> = {
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
              maybeSingle: async () => {
                // Verify filters match the row
                if (
                  filters.workspace_id === row!.workspace_id &&
                  filters.reservation_id === row!.reservation_id &&
                  filters.subject_phone_sha256 === row!.subject_phone_sha256 &&
                  filters.purpose === 'INFO' &&
                  filters.revoked_at === null
                ) {
                  return {
                    data: {
                      workspace_id: row!.workspace_id,
                      reservation_id: row!.reservation_id,
                      subject_phone_sha256: row!.subject_phone_sha256,
                      purpose: row!.purpose,
                      granted_at: row!.granted_at,
                      revoked_at: null,
                      evidence_ref: row!.evidence_ref,
                    },
                    error: null,
                  }
                }
                return { data: null, error: null }
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
                if (filters.workspace_id === row!.workspace_id && filters.id === row!.reservation_id) {
                  return {
                    data: {
                      id: row!.reservation_id,
                      workspace_id: row!.workspace_id,
                      customer_id: 'cust-xyz',
                    },
                    error: null,
                  }
                }
                return { data: null, error: null }
              },
            }
            return builder as unknown as ReturnType<SupabaseClient['from']>
          }

          if (table === 'customer_opt_outs') {
            const builder = {
              select: () => builder,
              eq: () => builder,
              maybeSingle: async () => ({ data: null, error: null }), // No opt-out
            }
            return builder as unknown as ReturnType<SupabaseClient['from']>
          }

          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const mockEnv: SolapiEnv = {
        SOLAPI_API_KEY: 'test-key',
        SOLAPI_API_SECRET: 'test-secret',
        SOLAPI_PF_ID: 'pf-test',
        SOLAPI_SENDER_PHONE: '0200000000',
        SOLAPI_TEMPLATE_IDS: '{}',
      }

      // Time of reading is 10 minutes after granted_at
      const readTime = new Date(recordedAt.getTime() + 10 * 60 * 1000)
      const { evidenceReader } = createOutboxPolicyReaders(mockClient, mockEnv, () => readTime)

      const result = await evidenceReader({
        workspaceId: 'ws-hotel-1',
        reservationId: 'res-room-99',
        phone,
      })

      expect(result).not.toBeNull()
      expect(result).toEqual({
        granted: true,
        subjectPhone: '01055556666',
        workspaceId: 'ws-hotel-1',
        reservationId: 'res-room-99',
      })
    })
  })
})
