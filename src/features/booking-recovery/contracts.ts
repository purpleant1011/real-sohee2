import { z } from 'zod';

/**
 * 1. Recovery Stages (Formal State Set)
 */
export const RECOVERY_STAGES = [
  'DISCOVERED',
  'NEEDS_CONTEXT',
  'DRAFT_READY',
  'AWAITING_SEND_APPROVAL',
  'SEND_REQUESTED',
  'PROVIDER_ACCEPTED',
  'SEND_VERIFIED',
  'AWAITING_CUSTOMER',
  'CUSTOMER_ACCEPTED',
  'AWAITING_BOOKING_APPROVAL',
  'BOOKING_CONFIRMED',
  'RESULT_UNKNOWN',
  'NEEDS_RECONCILIATION',
  'HUMAN_REVIEW',
  'BLOCKED',
  'DECLINED',
  'EXPIRED',
] as const;

export type RecoveryStage = (typeof RECOVERY_STAGES)[number];
export const recoveryStageSchema = z.enum(RECOVERY_STAGES);

export function recoveryStatusLabel(stage: RecoveryStage): string {
  switch (stage) {
    case 'DISCOVERED':
      return '신규 문의 접수';
    case 'NEEDS_CONTEXT':
      return '예약 가능 시간 확인 필요';
    case 'DRAFT_READY':
      return '답변 초안 준비 완료';
    case 'AWAITING_SEND_APPROVAL':
      return '답변 전송 승인 대기';
    case 'SEND_REQUESTED':
      return '전송 요청됨';
    case 'PROVIDER_ACCEPTED':
      return '채널 접수 · 결과 확인 중';
    case 'SEND_VERIFIED':
      return '전송 완료';
    case 'AWAITING_CUSTOMER':
      return '고객 응답 대기';
    case 'CUSTOMER_ACCEPTED':
      return '고객 예약 수락';
    case 'AWAITING_BOOKING_APPROVAL':
      return '예약 확정 승인 대기';
    case 'BOOKING_CONFIRMED':
      return '예약 확정 완료';
    case 'RESULT_UNKNOWN':
      return '전송 결과 확인 필요';
    case 'NEEDS_RECONCILIATION':
      return '상태 대사 중';
    case 'HUMAN_REVIEW':
      return '직접 확인 필요';
    case 'BLOCKED':
      return '처리 중단';
    case 'DECLINED':
      return '예약 거절';
    case 'EXPIRED':
      return '기한 만료';
    default:
      return '확인 중';
  }
}

/**
 * 2. Recovery Case & Booking Identifiers
 */
export const recoveryCaseIdSchema = z.string().uuid({
  message: 'caseId must be a valid DB UUID.',
});

export const bookingIdSchema = z.string().regex(/^bk_[a-zA-Z0-9_-]+$/, {
  message: 'bookingId must start with bk_ prefix.',
});

export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, {
  message: 'fingerprint must be a 64-character lowercase sha256 hex string.',
});

/**
 * 3. Recovery Actor (Server Context Only)
 * 절대 클라이언트 요청 body에서 받지 않고 인증된 세션에서만 생성한다.
 */
export interface RecoveryActor {
  workspaceId: string;
  userId: string;
  role: 'owner' | 'manager';
}

export const recoveryActorSchema = z
  .object({
    workspaceId: z.string().uuid({ message: 'workspaceId must be a valid UUID.' }),
    userId: z.string().uuid({ message: 'userId must be a valid UUID.' }),
    role: z.enum(['owner', 'manager']),
  })
  .strict();

/**
 * 4. Recovery Commands (Client Payload Strict Validation)
 * actorId, userId, role, workspaceId 등 권한 주입 필드는 strict하게 거부된다.
 */
export const prepareReplyCommandSchema = z
  .object({
    kind: z.literal('prepare_reply'),
    expectedVersion: z.number().int().positive(),
    slotId: z.string().uuid({ message: 'slotId must be a valid DB UUID.' }).optional(),
  })
  .strict();

export const approveSendCommandSchema = z
  .object({
    kind: z.literal('approve_send'),
    expectedVersion: z.number().int().positive(),
    fingerprint: sha256HexSchema,
  })
  .strict();

export const confirmAcceptanceCommandSchema = z
  .object({
    kind: z.literal('confirm_acceptance'),
    expectedVersion: z.number().int().positive(),
    inboundMessageId: z.string().uuid({ message: 'inboundMessageId must be a valid DB UUID.' }),
    slotId: z.string().uuid({ message: 'slotId must be a valid DB UUID.' }),
  })
  .strict();

export const approveBookingCommandSchema = z
  .object({
    kind: z.literal('approve_booking'),
    expectedVersion: z.number().int().positive(),
    fingerprint: sha256HexSchema,
  })
  .strict();

export const reattestScheduleCommandSchema = z
  .object({
    kind: z.literal('reattest_schedule'),
    expectedVersion: z.number().int().positive(),
    slotId: z.string().uuid({ message: 'slotId must be a valid DB UUID.' }).optional(),
  })
  .strict();

export const rejectCommandSchema = z
  .object({
    kind: z.literal('reject'),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const recoveryCommandSchema = z.discriminatedUnion('kind', [
  prepareReplyCommandSchema,
  approveSendCommandSchema,
  confirmAcceptanceCommandSchema,
  approveBookingCommandSchema,
  reattestScheduleCommandSchema,
  rejectCommandSchema,
]);

export type RecoveryCommand = z.infer<typeof recoveryCommandSchema>;

/**
 * 5. Recovery Proposal Snapshot Schema
 */
export const recoveryProposalSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    case_id: recoveryCaseIdSchema,
    revision: z.number().int().positive(),
    source_inbound_message_id: z.string().uuid(),
    source_thread_id: z.string().uuid(),
    service_id: z.string().uuid(),
    catalog_version: z.string().min(1),
    service_name: z.string().min(1),
    total_amount_krw: z.number().int().nonnegative(),
    deposit_krw: z.number().int().nonnegative(),
    slot_id: z.string().uuid(),
    slot_version: z.number().int().positive(),
    starts_at: z.string(),
    ends_at: z.string(),
    timezone: z.string().default('Asia/Seoul'),
    availability_confirmed_at: z.string(),
    valid_until: z.string(),
    dm_draft_id: z.string().uuid().nullable().optional(),
    reply_text: z.string(),
    payload_fingerprint: sha256HexSchema,
    approved_reply_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string(),
  })
  .strict();

export type RecoveryProposal = z.infer<typeof recoveryProposalSchema>;

/**
 * 6. Recovery Result
 */
export type RecoveryErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VERSION_CONFLICT'
  | 'CONTEXT_REQUIRED'
  | 'POLICY_BLOCKED'
  | 'RESULT_UNKNOWN'
  | 'SLOT_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'HUMAN_REVIEW';

export type RecoveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RecoveryErrorCode; message: string };

/**
 * 7. Recovery Read Model (RecoveryView)
 * revenue는 NOT_OBSERVED 및 amountKrw: null을 강제한다.
 */
export interface RecoveryView {
  caseId: string;
  missionId: string;
  version: number;
  stage: RecoveryStage;
  statusLabel: string;
  sourceThreadId: string;
  sourceInboundMessageId: string;
  observedAt: string;
  reply: { text: string; fingerprint: string } | null;
  offer: {
    slotId: string;
    serviceId: string;
    serviceName: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    totalAmountKrw: number;
    depositKrw: number;
    validUntil: string;
    proposalRevision: number;
  } | null;
  acceptance: {
    inboundMessageId: string;
    receivedAt: string;
  } | null;
  approval: {
    kind: 'send' | 'booking';
    fingerprint: string;
  } | null;
  proposal?: {
    revision: number;
    serviceId: string;
    serviceName: string;
    totalAmountKrw: number;
    depositKrw: number;
    slotId: string;
    startsAt: string;
    endsAt: string;
  } | null;
  booking: {
    id: string;
    confirmedAt: string;
    status?: 'CONFIRMED' | 'CANCELLED';
  } | null;
  nextAction:
    | 'prepare_reply'
    | 'approve_send'
    | 'confirm_acceptance'
    | 'reattest_schedule'
    | 'approve_booking'
    | 'review'
    | null;
  revenue: { status: 'NOT_OBSERVED'; amountKrw: null };
}

export const recoveryViewSchema = z
  .object({
    caseId: recoveryCaseIdSchema,
    missionId: z.string().uuid({ message: 'missionId must be a valid DB UUID.' }),
    version: z.number().int().positive(),
    stage: recoveryStageSchema,
    statusLabel: z.string().min(1),
    sourceThreadId: z.string().uuid({ message: 'sourceThreadId must be a valid DB UUID.' }),
    sourceInboundMessageId: z.string().uuid({ message: 'sourceInboundMessageId must be a valid DB UUID.' }),
    observedAt: z.string().datetime(),
    reply: z
      .object({
        text: z.string(),
        fingerprint: sha256HexSchema,
      })
      .nullable(),
    offer: z
      .object({
        slotId: z.string().uuid(),
        serviceId: z.string().uuid(),
        serviceName: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
        timezone: z.string(),
        totalAmountKrw: z.number().int().nonnegative(),
        depositKrw: z.number().int().nonnegative(),
        validUntil: z.string(),
        proposalRevision: z.number().int().positive(),
      })
      .nullable()
      .default(null),
    acceptance: z
      .object({
        inboundMessageId: z.string().uuid(),
        receivedAt: z.string(),
      })
      .nullable()
      .default(null),
    approval: z
      .object({
        kind: z.enum(['send', 'booking']),
        fingerprint: sha256HexSchema,
      })
      .nullable()
      .default(null),
    proposal: z
      .object({
        revision: z.number().int().positive(),
        serviceId: z.string().uuid(),
        serviceName: z.string(),
        totalAmountKrw: z.number().int().nonnegative(),
        depositKrw: z.number().int().nonnegative(),
        slotId: z.string().uuid(),
        startsAt: z.string(),
        endsAt: z.string(),
      })
      .nullable()
      .optional(),
    booking: z
      .object({
        id: bookingIdSchema,
        confirmedAt: z.string().datetime(),
        status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
      })
      .nullable(),
    nextAction: z
      .enum([
        'prepare_reply',
        'approve_send',
        'confirm_acceptance',
        'reattest_schedule',
        'approve_booking',
        'review',
      ])
      .nullable(),
    revenue: z
      .object({
        status: z.literal('NOT_OBSERVED'),
        amountKrw: z.null(),
      })
      .strict(),
  })
  .strict();
