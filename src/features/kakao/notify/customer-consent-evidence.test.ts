import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeKrPhone } from './alimtalk-contract'
import {
  buildCustomerConsentEvidenceRow,
  type CustomerConsentEvidenceRow,
} from './customer-consent-evidence'

function calculateExpectedSha256(phone: string): string {
  return createHash('sha256').update(normalizeKrPhone(phone)).digest('hex')
}

describe('customer-consent-evidence', () => {
  const validTimestamp = new Date('2026-11-09T14:30:00.000Z')
  const defaultInput = {
    workspaceId: 'ws-111',
    reservationId: 'res-222',
    phone: '010-1234-5678',
    consent: true,
    recordedAt: validTimestamp,
  }

  describe('buildCustomerConsentEvidenceRow - success cases', () => {
    it('returns a properly structured CustomerConsentEvidenceRow for valid customer consent', () => {
      const row = buildCustomerConsentEvidenceRow(defaultInput)
      expect(row).not.toBeNull()
      const nonNullRow = row as CustomerConsentEvidenceRow

      expect(nonNullRow.workspace_id).toBe('ws-111')
      expect(nonNullRow.reservation_id).toBe('res-222')
      expect(nonNullRow.purpose).toBe('INFO')
      expect(nonNullRow.granted_at).toBe('2026-11-09T14:30:00.000Z')
      expect(nonNullRow.subject_phone_sha256).toMatch(/^[0-9a-f]{64}$/)

      const parsedRef = JSON.parse(nonNullRow.evidence_ref)
      expect(parsedRef).toEqual({
        kind: 'CUSTOMER_FORM_CONSENT',
        version: 'v1',
        workspace_id: 'ws-111',
        reservation_id: 'res-222',
        consent_text_version: 'v1',
        recorded_at: '2026-11-09T14:30:00.000Z',
      })
      expect(nonNullRow.evidence_ref.length).toBeLessThanOrEqual(500)
    })

    it('trims whitespace around workspaceId and reservationId', () => {
      const row = buildCustomerConsentEvidenceRow({
        ...defaultInput,
        workspaceId: '  ws-trimmed  ',
        reservationId: '  res-trimmed  ',
      })
      expect(row).not.toBeNull()
      expect(row?.workspace_id).toBe('ws-trimmed')
      expect(row?.reservation_id).toBe('res-trimmed')
      const parsedRef = JSON.parse(row!.evidence_ref)
      expect(parsedRef.workspace_id).toBe('ws-trimmed')
      expect(parsedRef.reservation_id).toBe('res-trimmed')
    })
  })

  describe('privacy and PII isolation', () => {
    it('does not contain raw phone digits or customer identifiers in any row field or JSON string', () => {
      const rawPhone = '010-9876-5432'
      const row = buildCustomerConsentEvidenceRow({
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
    it('returns null when consent is not true', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, consent: false })).toBeNull()
      // @ts-expect-error testing invalid runtime consent value
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, consent: undefined })).toBeNull()
      // @ts-expect-error testing invalid runtime consent value
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, consent: null })).toBeNull()
      // @ts-expect-error testing invalid runtime consent value
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, consent: 'true' })).toBeNull()
    })

    it('returns null when phone is missing, empty, or whitespace', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: null })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: undefined })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '   ' })).toBeNull()
    })

    it('returns null when phone normalization fails (non-010 or invalid format)', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '02-123-4567' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '070-1234-5678' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '011-123-4567' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: '+1234567890' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, phone: 'invalid-number' })).toBeNull()
    })

    it('returns null when workspaceId is blank or not a string', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, workspaceId: '' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, workspaceId: '   ' })).toBeNull()
      // @ts-expect-error testing invalid runtime workspaceId
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, workspaceId: null })).toBeNull()
    })

    it('returns null when reservationId is blank or not a string', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, reservationId: '' })).toBeNull()
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, reservationId: '   ' })).toBeNull()
      // @ts-expect-error testing invalid runtime reservationId
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, reservationId: null })).toBeNull()
    })

    it('returns null when recordedAt is invalid Date', () => {
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, recordedAt: new Date('invalid') })).toBeNull()
      // @ts-expect-error testing invalid runtime recordedAt
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, recordedAt: null })).toBeNull()
      // @ts-expect-error testing invalid runtime recordedAt
      expect(buildCustomerConsentEvidenceRow({ ...defaultInput, recordedAt: undefined })).toBeNull()
    })

    it('returns null when evidence_ref length exceeds 500 characters', () => {
      const veryLongId = 'a'.repeat(400)
      expect(
        buildCustomerConsentEvidenceRow({
          ...defaultInput,
          workspaceId: veryLongId,
        }),
      ).toBeNull()
    })

    it('returns null when input is not an object', () => {
      // @ts-expect-error testing null input
      expect(buildCustomerConsentEvidenceRow(null)).toBeNull()
      // @ts-expect-error testing undefined input
      expect(buildCustomerConsentEvidenceRow(undefined)).toBeNull()
    })
  })

  describe('SHA256 parity with outbox-policy-readers.ts and normalizeKrPhone', () => {
    it('generates the exact same hash as calculateExpectedSha256 logic', () => {
      const testPhones = [
        '010-1234-5678',
        '01012345678',
        '+82 10 1234 5678',
        '+821012345678',
        '010-9999-8888',
      ]

      for (const phone of testPhones) {
        const row = buildCustomerConsentEvidenceRow({
          ...defaultInput,
          phone,
        })
        expect(row).not.toBeNull()
        const expected = calculateExpectedSha256(phone)
        expect(row?.subject_phone_sha256).toBe(expected)
      }
    })
  })
})
