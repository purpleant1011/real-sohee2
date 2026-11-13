import { isMarketingFixtureWorkspace, CapacityNotObservedError } from './fixture-context';
import { SAMPLE_CAPACITY_SLOTS } from './fixtures/marketing-samples';

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: number;
  currency: string;
  description: string;
}

export interface CapacitySlot {
  id: string;
  workspaceId: string;
  serviceId: string;
  resourceId: string;
  resourceName: string;
  slotStart: string; // ISO 8601
  slotEnd: string;   // ISO 8601
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdExpiresAt?: string;
  observedAt: string;
  providerVersion: string;
}

export interface CapacitySnapshot {
  id: string;
  workspaceId: string;
  sourceProvider: 'naver_reservation' | 'internal_db' | 'google_calendar' | 'fixture';
  sourceVersion: string;
  observedAt: string;
  totalSlotsCount: number;
  availableSlotsCount: number;
  bookedSlotsCount: number;
  heldSlotsCount: number;
  slots: CapacitySlot[];
}

export class SlotMutexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlotMutexError';
  }
}

export const BYREUM_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2';

interface SlotMutexLock {
  holderId: string;
  expiresAt: number;
}

export class AvailabilitySourceService {
  private static mutexLocks = new Map<string, SlotMutexLock>();

  private static mockProviderSlots: CapacitySlot[] = [];

  public static resetStateForTesting(): void {
    this.mutexLocks.clear();
    this.mockProviderSlots = [];
  }

  private static ensureWorkspaceSlots(workspaceId: string): CapacitySlot[] {
    if (!isMarketingFixtureWorkspace(workspaceId)) throw new CapacityNotObservedError();
    let slots = this.mockProviderSlots.filter(s => s.workspaceId === workspaceId);
    if (slots.length === 0) {
      slots = SAMPLE_CAPACITY_SLOTS.map((slot, index) => ({
        ...slot, workspaceId, id: `${workspaceId}:slot:${index}`,
      }));
      this.mockProviderSlots.push(...slots);
    }
    return slots;
  }

  static getSnapshot(workspaceId: string): CapacitySnapshot {
    const slots = this.ensureWorkspaceSlots(workspaceId);
    const available = slots.filter(s => s.status === 'AVAILABLE').length;
    const booked = slots.filter(s => s.status === 'BOOKED').length;
    const held = slots.filter(s => s.status === 'HELD').length;

    return {
      id: `snap_${Date.now()}`,
      workspaceId,
      sourceProvider: 'fixture',
      sourceVersion: 'fixture-v1',
      observedAt: '2026-08-01T00:00:00Z',
      totalSlotsCount: slots.length,
      availableSlotsCount: available,
      bookedSlotsCount: booked,
      heldSlotsCount: held,
      slots: structuredClone(slots),
    };
  }

  static getAvailableSlots(workspaceId: string, serviceId?: string): CapacitySlot[] {
    const slots = this.ensureWorkspaceSlots(workspaceId);
    return slots.filter(
      s => s.status === 'AVAILABLE' && (!serviceId || s.serviceId === serviceId)
    ).map(s => ({ ...s }));
  }

  /**
   * Concurrency Mutex Lock for Slot Holding
   */
  static acquireSlotHoldMutex(
    workspaceId: string,
    slotId: string,
    holderId: string,
    durationMinutes: number = 15
  ): CapacitySlot {
    this.ensureWorkspaceSlots(workspaceId);
    const lockKey = `${workspaceId}:${slotId}`;
    const now = Date.now();
    const existingLock = this.mutexLocks.get(lockKey);

    if (existingLock && existingLock.expiresAt > now && existingLock.holderId !== holderId) {
      throw new SlotMutexError(
        `[SLOT_MUTEX_LOCKED] Slot '${slotId}' is already held by holder '${existingLock.holderId}'`
      );
    }

    const slot = this.mockProviderSlots.find(s => s.workspaceId === workspaceId && s.id === slotId);
    if (!slot) {
      throw new Error(`[SLOT_NOT_FOUND] Slot '${slotId}' not found in workspace '${workspaceId}'`);
    }

    if (slot.status === 'BOOKED') {
      throw new Error(`[SLOT_ALREADY_RESERVED] Slot '${slotId}' is already booked`);
    }

    if (slot.status === 'HELD' && slot.holdExpiresAt && new Date(slot.holdExpiresAt).getTime() > now) {
      if (existingLock && existingLock.holderId !== holderId) {
        throw new SlotMutexError(`[SLOT_ALREADY_HELD] Slot '${slotId}' is held by another customer`);
      }
    }

    // Acquire lock
    const expiresAt = now + durationMinutes * 60 * 1000;
    this.mutexLocks.set(lockKey, { holderId, expiresAt });

    slot.status = 'HELD';
    slot.holdExpiresAt = new Date(expiresAt).toISOString();
    slot.observedAt = new Date().toISOString();
    return slot;
  }

  static releaseSlotHoldMutex(
    workspaceId: string,
    slotId: string,
    holderId: string
  ): CapacitySlot | null {
    this.ensureWorkspaceSlots(workspaceId);
    const lockKey = `${workspaceId}:${slotId}`;
    const existingLock = this.mutexLocks.get(lockKey);

    if (existingLock && existingLock.holderId === holderId) {
      this.mutexLocks.delete(lockKey);
    }

    const slot = this.mockProviderSlots.find(s => s.workspaceId === workspaceId && s.id === slotId);
    if (!slot) return null;

    if (slot.status === 'HELD') {
      slot.status = 'AVAILABLE';
      slot.holdExpiresAt = undefined;
      slot.observedAt = new Date().toISOString();
    }
    return slot;
  }

  static holdSlot(slotId: string, durationMinutes: number = 15, workspaceId?: string): CapacitySlot | null {
    if (!workspaceId) return null;
    this.ensureWorkspaceSlots(workspaceId);
    const slot = this.mockProviderSlots.find(s => s.workspaceId === workspaceId && s.id === slotId);
    if (!slot || slot.status !== 'AVAILABLE') return null;

    slot.status = 'HELD';
    slot.holdExpiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
    slot.observedAt = new Date().toISOString();
    return slot;
  }

  static markSlotBooked(slotId: string, workspaceId?: string): CapacitySlot | null {
    if (!workspaceId) return null;
    this.ensureWorkspaceSlots(workspaceId);
    const slot = this.mockProviderSlots.find(s => s.workspaceId === workspaceId && s.id === slotId);
    if (!slot) return null;

    slot.status = 'BOOKED';
    slot.observedAt = new Date().toISOString();
    return slot;
  }

  static releaseSlot(slotId: string, workspaceId?: string): CapacitySlot | null {
    if (!workspaceId) return null;
    this.ensureWorkspaceSlots(workspaceId);
    const slot = this.mockProviderSlots.find(s => s.workspaceId === workspaceId && s.id === slotId);
    if (!slot) return null;

    slot.status = 'AVAILABLE';
    slot.holdExpiresAt = undefined;
    slot.observedAt = new Date().toISOString();
    return slot;
  }
}
