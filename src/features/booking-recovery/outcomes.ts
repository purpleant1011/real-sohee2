export interface RecoveryEventRecord {
  id: string;
  workspaceId: string;
  caseId: string;
  eventType: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'REPLY_SENT';
  reservationId?: string | null;
  amountKrw?: number | null;
  occurredAt: string;
  isActual: boolean;
}

export interface RecoveryOutcomeResult {
  confirmedBookings: number;
  activeConfirmedBookings: number;
  cancelledBookings: number;
  revenue: {
    status: 'NOT_OBSERVED';
    amountKrw: null;
  };
  observedAt: string;
}

/**
 * Calculates recovery outcome truth-preservingly:
 * - NEVER fabricates revenue from booking deposits/amounts without payment observation.
 * - Distinctly counts bookings to eliminate duplicate events.
 * - Separates cumulative confirmed bookings from active confirmed bookings (accounting for cancellations).
 * - Filters out non-ACTUAL (test, demo, showcase) data when requireActual is true.
 */
export function calculateRecoveryOutcome(
  events: RecoveryEventRecord[],
  options: {
    timezone?: string;
    requireActual?: boolean;
    since?: string;
    until?: string;
  } = {}
): RecoveryOutcomeResult {
  const { requireActual = true, since, until } = options;

  const filteredEvents = events.filter((ev) => {
    if (requireActual && !ev.isActual) return false;
    if (since && ev.occurredAt < since) return false;
    if (until && ev.occurredAt > until) return false;
    return true;
  });

  const confirmedBookingIds = new Set<string>();
  const cancelledBookingIds = new Set<string>();

  for (const ev of filteredEvents) {
    if (!ev.reservationId) continue;

    if (ev.eventType === 'BOOKING_CONFIRMED') {
      confirmedBookingIds.add(ev.reservationId);
    } else if (ev.eventType === 'BOOKING_CANCELLED') {
      cancelledBookingIds.add(ev.reservationId);
    }
  }

  const cumulativeConfirmed = confirmedBookingIds.size;
  const cancelledCount = cancelledBookingIds.size;

  // Active confirmed bookings are those confirmed but not cancelled
  let activeConfirmed = 0;
  for (const id of confirmedBookingIds) {
    if (!cancelledBookingIds.has(id)) {
      activeConfirmed++;
    }
  }

  return {
    confirmedBookings: cumulativeConfirmed,
    activeConfirmedBookings: activeConfirmed,
    cancelledBookings: cancelledCount,
    revenue: {
      status: 'NOT_OBSERVED',
      amountKrw: null,
    },
    observedAt: new Date().toISOString(),
  };
}
