import { vi } from 'vitest';
import { approvedReplyFingerprint } from '@/features/booking-recovery/approval-binding';
import type { ApprovedReplyDto, VerifiedReplyFactRef } from '@/features/booking-recovery/approved-reply';
import type { RecoveryActor, RecoveryProposal } from '@/features/booking-recovery/contracts';
import type { BookingRecoveryRepository, RecoveryCase, RecoveryStep } from '@/features/booking-recovery/repository';

export const FIXED_DRILL_NOW = '2026-10-22T10:00:00.000Z';
export const FIXED_DRILL_NOW_MS = Date.parse(FIXED_DRILL_NOW);

export const defaultActor: RecoveryActor = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'owner',
};

export function createBaseCase(overrides?: Partial<RecoveryCase>): RecoveryCase {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: defaultActor.workspaceId,
    mission_id: '44444444-4444-4444-8444-444444444444',
    source_thread_id: '55555555-5555-4555-8555-555555555555',
    source_inbound_message_id: '66666666-6666-4666-8666-666666666666',
    customer_ref: 'cust_drill_123',
    stage: 'AWAITING_SEND_APPROVAL',
    version: 3,
    created_at: '2026-10-22T09:00:00.000Z',
    updated_at: '2026-10-22T09:00:00.000Z',
    ...overrides,
  };
}

export function createBaseFacts(workspaceId = defaultActor.workspaceId): VerifiedReplyFactRef[] {
  return [
    {
      factId: 'fact_drill_01',
      workspaceId,
      version: '1',
      sourceRef: 'knowledge_doc_123',
      verifiedAt: '2026-10-22T09:30:00.000Z',
      validFrom: '2026-10-22T09:30:00.000Z',
      validUntil: '2026-10-22T18:00:00.000Z',
    },
  ];
}

export interface BuildApprovedReplyOptions {
  caseId?: string;
  workspaceId?: string;
  proposalId?: string;
  revision?: number;
  recipientRef?: string;
  sourceMessageId?: string;
  sourceMessageSequence?: number;
  replyText?: string;
  catalogVersion?: string;
  facts?: readonly VerifiedReplyFactRef[];
  offer?: ApprovedReplyDto['offer'];
  validUntil?: string;
  customFingerprint?: string;
}

export function buildApprovedReply(options?: BuildApprovedReplyOptions): ApprovedReplyDto {
  const workspaceId = options?.workspaceId ?? defaultActor.workspaceId;
  const caseId = options?.caseId ?? '33333333-3333-4333-8333-333333333333';
  const proposalId = options?.proposalId ?? '77777777-7777-4777-8777-777777777777';
  const revision = options?.revision ?? 1;
  const recipientRef = options?.recipientRef ?? 'cust_drill_123';
  const sourceMessageId = options?.sourceMessageId ?? '66666666-6666-4666-8666-666666666666';
  const sourceMessageSequence = options?.sourceMessageSequence ?? 1;
  const replyText = options?.replyText ?? '테스트 복구 제안 답변입니다.';
  const catalogVersion = options?.catalogVersion ?? 'cat_v1';
  const facts = options?.facts ?? createBaseFacts(workspaceId);
  const offer = options?.offer !== undefined ? options.offer : {
    serviceId: '88888888-8888-4888-8888-888888888888',
    serviceName: '시그니처 디자인 펌',
    totalAmountKrw: 120000,
    depositKrw: 30000,
    slotId: '99999999-9999-4999-8999-999999999999',
    slotVersion: 1,
    startsAt: '2026-10-22T14:00:00.000Z',
    endsAt: '2026-10-22T16:00:00.000Z',
    timezone: 'Asia/Seoul',
  };
  const validUntil = options?.validUntil ?? '2026-10-22T11:00:00.000Z';

  const partialDto: Omit<ApprovedReplyDto, 'fingerprint'> = {
    schemaVersion: 2,
    proposalId,
    revision,
    workspaceId,
    caseId,
    recipientRef,
    sourceMessageId,
    sourceMessageSequence,
    replyText,
    facts,
    catalogVersion,
    offer,
    validUntil,
  };

  const calculatedFp = approvedReplyFingerprint(partialDto as ApprovedReplyDto);
  const fingerprint = options?.customFingerprint ?? calculatedFp;

  return {
    ...partialDto,
    fingerprint,
  };
}

export function buildProposalFromApprovedReply(
  approved: ApprovedReplyDto,
  caseItem: RecoveryCase,
  overrides?: Partial<RecoveryProposal>
): RecoveryProposal {
  return {
    id: approved.proposalId,
    workspace_id: approved.workspaceId,
    case_id: approved.caseId,
    revision: approved.revision,
    source_inbound_message_id: approved.sourceMessageId,
    source_thread_id: caseItem.source_thread_id,
    service_id: approved.offer?.serviceId ?? '88888888-8888-4888-8888-888888888888',
    catalog_version: approved.catalogVersion,
    service_name: approved.offer?.serviceName ?? '시그니처 디자인 펌',
    total_amount_krw: approved.offer?.totalAmountKrw ?? 120000,
    deposit_krw: approved.offer?.depositKrw ?? 30000,
    slot_id: approved.offer?.slotId ?? '99999999-9999-4999-8999-999999999999',
    slot_version: approved.offer?.slotVersion ?? 1,
    starts_at: approved.offer?.startsAt ?? '2026-10-22T14:00:00.000Z',
    ends_at: approved.offer?.endsAt ?? '2026-10-22T16:00:00.000Z',
    timezone: approved.offer?.timezone ?? 'Asia/Seoul',
    availability_confirmed_at: '2026-10-22T09:30:00.000Z',
    valid_until: approved.validUntil,
    reply_text: approved.replyText,
    payload_fingerprint: approved.fingerprint,
    created_at: '2026-10-22T09:30:00.000Z',
    ...overrides,
  };
}

export interface StatefulRepoControl {
  repository: BookingRecoveryRepository;
  getCurrentCase: () => RecoveryCase;
  setCurrentCase: (c: RecoveryCase) => void;
  getTransitions: () => Array<{ actor: RecoveryActor; params: any }>;
  setClaimStepResult: (res: any) => void;
  claimCalls: any[];
  finishStepCalls: any[];
}

export function createStatefulMockRepository(initialCase: RecoveryCase, initialProposal?: RecoveryProposal): StatefulRepoControl {
  let currentCase = { ...initialCase };
  const currentProposal = initialProposal ? { ...initialProposal } : undefined;
  const transitions: Array<{ actor: RecoveryActor; params: any }> = [];
  const claimCalls: any[] = [];
  const finishStepCalls: any[] = [];
  let claimStepOverride: any = null;

  const repo = {
    getCase: vi.fn(async (wsId: string, cId: string) => {
      if (currentCase.workspace_id === wsId && currentCase.id === cId) {
        return { ...currentCase };
      }
      return null;
    }),
    getLatestProposal: vi.fn(async (wsId: string, cId: string) => {
      if (currentProposal && currentProposal.workspace_id === wsId && currentProposal.case_id === cId) {
        return { ...currentProposal };
      }
      return null;
    }),
    claimStep: vi.fn(async (actor: RecoveryActor, params: any) => {
      claimCalls.push({ actor, params });
      if (claimStepOverride !== null) {
        return typeof claimStepOverride === 'function' ? claimStepOverride(actor, params) : claimStepOverride;
      }
      const step: RecoveryStep = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspace_id: actor.workspaceId,
        case_id: params.caseId,
        kind: params.kind,
        status: 'CLAIMED',
        idempotency_key: params.idempotencyKey,
        input_fingerprint: params.inputFingerprint,
        claim_token: '11111111-1111-4111-8111-111111111111',
        attempt: 1,
      };
      return {
        claimed: true,
        claim_token: step.claim_token,
        attempt: 1,
        step,
      };
    }),
    transitionCase: vi.fn(async (actor: RecoveryActor, params: any) => {
      transitions.push({ actor, params });
      if (params.expectedVersion !== currentCase.version) {
        const err: any = new Error(`VERSION_CONFLICT: expected ${params.expectedVersion} but was ${currentCase.version}`);
        err.code = 'VERSION_CONFLICT';
        throw err;
      }
      currentCase = {
        ...currentCase,
        version: currentCase.version + 1,
        stage: params.nextStage,
        updated_at: new Date().toISOString(),
      };
      return { ...currentCase };
    }),
    finishStep: vi.fn(async (actor: RecoveryActor, params: any): Promise<Record<string, unknown>> => {
      finishStepCalls.push({ actor, params });
      return {};
    }),
    confirmBooking: vi.fn(),
  };

  return {
    repository: repo as unknown as BookingRecoveryRepository,
    getCurrentCase: () => ({ ...currentCase }),
    setCurrentCase: (c: RecoveryCase) => { currentCase = { ...c }; },
    getTransitions: () => [...transitions],
    setClaimStepResult: (res: any) => { claimStepOverride = res; },
    claimCalls,
    finishStepCalls,
  };
}

export interface MockSupabaseControl {
  client: any;
  setThreadExpiresAt: (iso: string) => void;
  setThreadMessages: (msgs: any[]) => void;
  upsertedOutbox: any[];
  updatedOutbox: any[];
}

export function createMockSupabase(params: {
  workspaceId: string;
  sourceThreadId: string;
  sourceInboundMessageId: string;
  initialThreadExpiresAt?: string;
}): MockSupabaseControl {
  let threadExpiresAt = params.initialThreadExpiresAt ?? new Date(FIXED_DRILL_NOW_MS + 12 * 3600 * 1000).toISOString();
  let threadMessages: any[] = [
    {
      id: params.sourceInboundMessageId,
      sender_type: 'customer',
      sent_at: '2026-10-22T09:00:00.000Z',
    },
  ];

  const upsertedOutbox: any[] = [];
  const updatedOutbox: any[] = [];

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'instagram_dm_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockImplementation(async () => ({
            data: [...threadMessages],
            error: null,
          })),
        };
      }
      if (table === 'booking_recovery_approvals') {
        // W4 durable-approval gate: dm-adapter re-reads the SEND approval row and
        // requires step_kind/payload_fingerprint/authorized_case_version to match,
        // expires_at to be in the future and consumed_at to be null. Echo the
        // fingerprint the caller filtered on, as a real row lookup would.
        const filters: Record<string, string> = {};
        const row = () => ({
          id: 'appr-drill-0001',
          workspace_id: filters.workspace_id ?? params.workspaceId,
          case_id: filters.case_id ?? '',
          step_kind: 'SEND',
          payload_fingerprint: filters.payload_fingerprint ?? '',
          // dm-adapter only compares this when it is non-null; the drill fixture
          // leaves it null so the row does not pin a case version.
          authorized_case_version: null,
          case_version: 1,
          source_message_id: params.sourceInboundMessageId,
          catalog_version: 'cat_v1',
          slot_version: 1,
          approved_by: 'usr_drill_owner',
          approved_at: new Date(FIXED_DRILL_NOW_MS - 60 * 1000).toISOString(),
          expires_at: new Date(FIXED_DRILL_NOW_MS + 60 * 60 * 1000).toISOString(),
          consumed_at: null,
          consumed_by_step_id: null,
        });
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn((key: string, value: string) => { filters[key] = value; return builder }),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: row(), error: null })),
        };
        return builder;
      }
      if (table === 'instagram_dm_threads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockImplementation(async () => ({
            data: {
              id: params.sourceThreadId,
              workspace_id: params.workspaceId,
              channel_connection_id: 'conn_123',
              expires_at: threadExpiresAt,
              status: 'NEEDS_REPLY',
            },
            error: null,
          })),
          maybeSingle: vi.fn().mockImplementation(async () => ({
            data: {
              id: params.sourceThreadId,
              workspace_id: params.workspaceId,
              channel_connection_id: 'conn_123',
            },
            error: null,
          })),
        };
      }
      if (table === 'booking_recovery_outbox') {
        return {
          upsert: vi.fn(async (payload: any) => {
            upsertedOutbox.push(payload);
            return { data: null, error: null };
          }),
          update: vi.fn((updatePayload: any) => {
            return {
              eq: vi.fn(() => {
                return {
                  eq: vi.fn(() => {
                    return {
                      eq: vi.fn(async () => {
                        updatedOutbox.push(updatePayload);
                        return { data: null, error: null };
                      }),
                      // Also support 2 chained eq calls
                      then: (resolve: any) => {
                        updatedOutbox.push(updatePayload);
                        return resolve({ data: null, error: null });
                      },
                    };
                  }),
                  then: (resolve: any) => {
                    updatedOutbox.push(updatePayload);
                    return resolve({ data: null, error: null });
                  },
                };
              }),
            };
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };

  return {
    client,
    setThreadExpiresAt: (iso: string) => { threadExpiresAt = iso; },
    setThreadMessages: (msgs: any[]) => { threadMessages = msgs; },
    upsertedOutbox,
    updatedOutbox,
  };
}

export const defaultChannelCredential = {
  accessToken: 'fixture_channel_token_drill',
  externalAccountId: 'page_business_123',
  grantedScopes: ['instagram_manage_messages'] as readonly string[],
};
