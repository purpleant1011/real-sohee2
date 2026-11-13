import { describe, expect, it } from 'vitest'
import { classifyAcceptance } from '../../src/features/booking-recovery/inbound-projector'

// Cross-window regression: the W4/W5 implementation owns this behavior.
// An unmerged fix must not turn this branch's failure into a claimed PASS.
describe('G093-07 explicit customer acceptance of the exact proposed slot', () => {
  it('does not treat a request for 15:00 as acceptance of the only offered 14:00 slot', () => {
    const result = classifyAcceptance({
      message: {
        id: 'fixture-message', customerRef: 'fixture-customer', senderType: 'customer',
        text: '15시로 예약할게요', sentAt: '2026-10-22T10:01:00+09:00',
      },
      proposal: {
        customerRef: 'fixture-customer', sentAt: '2026-10-22T10:00:00+09:00', serviceName: 'fixture-service',
        slots: [{ id: 'fixture-slot-14', label: '10월 23일 14시', startsAt: '2026-10-23T14:00:00+09:00' }],
      },
    })
    expect(result.kind).toBe('needs_review')
  })
})
