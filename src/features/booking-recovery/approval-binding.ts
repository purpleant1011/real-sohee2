import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApprovedReplyDto } from './approved-reply';

/** v2 is deliberately domain-separated from legacy approval tuples. */
export function approvedReplyFingerprint(input: ApprovedReplyDto): string {
  const facts = input.facts.map((fact) => [
    fact.factId, fact.workspaceId, fact.version, fact.sourceRef,
    fact.verifiedAt, fact.validFrom, fact.validUntil,
  ]).sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const offer = input.offer;
  const tuple = [
    'sohee:approved-reply:v2', input.schemaVersion, input.proposalId, input.revision,
    input.workspaceId, input.caseId, input.recipientRef,
    input.sourceMessageId, input.sourceMessageSequence, input.replyText,
    facts, input.catalogVersion,
    offer ? [offer.serviceId, offer.serviceName, offer.totalAmountKrw, offer.depositKrw,
      offer.slotId, offer.slotVersion, offer.startsAt, offer.endsAt, offer.timezone] : null,
    input.validUntil,
  ];
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}

export function validateApprovedReply(
  input: ApprovedReplyDto,
  expectedFingerprint: string,
  now: Date = new Date()
): boolean {
  try {
    const at = now.getTime();
    if (!Number.isFinite(at) || input.schemaVersion !== 2 ||
      ![input.proposalId, input.workspaceId, input.caseId, input.recipientRef,
        input.sourceMessageId, input.replyText, input.catalogVersion].every((s) => typeof s === 'string' && s.trim()) ||
      Buffer.byteLength(input.replyText, 'utf8') > 1000 ||
      !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      !Number.isSafeInteger(input.sourceMessageSequence) || input.sourceMessageSequence < 1 ||
      !(Date.parse(input.validUntil) > at) || !input.facts.length ||
      !SHA256_HEX_REGEX.test(expectedFingerprint) || input.fingerprint !== expectedFingerprint) return false;
    if (!input.facts.every((fact) => fact.workspaceId === input.workspaceId &&
      [fact.factId, fact.version, fact.sourceRef].every((s) => typeof s === 'string' && s.trim()) &&
      Date.parse(fact.verifiedAt) <= at && Date.parse(fact.validFrom) <= at &&
      (fact.validUntil === null || Date.parse(fact.validUntil) > at))) return false;
    if (input.offer) {
      const offer = input.offer;
      if (![offer.serviceId, offer.serviceName, offer.slotId, offer.timezone].every((s) => typeof s === 'string' && s.trim()) ||
        !Number.isSafeInteger(offer.totalAmountKrw) || offer.totalAmountKrw < 0 ||
        !Number.isSafeInteger(offer.depositKrw) || offer.depositKrw < 0 || offer.depositKrw > offer.totalAmountKrw ||
        !Number.isSafeInteger(offer.slotVersion) || offer.slotVersion < 1 ||
        !(Date.parse(offer.startsAt) > at) || !(Date.parse(offer.endsAt) > Date.parse(offer.startsAt))) return false;
    }
    return timingSafeEqual(Buffer.from(approvedReplyFingerprint(input)), Buffer.from(expectedFingerprint));
  } catch {
    return false;
  }
}

export interface ApprovalBindingInput {
  workspaceId: string;
  caseId: string;
  recipientRef: string;
  sourceInboundMessageId: string;
  replyText: string;
  catalogVersion: string;
  slotVersion: number;
}

/**
 * Generates deterministic SHA-256 fingerprint for DM send approval.
 * Bound to workspace, case, recipient, source message, exact reply text, catalog version, and slot version.
 * Timestamp and random seeds are strictly excluded.
 */
export function approvalFingerprint(input: ApprovalBindingInput): string {
  const canonicalTuple = [
    input.workspaceId,
    input.caseId,
    input.recipientRef,
    input.sourceInboundMessageId,
    input.replyText,
    input.catalogVersion,
    input.slotVersion,
  ];

  return createHash('sha256').update(JSON.stringify(canonicalTuple)).digest('hex');
}

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

/**
 * Constant-time fingerprint verification against timing attacks.
 * Verifies strict 64-char lowercase hex format to avoid multi-byte buffer length mismatch throws.
 */
export function verifyApprovalFingerprint(
  input: ApprovalBindingInput,
  expectedFingerprint: string
): boolean {
  if (
    !expectedFingerprint ||
    typeof expectedFingerprint !== 'string' ||
    !SHA256_HEX_REGEX.test(expectedFingerprint)
  ) {
    return false;
  }
  const actualFingerprint = approvalFingerprint(input);
  return timingSafeEqual(
    Buffer.from(actualFingerprint, 'utf8'),
    Buffer.from(expectedFingerprint, 'utf8')
  );
}

export interface BookingApprovalBindingInput {
  workspaceId: string;
  caseId: string;
  slotId: string;
  serviceId: string;
  totalAmountKrw: number;
  depositKrw: number;
  customerRef: string;
  acceptedMessageId: string;
  proposalRevision: number;
  catalogVersion: string;
  slotVersion: number;
}

/**
 * Generates deterministic SHA-256 fingerprint for Booking confirmation approval.
 * Bound to exact workspace, case, slot, service, amounts, customer, accepted message, proposal revision, and versions.
 */
export function bookingApprovalFingerprint(input: BookingApprovalBindingInput): string {
  const canonicalTuple = [
    input.workspaceId,
    input.caseId,
    input.slotId,
    input.serviceId,
    input.totalAmountKrw,
    input.depositKrw,
    input.customerRef,
    input.acceptedMessageId,
    input.proposalRevision,
    input.catalogVersion,
    input.slotVersion,
  ];

  return createHash('sha256').update(JSON.stringify(canonicalTuple)).digest('hex');
}

/**
 * Constant-time booking fingerprint verification.
 * Verifies strict 64-char lowercase hex format to avoid multi-byte buffer length mismatch throws.
 */
export function verifyBookingApprovalFingerprint(
  input: BookingApprovalBindingInput,
  expectedFingerprint: string
): boolean {
  if (
    !expectedFingerprint ||
    typeof expectedFingerprint !== 'string' ||
    !SHA256_HEX_REGEX.test(expectedFingerprint)
  ) {
    return false;
  }
  const actualFingerprint = bookingApprovalFingerprint(input);
  return timingSafeEqual(
    Buffer.from(actualFingerprint, 'utf8'),
    Buffer.from(expectedFingerprint, 'utf8')
  );
}
