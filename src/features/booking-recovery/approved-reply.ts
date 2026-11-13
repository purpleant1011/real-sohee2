/** Immutable, server-resolved knowledge provenance. Never populate from client input. */
export interface VerifiedReplyFactRef {
  readonly factId: string;
  readonly workspaceId: string;
  readonly version: string;
  readonly sourceRef: string;
  readonly verifiedAt: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

/**
 * Shared reply approval boundary for DM, review read models and booking consumers.
 * Missing source sequence / verified facts must require review, not a legacy send fallback.
 * FAQ replies may omit an offer; a booking consumer must require a non-null offer.
 */
export interface ApprovedReplyDto {
  readonly schemaVersion: 2;
  readonly proposalId: string;
  readonly revision: number;
  readonly workspaceId: string;
  readonly caseId: string;
  readonly recipientRef: string;
  readonly sourceMessageId: string;
  readonly sourceMessageSequence: number;
  readonly replyText: string;
  readonly facts: readonly VerifiedReplyFactRef[];
  readonly catalogVersion: string;
  readonly offer: {
    readonly serviceId: string;
    readonly serviceName: string;
    readonly totalAmountKrw: number;
    readonly depositKrw: number;
    readonly slotId: string;
    readonly slotVersion: number;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timezone: string;
  } | null;
  readonly validUntil: string;
  /** SHA-256 over the complete canonical tuple, excluding this field. */
  readonly fingerprint: string;
}

/** Must load current persisted proposal AND fresh source/facts/catalog/availability. */
export type LoadApprovedReply = (
  workspaceId: string,
  caseId: string
) => Promise<ApprovedReplyDto | null>;

/** Stored in the immutable SEND_DM_VERIFIED / RECONCILE_VERIFIED step evidence_ref. */
export interface VerifiedDmDeliveryEvidence {
  readonly schemaVersion: 1;
  readonly channel: 'instagram';
  readonly providerMessageId: string;
  readonly payloadFingerprint: string;
  readonly senderId: string;
  readonly recipientRef: string;
  readonly requestedAt: string;
  readonly observedAt: string;
}
