import { describe, expect, it } from 'vitest'
import { GoldenRecallService } from './golden-recall-service'

describe('legacy recall path fails closed without visit and consent evidence', () => {
  it('does not invent a customer when the business has none', () => {
    expect(GoldenRecallService.findRecallCandidates([])).toEqual([])
  })
  it('does not infer a visit from reservation creation or confirmation', () => {
    expect(GoldenRecallService.findRecallCandidates([{
      id: 'reservation-fixture', customer_name: '테스트 고객', service_name: '서비스',
      created_at: '2026-09-01T00:00:00Z', confirmed_at: '2026-09-01T00:00:00Z',
    }])).toEqual([])
  })
  it('cannot create an addressable marketing draft from a phone alone', () => {
    expect(GoldenRecallService.findRecallCandidates([{ id: 'fixture', phone: 'fixture-phone' }])).toEqual([])
  })
})
