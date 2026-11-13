import { describe, expect, it } from 'vitest'
import { calculatePlaceHealth, proposePlaceChanges, type PlaceProfileSnapshot } from './profile-health'

const snapshot: PlaceProfileSnapshot = {
  targetExternalId: 'place-123',
  targetLabel: '소희 뷰티 성수점',
  lastVerifiedAt: '2026-08-19T01:00:00.000Z',
  name: '소희 뷰티 성수점', category: '피부 관리', phone: null, address: '서울 성동구 성수동',
  introduction: null, keywords: [], hours: null, holidays: null, breakTime: null, facilities: [],
  parking: null, paymentMethods: [], services: [], menus: [], prices: [], photos: [], website: null,
  socialLinks: [], news: [],
}

describe('Naver Place profile health', () => {
  it('marks missing hours and services as actionable without inventing values', () => {
    const health = calculatePlaceHealth(snapshot)

    expect(health.items).toContainEqual(expect.objectContaining({ field: 'hours', state: 'missing' }))
    expect(health.items).toContainEqual(expect.objectContaining({ field: 'services', state: 'missing' }))
    expect(health.proposedValues).toEqual([])
  })

  it('only turns exact user-approved facts into a proposal when the before value still matches', () => {
    expect(proposePlaceChanges(snapshot, [{
      field: 'hours', before: '월-금 10:00-19:00', after: '월-금 10:00-20:00', reason: '영업시간을 명확하게 표시',
    }])).toEqual([])

    expect(proposePlaceChanges({ ...snapshot, hours: '월-금 10:00-19:00' }, [{
      field: 'hours', before: '월-금 10:00-19:00', after: '월-금 10:00-20:00', reason: '영업시간을 명확하게 표시',
    }])).toEqual([expect.objectContaining({ field: 'hours', before: '월-금 10:00-19:00', after: '월-금 10:00-20:00' })])
  })
})
