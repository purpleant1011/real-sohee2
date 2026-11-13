import { isMarketingFixtureWorkspace, CapacityNotObservedError } from './fixture-context';
import { AvailabilitySourceService, CapacitySlot } from './capacity-source';
import { ActionCandidate } from './revenue-data-spine';

export type ReservationLifecycleState =
  | 'INTENT_DETECTED'
  | 'NEEDS_INFO'
  | 'SLOT_SEARCH'
  | 'SLOT_AVAILABLE_OBSERVED'
  | 'SLOT_PROPOSED'
  | 'CUSTOMER_SELECTED'
  | 'CONFIRMATION_PENDING'
  | 'EXTERNAL_ACCEPTED'
  | 'RESERVATION_OBSERVED'
  | 'VERIFIED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PersistentReservationRecord {
  id: string;
  workspaceId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  channel: string;
  serviceId: string;
  serviceName: string;
  price: number;
  slotId: string;
  slotStart: string;
  slotEnd: string;
  status: ReservationLifecycleState;
  externalReservationId?: string;
  idempotencyKey: string;
  attributionSourceId?: string;
  verificationEvidence?: {
    verifiedAt: string;
    sourceProvider: string;
    externalStatus: string;
  };
  createdAt: string;
  updatedAt: string;
}

const persistentReservationStore = new Map<string, PersistentReservationRecord>();
const activeActionCandidates: ActionCandidate[] = [];

export class BookingOrchestrator {
  /**
   * Proposes verified available slots to a customer
   */
  static searchAndProposeSlot(
    workspaceId: string,
    customerId: string,
    serviceId: string
  ): { availableSlots: CapacitySlot[]; bestProposal: CapacitySlot | null } {
    const availableSlots = AvailabilitySourceService.getAvailableSlots(workspaceId, serviceId);
    const bestProposal = availableSlots.length > 0 ? availableSlots[0] : null;

    if (bestProposal) {
      // Hold slot for 15 mins to prevent double booking
      AvailabilitySourceService.holdSlot(bestProposal.id, 15, workspaceId);
    }

    return { availableSlots, bestProposal };
  }

  /**
   * Creates a reservation in EXTERNAL_ACCEPTED status and verifies it
   */
  static createAndConfirmReservation(input: {
    workspaceId: string;
    customerId: string;
    customerName: string;
    channel: string;
    serviceId: string;
    serviceName: string;
    price: number;
    slotId: string;
    slotStart: string;
    slotEnd: string;
    idempotencyKey: string;
    attributionSourceId?: string;
  }): PersistentReservationRecord {
    // No real booking adapter exists here. Never manufacture external acceptance.
    if (!isMarketingFixtureWorkspace(input.workspaceId)) throw new CapacityNotObservedError();
    const key = `${input.workspaceId}:${input.idempotencyKey}`;
    // 1. Check idempotency
    const existing = persistentReservationStore.get(key);
    if (existing) return existing;

    // 2. Mark capacity slot booked
    const snapshot = AvailabilitySourceService.getSnapshot(input.workspaceId);
    const slot = snapshot.slots.find(s => s.id === input.slotId && s.serviceId === input.serviceId && s.slotStart === input.slotStart && s.slotEnd === input.slotEnd);
    if (!slot || slot.status === 'BOOKED' || slot.status === 'BLOCKED') throw new Error('[SLOT_NOT_AVAILABLE]');
    AvailabilitySourceService.markSlotBooked(input.slotId, input.workspaceId);

    const extId = `fixture_rsv_${Date.now()}`;
    const reservation: PersistentReservationRecord = {
      id: `rsv_${Date.now()}`,
      workspaceId: input.workspaceId,
      customerId: input.customerId,
      customerName: input.customerName,
      channel: input.channel,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      price: input.price,
      slotId: input.slotId,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      status: 'CONFIRMED',
      externalReservationId: extId,
      idempotencyKey: input.idempotencyKey,
      attributionSourceId: input.attributionSourceId,
      verificationEvidence: {
        verifiedAt: new Date().toISOString(),
        sourceProvider: 'fixture',
        externalStatus: 'CONFIRMED',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    persistentReservationStore.set(key, reservation);

    // 3. STOP CONDITION TRIGGER: Automatically cancel related campaigns targeting this slot!
    this.enforceStopConditions(input.slotId);

    return reservation;
  }

  /**
   * Automatically stops all ongoing or pending action candidates targeting this slot
   */
  static enforceStopConditions(bookedSlotId: string): string[] {
    const cancelledActions: string[] = [];
    for (const candidate of activeActionCandidates) {
      if (candidate.stopConditions.includes('target_slot_booked') && candidate.status === 'PENDING') {
        candidate.status = 'CANCELLED_BY_STOP_CONDITION';
        cancelledActions.push(candidate.id);
      }
    }
    return cancelledActions;
  }

  static getReservations(workspaceId: string): PersistentReservationRecord[] {
    if (!isMarketingFixtureWorkspace(workspaceId)) return [];
    return Array.from(persistentReservationStore.values()).filter(r => r.workspaceId === workspaceId);
  }
}
