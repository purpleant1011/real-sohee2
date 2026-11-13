/**
 * Sohee V0.9 Reservation Canonical Service (ANI-981)
 *
 * Core Invariants:
 * 1. Atomic Slot Locking: Zero double-booking collisions under concurrent requests.
 * 2. Durable Persistence: State changes committed to Supabase `reservations` table.
 * 3. Formal State Machine: REQUESTED/PROPOSED -> CONFIRMED -> CANCELLED/COMPLETED.
 * 4. Cancellation & Slot Release: Cancelling frees the slot for subsequent reservation.
 * 5. Reservation Proof: Issues cryptographic proof digest for confirmation audit.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ProofChainService } from '@/lib/evidence/proof-chain-service';
import { maskName, maskPhone } from '@/features/admin/customer360/mask';
import { randomUUID, createHash } from 'node:crypto';
import { isRecoveryEnabled } from '@/features/booking-recovery/production';
import { reservationNoticeVersion, syncBookingNoticeState } from '@/features/notifications/reservation-notice-sync';

export type ReservationCanonicalStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED';

export interface CreateReservationParams {
  workspaceId: string;
  slotId: string; // Unique slot timestamp/identifier (e.g., ISO string)
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  serviceId?: string;
  serviceName?: string;
  depositKrw?: number;
  totalAmountKrw?: number;
  channelSource?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface CanonicalReservation {
  bookingId: string;
  workspaceId: string;
  slotId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  serviceId: string;
  serviceName: string;
  status: ReservationCanonicalStatus;
  depositKrw: number;
  totalAmountKrw: number;
  channelSource: string;
  proofId: string;
  evidenceId?: string;
  confirmedAt: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

export class ReservationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string = 'RESERVATION_ERROR', statusCode: number = 400) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Sequential Mutex Queue for Atomic Slot Operations
 */
class SlotLockManager {
  private queues = new Map<string, Promise<unknown>>();

  public async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) || Promise.resolve();

    const execution = prev.then(
      () => fn(),
      () => fn()
    );

    // Track sequential queue without leaking unhandled rejections
    const tracker = execution
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(key) === tracker) {
          this.queues.delete(key);
        }
      });

    this.queues.set(key, tracker);

    return execution;
  }

  public clear(): void {
    this.queues.clear();
  }
}

export class ReservationCanonicalService {
  private static lockManager = new SlotLockManager();
  private static activeSlotMap = new Map<string, string>(); // `${workspaceId}:${slotId}` -> bookingId
  private static memoryCache = new Map<string, CanonicalReservation>(); // bookingId -> reservation

  /**
   * Resets in-memory state (useful for isolated unit tests)
   */
  public static resetState(): void {
    this.lockManager.clear();
    this.activeSlotMap.clear();
    this.memoryCache.clear();
  }

  /**
   * 1. Create Confirmed Reservation with Atomic Slot Locking (ANI-981)
   */
  public static async createReservation(
    params: CreateReservationParams,
    customSupabase?: any
  ): Promise<CanonicalReservation> {
    // 1. Parameter Validation (Fail-Closed)
    if (!params.workspaceId || !params.slotId || !params.customerId) {
      throw new ReservationError(
        'INVALID_RESERVATION_PARAMS: workspaceId, slotId, and customerId are strictly required.',
        'INVALID_RESERVATION_PARAMS',
        400
      );
    }

    if (
      !params.serviceId ||
      !params.serviceName ||
      !Number.isSafeInteger(params.totalAmountKrw) ||
      params.totalAmountKrw! < 0 ||
      !Number.isSafeInteger(params.depositKrw) ||
      params.depositKrw! < 0 ||
      params.depositKrw! > params.totalAmountKrw!
    ) {
      throw new ReservationError(
        'SERVICE_SPECIFICATION_REQUIRED: serviceId, serviceName, and valid non-negative integer amounts (totalAmountKrw, depositKrw <= totalAmountKrw) are strictly required.',
        'SERVICE_SPECIFICATION_REQUIRED',
        422
      );
    }

    const lockKey = `${params.workspaceId}:${params.slotId}`;

    // 2. Atomic Slot Lock Critical Section
    return this.lockManager.acquire(lockKey, async () => {
      const supabase = customSupabase || (await createServerSupabaseClient());

      // A. Fast-Path In-Memory Check
      if (this.activeSlotMap.has(lockKey)) {
        throw new ReservationError(
          `SLOT_ALREADY_RESERVED: 슬롯 [${params.slotId}]은 이미 예약이 완료되었습니다.`,
          'SLOT_ALREADY_RESERVED',
          409
        );
      }

      // B. Authoritative Database Check
      const { data: existingDb, error: selectErr } = await supabase
        .from('reservations')
        .select('*')
        .eq('workspace_id', params.workspaceId)
        .eq('slot_id', params.slotId)
        .eq('status', 'CONFIRMED')
        .maybeSingle();

      if (selectErr) {
        throw new ReservationError(
          `DB_CHECK_FAILED: 예약 슬롯 확인 중 DB 오류가 발생했습니다: ${selectErr.message}`,
          'DB_CHECK_FAILED',
          500
        );
      }

      if (existingDb) {
        this.activeSlotMap.set(lockKey, existingDb.id);
        throw new ReservationError(
          `SLOT_ALREADY_RESERVED: 슬롯 [${params.slotId}]은 이미 예약되었습니다 (DB 충돌 감지).`,
          'SLOT_ALREADY_RESERVED',
          409
        );
      }

      // B-1. Fail-closed: Prohibit direct bypass write on recovery-managed slots
      if (isRecoveryEnabled(params.workspaceId)) {
        const { data: recoverySlot } = await supabase
          .from('booking_recovery_slots')
          .select('id, status')
          .eq('workspace_id', params.workspaceId)
          .eq('id', params.slotId)
          .maybeSingle();

        if (recoverySlot) {
          throw new ReservationError(
            `DIRECT_CONFIRM_FORBIDDEN: 슬롯 [${params.slotId}]은 예약 문의 회수 런타임에 의해 관리되는 슬롯입니다. 회수 확정 RPC를 통해서만 예약할 수 있습니다.`,
            'DIRECT_CONFIRM_FORBIDDEN',
            403
          );
        }
      }

      // C. Generate Booking Identifiers & Proof
      const bookingId = `bk_${randomUUID()}`;
      const now = new Date().toISOString();
      const depositKrw = params.depositKrw!;
      const totalAmountKrw = params.totalAmountKrw!;
      const serviceId = params.serviceId!;
      const serviceName = params.serviceName!;
      const customerName = params.customerName || '고객님';
      const channelSource = params.channelSource || 'INSTAGRAM_DM';

      const proofDigest = createHash('sha256')
        .update(`${bookingId}::${params.workspaceId}::${params.slotId}::${params.customerId}::${now}`)
        .digest('hex');
      const proofId = `proof_${proofDigest.slice(0, 16)}`;

      // D. Initiate Proof Chain if available
      let evidenceId: string | undefined;
      try {
        const chain = await ProofChainService.initiateProof({
          workspaceId: params.workspaceId,
          actionId: `act_res_${bookingId}`,
          channel: channelSource,
          idempotencyKey: params.idempotencyKey || `res_idem_${bookingId}`,
          requestPayload: {
            bookingId,
            slotId: params.slotId,
            customerId: params.customerId,
            customerName,
            depositKrw,
          },
        });
        evidenceId = chain.evidenceId;
        await ProofChainService.markProviderAccepted(chain.evidenceId, {
          objectId: bookingId,
          rawResponse: { bookingId, status: 'CONFIRMED', confirmedAt: now, proofId },
        });
      } catch (proofErr) {
        console.warn('[ReservationCanonicalService] Evidence chain init warning:', proofErr);
      }

      const reservation: CanonicalReservation = {
        bookingId,
        workspaceId: params.workspaceId,
        slotId: params.slotId,
        customerId: params.customerId,
        customerName,
        customerPhone: params.customerPhone,
        serviceId,
        serviceName,
        status: 'CONFIRMED',
        depositKrw,
        totalAmountKrw,
        channelSource,
        proofId,
        evidenceId,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      // E. Persist into Supabase reservations table
      const dbRow = {
        id: bookingId,
        workspace_id: params.workspaceId,
        slot_id: params.slotId,
        customer_id: params.customerId,
        customer_name: customerName,
        customer_phone: params.customerPhone || null,
        service_id: serviceId,
        service_name: serviceName,
        status: 'CONFIRMED',
        deposit_krw: depositKrw,
        total_amount_krw: totalAmountKrw,
        channel_source: channelSource,
        proof_id: proofId,
        evidence_id: evidenceId || null,
        confirmed_at: now,
        created_at: now,
        updated_at: now,
      };

      const { error: insertErr } = await supabase.from('reservations').insert(dbRow);

      if (insertErr) {
        // Unique constraint conflict on slot
        if (insertErr.code === '23505' || String(insertErr.message).includes('unique')) {
          this.activeSlotMap.set(lockKey, bookingId);
          throw new ReservationError(
            `SLOT_ALREADY_RESERVED: 슬롯 [${params.slotId}] 중복 예약이 DB 제약조건에 의해 차단되었습니다.`,
            'SLOT_ALREADY_RESERVED',
            409
          );
        }
        throw new ReservationError(
          `DB_INSERT_FAILED: 예약 영속화 중 오류가 발생했습니다: ${insertErr.message}`,
          'DB_INSERT_FAILED',
          500
        );
      }

      // F. Commit In-Memory State
      this.activeSlotMap.set(lockKey, bookingId);
      this.memoryCache.set(bookingId, reservation);

      return reservation;
    });
  }

  /**
   * 2. Cancel Reservation & Release Slot Lock (ANI-981)
   */
  public static async cancelReservation(
    bookingId: string,
    reason?: string,
    customSupabase?: any
  ): Promise<CanonicalReservation> {
    if (!bookingId) {
      throw new ReservationError(
        'INVALID_PARAMS: bookingId is required for cancellation.',
        'INVALID_PARAMS',
        400
      );
    }

    const supabase = customSupabase || (await createServerSupabaseClient());

    // 1. Authoritative Database Lookup (never rely on memoryCache as SSOT)
    const { data: dbData, error: findErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (findErr) {
      throw new ReservationError(
        '예약 상태를 조회하지 못했습니다. 잠시 후 다시 확인해 주세요.',
        'CANCELLATION_LOOKUP_FAILED',
        500
      );
    }
    if (!dbData) {
      throw new ReservationError(
        `RESERVATION_NOT_FOUND: 예약 [${bookingId}]을 찾을 수 없습니다.`,
        'RESERVATION_NOT_FOUND',
        404
      );
    }

    const target: CanonicalReservation = {
      bookingId: dbData.id,
      workspaceId: dbData.workspace_id,
      slotId: dbData.slot_id,
      customerId: dbData.customer_id,
      customerName: dbData.customer_name,
      customerPhone: dbData.customer_phone,
      serviceId: dbData.service_id,
      serviceName: dbData.service_name,
      status: dbData.status,
      depositKrw: dbData.deposit_krw,
      totalAmountKrw: dbData.total_amount_krw,
      channelSource: dbData.channel_source,
      proofId: dbData.proof_id,
      evidenceId: dbData.evidence_id,
      confirmedAt: dbData.confirmed_at,
      cancelledAt: dbData.cancelled_at,
      cancelReason: dbData.cancel_reason,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at,
    };

    const lockKey = `${target.workspaceId}:${target.slotId}`;

    return this.lockManager.acquire(lockKey, async () => {
      if (target!.status === 'CANCELLED') {
        return target!;
      }

      const now = new Date().toISOString();
      target!.status = 'CANCELLED';
      target!.cancelledAt = now;
      target!.cancelReason = reason || '고객 요청 취소';
      target!.updatedAt = now;

      // Update in Supabase
      const updatePayload = {
        status: 'CANCELLED',
        cancelled_at: now,
        cancel_reason: target!.cancelReason,
        updated_at: now,
      };

      const { error: cancelError } = await supabase
        .from('reservations')
        .update(updatePayload)
        .eq('id', bookingId);

      if (cancelError) {
        throw new ReservationError(
          '예약 취소를 저장하지 못했습니다. 최신 예약 상태를 다시 확인해 주세요.',
          'CANCELLATION_WRITE_FAILED',
          500
        );
      }

      const { data: persisted, error: readbackError } = await supabase
        .from('reservations')
        .select('status, cancelled_at, cancel_reason, updated_at')
        .eq('id', bookingId)
        .eq('workspace_id', target.workspaceId)
        .maybeSingle();
      if (readbackError || !persisted) {
        throw new ReservationError(
          '취소 요청의 저장 결과를 확인하지 못했습니다. 다시 요청하기 전에 예약 상태를 확인해 주세요.',
          'CANCELLATION_RESULT_UNKNOWN',
          500
        );
      }
      if (persisted.status !== 'CANCELLED') {
        throw new ReservationError(
          '예약 장부에서 취소가 확인되지 않았습니다. 최신 상태를 확인해 주세요.',
          'CANCELLATION_NOT_VERIFIED',
          409
        );
      }
      target!.cancelledAt = persisted.cancelled_at;
      target!.cancelReason = persisted.cancel_reason;
      target!.updatedAt = persisted.updated_at;

      // Release local coordination only after authoritative database readback.
      this.activeSlotMap.delete(lockKey!);
      this.memoryCache.set(bookingId, target!);

      // 취소는 이미 커밋된 뒤다. 알림 동기화 실패가 취소를 실패로 위장하지 않도록
      // 결과는 반환값에 섞지 않고, 동기화 계층이 SYNC_FAILED로 남긴다.
      try {
        await syncBookingNoticeState({
          workspaceId: target!.workspaceId,
          bookingId: target!.bookingId,
          change: 'CANCELLED',
          currentVersion: reservationNoticeVersion(target!.updatedAt),
          currentStatus: 'CANCELLED',
          slotId: target!.slotId,
          updatedAt: target!.updatedAt,
          reason: target!.cancelReason,
        });
      } catch (noticeError) {
        // updated_at에서 version을 유도할 수 없는 경우(비정상 시각)에도 취소는 이미 커밋됐다.
        // 이 경로는 알림 성공을 주장하지 않으며, 예약 결과만 반환한다.
        console.warn('[ReservationCanonicalService] notice sync skipped:', noticeError);
      }

      return target!;
    });
  }

  /**
   * 3. Query Reservation by Booking ID
   */
  public static async getReservation(
    bookingId: string,
    customSupabase?: any
  ): Promise<CanonicalReservation | null> {
    if (this.memoryCache.has(bookingId)) {
      return this.memoryCache.get(bookingId)!;
    }

    const supabase = customSupabase || (await createServerSupabaseClient());
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (error || !data) return null;

    const res: CanonicalReservation = {
      bookingId: data.id,
      workspaceId: data.workspace_id,
      slotId: data.slot_id,
      customerId: data.customer_id,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      serviceId: data.service_id,
      serviceName: data.service_name,
      status: data.status,
      depositKrw: data.deposit_krw,
      totalAmountKrw: data.total_amount_krw,
      channelSource: data.channel_source,
      proofId: data.proof_id,
      evidenceId: data.evidence_id,
      confirmedAt: data.confirmed_at,
      cancelledAt: data.cancelled_at,
      cancelReason: data.cancel_reason,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    this.memoryCache.set(bookingId, res);
    return res;
  }

  /**
   * 4. List Reservations for Workspace with PII Masking
   */
  public static async listReservations(
    params: {
      workspaceId: string;
      status?: ReservationCanonicalStatus | 'ALL';
      startDate?: string;
      endDate?: string;
      limit?: number;
    },
    customSupabase?: any
  ): Promise<{
    reservations: Array<{
      bookingId: string;
      slotId: string;
      customerName: string;
      customerPhone?: string;
      serviceName: string;
      status: ReservationCanonicalStatus;
      depositKrw: number;
      totalAmountKrw: number;
      channelSource: string;
      confirmedAt: string;
    }>;
    count: number;
    empty: boolean;
  }> {
    if (!params.workspaceId) {
      throw new ReservationError(
        'INVALID_PARAMS: workspaceId is required.',
        'INVALID_PARAMS',
        400
      );
    }

    const supabase = customSupabase || (await createServerSupabaseClient());
    let query = supabase
      .from('reservations')
      .select('*')
      .eq('workspace_id', params.workspaceId);

    if (params.status && params.status !== 'ALL') {
      query = query.eq('status', params.status);
    }
    if (params.startDate) {
      query = query.gte('confirmed_at', params.startDate);
    }
    if (params.endDate) {
      query = query.lte('confirmed_at', params.endDate);
    }

    query = query.order('confirmed_at', { ascending: false }).limit(params.limit || 50);

    const { data, error } = await query;

    if (error) {
      throw new ReservationError(
        `예약 목록 조회 중 데이터베이스 오류가 발생했습니다: ${error.message}`,
        'RESERVATION_LIST_FAILED',
        500
      );
    }

    if (!Array.isArray(data)) {
      throw new ReservationError(
        '예약 목록 응답에 행 목록이 없습니다.',
        'RESERVATION_LIST_FAILED',
        500
      );
    }
    const rows = data;
    const reservations = rows.map((r: any) => ({
      bookingId: r.id,
      slotId: r.slot_id,
      customerName: r.customer_name ? maskName(r.customer_name) : '고객님',
      customerPhone: r.customer_phone ? maskPhone(r.customer_phone) : undefined,
      serviceName: r.service_name || '서비스',
      status: r.status as ReservationCanonicalStatus,
      depositKrw: r.deposit_krw || 0,
      totalAmountKrw: r.total_amount_krw || 0,
      channelSource: r.channel_source || 'UNKNOWN',
      confirmedAt: r.confirmed_at || r.created_at,
    }));

    return {
      reservations,
      count: reservations.length,
      empty: reservations.length === 0,
    };
  }

  /**
   * 5. Reschedule Reservation (ANI-1612)
   * Atomically swaps existing reservation slot for a new verified slot under dual-lock.
   * If new slot insertion or update fails, the old reservation is preserved untouched (zero partial write).
   */
  public static async rescheduleReservation(
    bookingId: string,
    newSlotId: string,
    reason?: string,
    customSupabase?: any
  ): Promise<CanonicalReservation> {
    if (!bookingId || !newSlotId) {
      throw new ReservationError(
        'INVALID_PARAMS: bookingId and newSlotId are required for rescheduling.',
        'INVALID_PARAMS',
        400
      );
    }

    const supabase = customSupabase || (await createServerSupabaseClient());

    // 1. Authoritative Database Lookup of current reservation
    const { data: dbData, error: findErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (findErr) {
      throw new ReservationError(
        '예약 상태를 조회하지 못했습니다. 잠시 후 다시 확인해 주세요.',
        'RESCHEDULE_LOOKUP_FAILED',
        500
      );
    }
    if (!dbData) {
      throw new ReservationError(
        `RESERVATION_NOT_FOUND: 예약 [${bookingId}]을 찾을 수 없습니다.`,
        'RESERVATION_NOT_FOUND',
        404
      );
    }

    if (dbData.status !== 'CONFIRMED') {
      throw new ReservationError(
        `INVALID_STATUS: 확정 상태의 예약만 일정을 변경할 수 있습니다 (현재: ${dbData.status}).`,
        'INVALID_STATUS',
        400
      );
    }

    if (dbData.slot_id === newSlotId) {
      throw new ReservationError(
        'SAME_SLOT: 기존과 동일한 슬롯으로 변경할 수 없습니다.',
        'SAME_SLOT',
        400
      );
    }

    const oldLockKey = `${dbData.workspace_id}:${dbData.slot_id}`;
    const newLockKey = `${dbData.workspace_id}:${newSlotId}`;

    // Acquire locks in deterministic order to prevent deadlock
    const [firstKey, secondKey] =
      oldLockKey < newLockKey ? [oldLockKey, newLockKey] : [newLockKey, oldLockKey];

    return this.lockManager.acquire(firstKey, async () => {
      return this.lockManager.acquire(secondKey, async () => {
        // Verify new slot is available and belongs to same workspace
        const { data: newSlot, error: slotErr } = await supabase
          .from('booking_recovery_slots')
          .select('*')
          .eq('workspace_id', dbData.workspace_id)
          .eq('id', newSlotId)
          .maybeSingle();

        if (slotErr || !newSlot) {
          throw new ReservationError(
            '변경 대상 슬롯을 찾을 수 없거나 접근 권한이 없습니다.',
            'SLOT_NOT_FOUND',
            404
          );
        }

        if (newSlot.status !== 'AVAILABLE') {
          throw new ReservationError(
            '변경 대상 슬롯이 이미 마감되었거나 예약 불가능한 상태입니다.',
            'SLOT_NOT_AVAILABLE',
            409
          );
        }

        const now = new Date().toISOString();

        // Atomic swap in DB
        const updatePayload = {
          slot_id: newSlotId,
          updated_at: now,
        };

        const { error: updateErr } = await supabase
          .from('reservations')
          .update(updatePayload)
          .eq('id', bookingId)
          .eq('workspace_id', dbData.workspace_id);

        if (updateErr) {
          if (updateErr.code === '23505' || String(updateErr.message).includes('unique')) {
            throw new ReservationError(
              'SLOT_ALREADY_RESERVED: 변경 대상 슬롯에 이미 다른 예약이 존재합니다.',
              'SLOT_ALREADY_RESERVED',
              409
            );
          }
          throw new ReservationError(
            `RESCHEDULE_WRITE_FAILED: 예약 변경 저장 중 오류가 발생했습니다: ${updateErr.message}`,
            'RESCHEDULE_WRITE_FAILED',
            500
          );
        }

        // Readback verification
        const { data: persisted, error: readbackErr } = await supabase
          .from('reservations')
          .select('*')
          .eq('id', bookingId)
          .eq('workspace_id', dbData.workspace_id)
          .maybeSingle();

        if (readbackErr || !persisted || persisted.slot_id !== newSlotId) {
          throw new ReservationError(
            '예약 변경의 저장 결과를 확인하지 못했습니다. 최신 상태를 확인해 주세요.',
            'RESCHEDULE_RESULT_UNKNOWN',
            500
          );
        }

        // Release old slot coordination, acquire new slot coordination
        this.activeSlotMap.delete(oldLockKey);
        this.activeSlotMap.set(newLockKey, bookingId);

        const updatedReservation: CanonicalReservation = {
          bookingId: persisted.id,
          workspaceId: persisted.workspace_id,
          slotId: persisted.slot_id,
          customerId: persisted.customer_id,
          customerName: persisted.customer_name,
          customerPhone: persisted.customer_phone,
          serviceId: persisted.service_id,
          serviceName: persisted.service_name,
          status: persisted.status,
          depositKrw: persisted.deposit_krw,
          totalAmountKrw: persisted.total_amount_krw,
          channelSource: persisted.channel_source,
          proofId: persisted.proof_id,
          evidenceId: persisted.evidence_id,
          confirmedAt: persisted.confirmed_at,
          cancelledAt: persisted.cancelled_at,
          cancelReason: persisted.cancel_reason,
          createdAt: persisted.created_at,
          updatedAt: persisted.updated_at,
        };

        this.memoryCache.set(bookingId, updatedReservation);

        // 변경도 이미 커밋·readback된 뒤다. 구 일정 안내를 무효화하고 새 일정으로만 재계획한다.
        try {
          await syncBookingNoticeState({
            workspaceId: updatedReservation.workspaceId,
            bookingId: updatedReservation.bookingId,
            change: 'RESCHEDULED',
            currentVersion: reservationNoticeVersion(updatedReservation.updatedAt),
            currentStatus: 'CONFIRMED',
            slotId: updatedReservation.slotId,
            updatedAt: updatedReservation.updatedAt,
            reason,
          });
        } catch (noticeError) {
          // version 유도 실패 등 동기화 이전 단계의 오류도 변경 결과를 뒤집지 않는다.
          console.warn('[ReservationCanonicalService] notice sync skipped:', noticeError);
        }

        return updatedReservation;
      });
    });
  }
}
