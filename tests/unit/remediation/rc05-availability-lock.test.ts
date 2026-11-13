import { describe, it, expect, beforeEach } from 'vitest'
import {
  AvailabilitySourceService,
} from '@/features/marketing-agent/engine/capacity-source'

describe('[RC-05][Regression] Booking State Machine & Real-Time Availability Mutex (ANI-1330)', () => {
  const byreumWorkspaceId = 'fixture:TEST:marketing'

  beforeEach(() => {
    AvailabilitySourceService.resetStateForTesting()
  })

  describe('1. Byreum Real-Time Availability Scoping', () => {
    it('real shop UUID cannot inherit sample capacity', () => {
      expect(() => AvailabilitySourceService.getAvailableSlots('00000000-0000-4000-8000-0000000000a2')).toThrow(/NOT_OBSERVED/)
      const snapshot = AvailabilitySourceService.getSnapshot(byreumWorkspaceId)
      expect(snapshot.sourceProvider).toBe('fixture')
      expect(snapshot.slots.every(slot => slot.workspaceId === byreumWorkspaceId)).toBe(true)
    })
  })

  describe('2. Slot Concurrency Mutex Lock Guard', () => {
    it('enforces atomic mutex lock on concurrent slot hold and rejects colliding hold', () => {
      const slots = AvailabilitySourceService.getAvailableSlots(byreumWorkspaceId)
      const targetSlotId = slots[0].id

      // Customer A acquires slot mutex lock
      const holdA = AvailabilitySourceService.acquireSlotHoldMutex(
        byreumWorkspaceId,
        targetSlotId,
        'cust-A-777',
        15
      )
      expect(holdA).not.toBeNull()
      expect(holdA?.status).toBe('HELD')

      // Customer B attempts to acquire mutex on the same slot
      expect(() => {
        AvailabilitySourceService.acquireSlotHoldMutex(
          byreumWorkspaceId,
          targetSlotId,
          'cust-B-888',
          15
        )
      }).toThrow(/SLOT_MUTEX_LOCKED|SLOT_ALREADY_HELD/)

      // After release, new customer can acquire
      AvailabilitySourceService.releaseSlotHoldMutex(byreumWorkspaceId, targetSlotId, 'cust-A-777')

      const holdC = AvailabilitySourceService.acquireSlotHoldMutex(
        byreumWorkspaceId,
        targetSlotId,
        'cust-C-999',
        15
      )
      expect(holdC).not.toBeNull()
      expect(holdC?.status).toBe('HELD')
    })
  })
})
