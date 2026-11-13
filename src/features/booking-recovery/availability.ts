import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecoveryResult, RecoveryActor } from './contracts';

export interface CatalogService {
  id: string;
  workspaceId: string;
  name: string;
  price: number | null;
  active: boolean;
  updatedAt: string;
  durationMinutes?: number | null;
}

export interface OwnerConfirmedSlot {
  id: string;
  workspaceId: string;
  serviceId: string;
  depositKrw: number;
  catalogVersion: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  confirmedBy: string;
  confirmedAt: string;
  validUntil: string;
  version: number;
  status: 'AVAILABLE' | 'BOOKED' | 'WITHDRAWN';
}

export interface VerifiedOffer {
  serviceId: string;
  serviceName: string;
  priceKrw: number;
  depositKrw: number;
  durationMinutes: number;
  catalogVersion: string;
  slotId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  slotVersion: number;
  observedAt: string;
}

/**
 * ANI-1610: Ledger Freshness & Observability Contract.
 * Distinguishes true observational states from synthetic assumptions.
 * - CURRENT: Verified fresh against active owner confirmation or independent readback within TTL.
 * - STALE: Past confirmation expired, requires reattestation before execution.
 * - NOT_OBSERVED: No external ledger integration connected; only owner-confirmed manual slots supported.
 * - ERROR: Failed query or lookup outage; distinct from empty results.
 */
export type LedgerFreshness = 'CURRENT' | 'STALE' | 'NOT_OBSERVED' | 'ERROR';

export interface LedgerFreshnessEnvelope<T> {
  freshness: LedgerFreshness;
  data: T | null;
  observedAt: string | null;
  requiresOwnerConfirmation: boolean;
  message?: string;
}

/**
 * Evaluates whether an external ledger connection is active.
 * When not connected, returns NOT_OBSERVED fail-closed rather than synthetic empty or current.
 */
export function getLedgerStatus(hasExternalLedgerConnection: boolean = false): LedgerFreshnessEnvelope<null> {
  if (!hasExternalLedgerConnection) {
    return {
      freshness: 'NOT_OBSERVED',
      data: null,
      observedAt: null,
      requiresOwnerConfirmation: true,
      message: '외부 장부 연동이 설정되지 않았습니다. 사장님 수동 확인(OwnerConfirmedSlot)을 통해서만 제안이 가능합니다.',
    };
  }
  return {
    freshness: 'CURRENT',
    data: null,
    observedAt: new Date().toISOString(),
    requiresOwnerConfirmation: false,
  };
}

export const availabilitySlotInputSchema = z
  .object({
    serviceId: z.string().uuid(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    depositKrw: z.number().int().min(0, '예약금은 0원 이상의 정수여야 합니다.'),
    timezone: z.string().min(1).default('Asia/Seoul'),
    acknowledgedLedger: z.literal(true, {
      message: '실제 장부/예약표 확인 서명이 필요합니다.',
    }),
  })
  .strict();

export type AvailabilitySlotInput = z.infer<typeof availabilitySlotInputSchema>;

/**
 * Validates and certifies an offer from an active catalog service and an owner-confirmed slot.
 * Enforces zero-fabrication: unverified, past, cross-workspace, or conflicting slots fail closed.
 */
export function verifyOffer(input: {
  service: CatalogService;
  slot: OwnerConfirmedSlot | null;
  depositKrw: number | null;
  now?: string;
}): RecoveryResult<VerifiedOffer> {
  const currentIso = input.now ?? new Date().toISOString();
  const currentMs = Date.parse(currentIso);

  if (Number.isNaN(currentMs)) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '기준 시각(now)이 올바른 날짜 형식이 아닙니다.',
    };
  }

  // 1. Service specification and price check
  if (!input.service.name?.trim() || !input.service.updatedAt?.trim()) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '서비스 이름과 확인된 카탈로그 버전이 필요합니다.',
    };
  }

  if (!input.service.active) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '비활성화된 상품/서비스는 예약 제안에 사용할 수 없습니다.',
    };
  }

  if (
    input.service.price === null ||
    input.service.price === undefined ||
    !Number.isSafeInteger(input.service.price) ||
    input.service.price < 0
  ) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '서비스 정가가 확정되지 않았습니다. 카탈로그 가격을 먼저 설정해 주세요.',
    };
  }

  // 1.1 Service duration check
  if (
    input.service.durationMinutes === null ||
    input.service.durationMinutes === undefined ||
    !Number.isSafeInteger(input.service.durationMinutes) ||
    input.service.durationMinutes <= 0
  ) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '서비스 소요시간이 설정되지 않았습니다. 카탈로그에서 소요시간을 먼저 설정해 주세요.',
    };
  }

  // 2. Deposit validation (Explicit safe integer required, 0 is allowed)
  if (
    input.depositKrw === null ||
    input.depositKrw === undefined ||
    !Number.isSafeInteger(input.depositKrw) ||
    input.depositKrw < 0 ||
    input.depositKrw > input.service.price
  ) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '예약금은 0원 이상이며 서비스 금액을 초과할 수 없습니다.',
    };
  }

  // 3. Slot presence, tenancy, and status check
  if (!input.slot) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '사장님이 장부를 확인한 가용 시간(슬롯)이 필요합니다.',
    };
  }

  if (input.service.workspaceId !== input.slot.workspaceId) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: '서비스와 슬롯의 작업공간이 일치하지 않습니다.',
    };
  }

  if (input.slot.status !== 'AVAILABLE') {
    return {
      ok: false,
      code: 'SLOT_CONFLICT',
      message: '해당 시간은 이미 예약되었거나 철회된 슬롯입니다.',
    };
  }

  if (input.slot.serviceId !== input.service.id) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '선택한 서비스와 가용 슬롯의 서비스가 일치하지 않습니다.',
    };
  }

  if (input.slot.catalogVersion !== input.service.updatedAt) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '서비스 정보가 변경되었습니다. 가격과 예약 시간을 다시 확인해 주세요.',
    };
  }

  // 4. Timezone validation (Valid IANA zone required)
  try {
    Intl.DateTimeFormat(undefined, { timeZone: input.slot.timezone });
  } catch {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: `유효하지 않은 시간대 식별자입니다: ${input.slot.timezone}`,
    };
  }

  // 5. Time range and deadline validity checks (strict fail-closed on NaN)
  const startMs = Date.parse(input.slot.startsAt);
  const endMs = Date.parse(input.slot.endsAt);
  const validUntilMs = Date.parse(input.slot.validUntil);
  const confirmedAtMs = Date.parse(input.slot.confirmedAt);

  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    Number.isNaN(validUntilMs) ||
    Number.isNaN(confirmedAtMs) ||
    endMs <= startMs
  ) {
    return {
      ok: false,
      code: 'CONTEXT_REQUIRED',
      message: '예약 일시 또는 유효기간이 올바르지 않습니다.',
    };
  }

  if (startMs <= currentMs) {
    return {
      ok: false,
      code: 'SLOT_CONFLICT',
      message: '이미 시작 시각이 지난 슬롯은 제안할 수 없습니다.',
    };
  }

  if (confirmedAtMs > currentMs || currentMs - confirmedAtMs >= 15 * 60 * 1000) {
    return {
      ok: false,
      code: 'SLOT_CONFLICT',
      message: '장부의 최신 확인이 필요합니다. 빈시간 맞나요? 사장님이 다시 확인해 주세요.',
    };
  }

  if (validUntilMs <= currentMs) {
    return {
      ok: false,
      code: 'SLOT_CONFLICT',
      message: '슬롯 확인 유효기간(15분)이 만료되었습니다. 장부를 재확인해 주세요.',
    };
  }

  const slotDurationMinutes = Math.floor((endMs - startMs) / (60 * 1000));
  if (slotDurationMinutes < input.service.durationMinutes) {
    return {
      ok: false,
      code: 'SLOT_CONFLICT',
      message: `선택한 슬롯 시간(${slotDurationMinutes}분)이 서비스 소요시간(${input.service.durationMinutes}분)보다 짧습니다.`,
    };
  }

  return {
    ok: true,
    value: {
      serviceId: input.service.id,
      serviceName: input.service.name,
      priceKrw: input.service.price,
      depositKrw: input.depositKrw,
      durationMinutes: input.service.durationMinutes,
      catalogVersion: input.service.updatedAt,
      slotId: input.slot.id,
      startsAt: input.slot.startsAt,
      endsAt: input.slot.endsAt,
      timezone: input.slot.timezone,
      slotVersion: input.slot.version,
      observedAt: currentIso,
    },
  };
}

/**
 * A slot request the owner can fix by editing the catalog or the time range.
 * Carries the HTTP status and a stable code so the route can stop flattening these into a 500:
 * "예약 가능 시간 등록 중 오류가 발생했습니다" tells the owner nothing about what to change.
 * Anything that is NOT one of these is a genuine server fault and must stay a 500.
 */
export class SlotRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'SLOT_START_IN_PAST'
      | 'SLOT_END_BEFORE_START'
      | 'SLOT_SERVICE_NOT_FOUND'
      | 'SLOT_SERVICE_INACTIVE'
      | 'SLOT_SERVICE_PRICE_MISSING'
      | 'SLOT_SERVICE_DURATION_MISSING'
      | 'SLOT_TOO_SHORT'
      | 'SLOT_DEPOSIT_EXCEEDS_PRICE'
      | 'SLOT_TIME_OVERLAP',
    readonly status: 400 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'SlotRequestError';
  }
}

/**
 * DB Helper: Confirms and records an available slot by owner.
 * validUntil is conservative TTL (min of 15 min from confirmation or start time).
 * Cleans up expired AVAILABLE slots in the same workspace to prevent exclusion space pollution.
 */
export async function createOwnerConfirmedSlot(
  client: SupabaseClient<any>,
  actor: RecoveryActor,
  rawInput: unknown
): Promise<OwnerConfirmedSlot> {
  const input = availabilitySlotInputSchema.parse(rawInput);
  const now = new Date();
  const start = new Date(input.startsAt);

  if (start.getTime() <= now.getTime()) {
    throw new SlotRequestError('시작 일시는 현재 시각 이후여야 합니다.', 'SLOT_START_IN_PAST', 400);
  }

  const end = new Date(input.endsAt);
  if (end.getTime() <= start.getTime()) {
    throw new SlotRequestError('종료 일시는 시작 일시보다 뒤여야 합니다.', 'SLOT_END_BEFORE_START', 400);
  }

  // Verify service exists, belongs to workspace, is active, has valid price and duration
  const { data: service, error: srvErr } = await client
    .from('workspace_products_services')
    .select('id, workspace_id, name, price, active, updated_at, duration_minutes')
    .eq('workspace_id', actor.workspaceId)
    .eq('id', input.serviceId)
    .maybeSingle();

  if (srvErr || !service) {
    throw new SlotRequestError('존재하지 않거나 접근할 수 없는 카탈로그 서비스입니다.', 'SLOT_SERVICE_NOT_FOUND', 404);
  }

  if (!service.active) {
    throw new SlotRequestError('비활성화된 서비스에는 슬롯을 등록할 수 없습니다.', 'SLOT_SERVICE_INACTIVE', 400);
  }

  if (service.price === null || service.price === undefined || !Number.isSafeInteger(service.price)) {
    throw new SlotRequestError('서비스 가격이 확정되지 않았습니다. 카탈로그 설정을 확인해 주세요.', 'SLOT_SERVICE_PRICE_MISSING', 422);
  }

  // The catalog table has no free-form metadata column; duration_minutes is the only source of truth.
  const durationMinutes = service.duration_minutes ?? null;

  if (
    durationMinutes === null ||
    durationMinutes === undefined ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes <= 0
  ) {
    throw new SlotRequestError(
      '서비스 소요시간이 설정되지 않았습니다. 카탈로그에서 소요시간을 먼저 설정해 주세요.',
      'SLOT_SERVICE_DURATION_MISSING',
      422,
    );
  }

  const slotMinutes = Math.floor((end.getTime() - start.getTime()) / (60 * 1000));
  if (slotMinutes < durationMinutes) {
    throw new SlotRequestError(
      `선택한 슬롯 시간(${slotMinutes}분)이 서비스 소요시간(${durationMinutes}분)보다 짧습니다.`,
      'SLOT_TOO_SHORT',
      422,
    );
  }

  if (input.depositKrw > service.price) {
    throw new SlotRequestError('예약금은 서비스 금액을 초과할 수 없습니다.', 'SLOT_DEPOSIT_EXCEEDS_PRICE', 422);
  }

  // Withdraw any expired AVAILABLE slots for this workspace to release exclusion locks
  await client
    .from('booking_recovery_slots')
    .update({ status: 'WITHDRAWN' })
    .eq('workspace_id', actor.workspaceId)
    .eq('status', 'AVAILABLE')
    .lte('valid_until', now.toISOString());

  const defaultTtlMs = 15 * 60 * 1000; // 15 minutes conservative TTL
  const validUntil = new Date(Math.min(now.getTime() + defaultTtlMs, start.getTime()));

  const row = {
    workspace_id: actor.workspaceId,
    service_id: input.serviceId,
    deposit_krw: input.depositKrw,
    catalog_version: service.updated_at,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    timezone: input.timezone,
    confirmed_by: actor.userId,
    confirmed_at: now.toISOString(),
    valid_until: validUntil.toISOString(),
    version: 1,
    status: 'AVAILABLE',
  };

  const { data, error } = await client
    .from('booking_recovery_slots')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23P01' || error.message?.includes('exclusion constraint')) {
      throw new SlotRequestError(
        '해당 시간에 이미 다른 예약 또는 확인된 슬롯이 존재합니다 (시간 겹침).',
        'SLOT_TIME_OVERLAP',
        409,
      );
    }
    throw new Error(`슬롯 생성 실패: ${error.message}`);
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    serviceId: data.service_id,
    depositKrw: data.deposit_krw,
    catalogVersion: data.catalog_version,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    timezone: data.timezone,
    confirmedBy: data.confirmed_by,
    confirmedAt: data.confirmed_at,
    validUntil: data.valid_until,
    version: data.version,
    status: data.status,
  };
}
