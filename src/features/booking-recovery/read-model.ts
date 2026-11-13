import {
  RecoveryStage,
  RecoveryView,
  recoveryViewSchema,
  RecoveryProposal,
  recoveryStatusLabel,
} from './contracts';
import { RecoveryCase } from './repository';
import { bookingApprovalFingerprint } from './approval-binding';

export { recoveryStatusLabel };

export function determineNextAction(
  stage: RecoveryStage,
  proposal?: RecoveryProposal | null,
  booking?: { id: string; confirmedAt: string; status?: 'CONFIRMED' | 'CANCELLED' } | null
): RecoveryView['nextAction'] {
  if (booking?.status === 'CANCELLED') {
    return null;
  }
  switch (stage) {
    case 'DISCOVERED':
    case 'NEEDS_CONTEXT':
      return 'prepare_reply';
    case 'DRAFT_READY':
    case 'AWAITING_SEND_APPROVAL':
      return 'approve_send';
    case 'AWAITING_CUSTOMER':
      return 'confirm_acceptance';
    case 'CUSTOMER_ACCEPTED':
    case 'AWAITING_BOOKING_APPROVAL':
      if (proposal && Date.parse(proposal.valid_until) <= Date.now()) {
        return 'reattest_schedule';
      }
      return 'approve_booking';
    case 'EXPIRED':
      return 'reattest_schedule';
    case 'RESULT_UNKNOWN':
    case 'NEEDS_RECONCILIATION':
    case 'HUMAN_REVIEW':
      return 'review';
    default:
      return null;
  }
}

export function createRecoveryView(params: {
  caseItem: RecoveryCase;
  proposal?: RecoveryProposal | null;
  booking?: { id: string; confirmedAt: string; status?: 'CONFIRMED' | 'CANCELLED' } | null;
  acceptanceSentAt?: string | null;
}): RecoveryView {
  const { caseItem, proposal, booking, acceptanceSentAt } = params;
  const nextAction = determineNextAction(caseItem.stage, proposal, booking);

  const offer = proposal
    ? {
        slotId: proposal.slot_id,
        serviceId: proposal.service_id,
        serviceName: proposal.service_name,
        startsAt: proposal.starts_at,
        endsAt: proposal.ends_at,
        timezone: proposal.timezone,
        totalAmountKrw: proposal.total_amount_krw,
        depositKrw: proposal.deposit_krw,
        validUntil: proposal.valid_until,
        proposalRevision: proposal.revision,
      }
    : null;

  const acceptance = caseItem.accepted_inbound_message_id
    ? {
        inboundMessageId: caseItem.accepted_inbound_message_id,
        receivedAt: acceptanceSentAt || caseItem.updated_at,
      }
    : null;

  let approval: RecoveryView['approval'] = null;
  if (nextAction === 'approve_send' && proposal) {
    approval = {
      kind: 'send',
      fingerprint: proposal.payload_fingerprint,
    };
  } else if (nextAction === 'approve_booking' && proposal && caseItem.accepted_inbound_message_id) {
    approval = {
      kind: 'booking',
      fingerprint: bookingApprovalFingerprint({
        workspaceId: caseItem.workspace_id,
        caseId: caseItem.id,
        slotId: proposal.slot_id,
        serviceId: proposal.service_id,
        totalAmountKrw: proposal.total_amount_krw,
        depositKrw: proposal.deposit_krw,
        customerRef: caseItem.customer_ref,
        acceptedMessageId: caseItem.accepted_inbound_message_id,
        proposalRevision: proposal.revision,
        catalogVersion: proposal.catalog_version,
        slotVersion: proposal.slot_version,
      }),
    };
  }

  const view: RecoveryView = {
    caseId: caseItem.id,
    missionId: caseItem.mission_id,
    version: caseItem.version,
    stage: caseItem.stage,
    statusLabel: recoveryStatusLabel(caseItem.stage),
    sourceThreadId: caseItem.source_thread_id,
    sourceInboundMessageId: caseItem.source_inbound_message_id,
    observedAt: caseItem.updated_at,
    reply: proposal
      ? {
          text: proposal.reply_text,
          fingerprint: proposal.payload_fingerprint,
        }
      : null,
    offer,
    acceptance,
    approval,
    proposal: proposal
      ? {
          revision: proposal.revision,
          serviceId: proposal.service_id,
          serviceName: proposal.service_name,
          totalAmountKrw: proposal.total_amount_krw,
          depositKrw: proposal.deposit_krw,
          slotId: proposal.slot_id,
          startsAt: proposal.starts_at,
          endsAt: proposal.ends_at,
        }
      : null,
    booking: booking ?? null,
    nextAction,
    revenue: {
      status: 'NOT_OBSERVED',
      amountKrw: null,
    },
  };

  return recoveryViewSchema.parse(view);
}
