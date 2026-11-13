import { describe, expect, it } from 'vitest'
import {
  approvalFingerprint, verifyApprovalFingerprint, bookingApprovalFingerprint,
  verifyBookingApprovalFingerprint, type ApprovalBindingInput, type BookingApprovalBindingInput,
} from '../../src/features/booking-recovery/approval-binding'

// These are deterministic contract probes of imported production code, NOT
// provider delivery/DB race/live-customer evidence for the complete Golden Task.
describe('G093-06 exact approval imported contract', () => {
  const original: ApprovalBindingInput = {
    workspaceId: 'fixture-A', caseId: 'fixture-case', recipientRef: 'fixture-customer',
    sourceInboundMessageId: 'fixture-message-v1', replyText: 'fixture reply', catalogVersion: 'v1', slotVersion: 1,
  }
  it('accepts the unchanged canonical tuple', () => {
    expect(verifyApprovalFingerprint(original, approvalFingerprint(original))).toBe(true)
  })
  const changes: Partial<ApprovalBindingInput>[] = [
    { workspaceId: 'fixture-B' }, { caseId: 'other-case' }, { recipientRef: 'other-customer' },
    { sourceInboundMessageId: 'fixture-message-v2' }, { replyText: 'changed reply' },
    { catalogVersion: 'v2' }, { slotVersion: 2 },
  ]
  for (const change of changes) {
    it(`rejects stale approval after ${Object.keys(change)[0]} change`, () => {
      expect(verifyApprovalFingerprint({ ...original, ...change }, approvalFingerprint(original))).toBe(false)
    })
  }
})

describe('G093-07 booking approval imported contract', () => {
  const original: BookingApprovalBindingInput = {
    workspaceId: 'fixture-A', caseId: 'fixture-case', slotId: 'fixture-slot', serviceId: 'fixture-service',
    totalAmountKrw: 40000, depositKrw: 10000, customerRef: 'fixture-customer', acceptedMessageId: 'fixture-acceptance',
    proposalRevision: 1, catalogVersion: 'v1', slotVersion: 1,
  }
  const changes: Partial<BookingApprovalBindingInput>[] = [
    { workspaceId: 'fixture-B' }, { caseId: 'other-case' }, { slotId: 'other-slot' }, { serviceId: 'other-service' },
    { totalAmountKrw: 50000 }, { depositKrw: 20000 }, { customerRef: 'other-customer' },
    { acceptedMessageId: 'other-acceptance' }, { proposalRevision: 2 }, { catalogVersion: 'v2' }, { slotVersion: 2 },
  ]
  for (const change of changes) {
    it(`rejects a changed ${Object.keys(change)[0]} rather than reusing booking approval`, () => {
      expect(verifyBookingApprovalFingerprint({ ...original, ...change }, bookingApprovalFingerprint(original))).toBe(false)
    })
  }
})
