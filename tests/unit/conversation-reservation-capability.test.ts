import { describe, expect, it } from 'vitest'
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry'

describe('authoritative reservation capability contract', () => {
  it('does not advertise customer summaries as a booking or payment ledger', () => {
    const customer = SOHEE_CAPABILITY_REGISTRY['customer.search']
    expect(customer.name).not.toContain('예약 장부')
    expect(customer.description).toContain('예약·수납은 관측하지 않습니다')
    expect(SOHEE_CAPABILITY_REGISTRY['reservation.list'].description).toContain('예약 장부')
  })
})
