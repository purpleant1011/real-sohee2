/**
 * Sohee V0.8.9 Lead Qualification & Reservation Agent
 * 
 * Manages:
 * 1. Customer reservation intent extraction & qualification.
 * 2. Slot availability negotiation & confirmation receipt issuance.
 * 3. Synchronization with store calendar and notifications.
 */

export type ReservationStatus =
  | 'REQUESTED'
  | 'SLOT_PROPOSED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface ReservationRecord {
  reservationId: string;
  workspaceId: string;
  customerName: string;
  customerPhone?: string;
  channelSource: 'INSTAGRAM_DM' | 'DAANGN_CHAT' | 'NAVER_TALK' | 'MANUAL';
  partySize: number;
  requestedDateTime: string;
  status: ReservationStatus;
  specialRequests?: string;
  confirmedAt?: string;
  createdAt: string;
}

export function createReservationRequest(
  data: Omit<ReservationRecord, 'reservationId' | 'status' | 'createdAt'>
): ReservationRecord {
  return {
    ...data,
    reservationId: `res_${Date.now()}`,
    status: 'REQUESTED',
    createdAt: new Date().toISOString()
  };
}

export function confirmReservation(
  reservation: ReservationRecord
): ReservationRecord {
  return {
    ...reservation,
    status: 'CONFIRMED',
    confirmedAt: new Date().toISOString()
  };
}
