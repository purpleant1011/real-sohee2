import { BookingRecord, BookingStatus } from './types';

export interface CreateBookingParams {
  workspaceId: string;
  customerId: string;
  serviceName: string;
  slotStartTime: string;
  slotEndTime: string;
  attributedSourceEventId?: string;
  initialStatus?: BookingStatus;
  holdTtlMinutes?: number;
}

/**
 * @deprecated V0.91 Canon (ANI-1272 / ANI-1249):
 * BookingLifecycleEngine is a pure domain state machine calculator for test verification.
 * Production reservation authority is strictly owned by Supabase `reservations` table and DB partial unique active-slot constraint.
 */
export class BookingLifecycleEngine {
  public readonly isDomainOnly = true;
  private bookings: Map<string, BookingRecord> = new Map();

  /**
   * 신규 예약 레코드 생성 (기본: LEAD 또는 INTENT 또는 HOLD) (ANI-851)
   */
  createBooking(params: CreateBookingParams): BookingRecord {
    const {
      workspaceId,
      customerId,
      serviceName,
      slotStartTime,
      slotEndTime,
      attributedSourceEventId,
      initialStatus = 'LEAD',
      holdTtlMinutes = 15,
    } = params;

    const bookingId = `book_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    let holdExpiresAt: string | undefined;
    if (initialStatus === 'HOLD') {
      holdExpiresAt = new Date(Date.now() + holdTtlMinutes * 60 * 1000).toISOString();
    }

    const record: BookingRecord = {
      bookingId,
      workspaceId,
      customerId,
      serviceName,
      slotStartTime,
      slotEndTime,
      status: initialStatus,
      statusHistory: [{ status: initialStatus, changedAt: now, reason: 'Booking initialized' }],
      holdExpiresAt,
      attributedSourceEventId,
      createdAt: now,
      updatedAt: now,
    };

    this.bookings.set(bookingId, record);
    return record;
  }

  /**
   * 상태 전이 실행 (엄격한 전이 규칙 및 폐쇄 루프)
   */
  transitionStatus(
    bookingId: string,
    targetStatus: BookingStatus,
    options?: {
      reason?: string;
      revenueKrw?: number;
      holdTtlMinutes?: number;
    }
  ): BookingRecord {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`);
    }

    const currentStatus = booking.status;
    const now = new Date().toISOString();

    // HOLD 상태 만료 검사
    if (currentStatus === 'HOLD' && booking.holdExpiresAt) {
      if (new Date(booking.holdExpiresAt).getTime() < Date.now()) {
        booking.status = 'CANCELLED';
        booking.statusHistory.push({
          status: 'CANCELLED',
          changedAt: now,
          reason: 'Hold slot timed out and expired',
        });
        booking.updatedAt = now;
        if (targetStatus !== 'CANCELLED') {
          throw new Error(`Cannot transition: HOLD reservation expired.`);
        }
        return booking;
      }
    }

    // 전이 유효성 검사
    if (targetStatus === 'HOLD') {
      const ttl = options?.holdTtlMinutes || 15;
      booking.holdExpiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
    }

    if (targetStatus === 'CONFIRMED') {
      if (currentStatus !== 'HOLD' && currentStatus !== 'INTENT' && currentStatus !== 'LEAD') {
        throw new Error(`Cannot confirm booking from ${currentStatus}`);
      }
      booking.holdExpiresAt = undefined;
    }

    if (targetStatus === 'VISITED' || targetStatus === 'NO_SHOW') {
      if (currentStatus !== 'CONFIRMED') {
        throw new Error(`Only CONFIRMED bookings can transition to ${targetStatus}`);
      }
    }

    if (targetStatus === 'REVENUE_ATTRIBUTED') {
      if (currentStatus !== 'VISITED') {
        throw new Error(`Only VISITED bookings can have revenue attributed`);
      }
      if (options?.revenueKrw !== undefined) {
        booking.revenueKrw = options.revenueKrw;
      }
      if (!booking.revenueKrw || booking.revenueKrw <= 0) {
        throw new Error(`Revenue must be greater than 0 for REVENUE_ATTRIBUTED`);
      }
    }

    booking.status = targetStatus;
    booking.statusHistory.push({
      status: targetStatus,
      changedAt: now,
      reason: options?.reason,
    });
    booking.updatedAt = now;

    return booking;
  }

  getBooking(bookingId: string): BookingRecord | undefined {
    return this.bookings.get(bookingId);
  }

  listCustomerBookings(customerId: string): BookingRecord[] {
    return Array.from(this.bookings.values()).filter((b) => b.customerId === customerId);
  }
}
