import { describe, expect, it } from 'vitest'
import {
  catalogServiceCreateSchema,
  catalogServiceUpdateSchema,
  bookingReadiness,
  type CatalogServiceRecord,
} from './schema'

const base = { name: '속눈썹 연장' }

describe('catalogServiceCreateSchema (ANI-1609)', () => {
  it('이름만 있으면 통과하고 비어 있는 값은 null로 남긴다 — 임의로 채우지 않는다', () => {
    const parsed = catalogServiceCreateSchema.parse(base)
    expect(parsed).toMatchObject({
      name: '속눈썹 연장', price: null, durationMinutes: null, resourceName: null,
      cancellationPolicy: null, validFrom: null, validUntil: null, active: true,
    })
  })

  it.each([1, 90, 1440])('소요시간 %i분은 허용한다', (durationMinutes) => {
    expect(catalogServiceCreateSchema.safeParse({ ...base, durationMinutes }).success).toBe(true)
  })

  it.each([0, -5, 1441, 1.5, Number.NaN, '60', true])('소요시간 %s는 거부한다', (durationMinutes) => {
    expect(catalogServiceCreateSchema.safeParse({ ...base, durationMinutes }).success).toBe(false)
  })

  it.each([-1, 0.5, 1e12, '1000'])('가격 %s는 거부한다', (price) => {
    expect(catalogServiceCreateSchema.safeParse({ ...base, price }).success).toBe(false)
  })

  it('가격 0원과 정수 가격은 허용한다', () => {
    expect(catalogServiceCreateSchema.safeParse({ ...base, price: 0 }).success).toBe(true)
    expect(catalogServiceCreateSchema.safeParse({ ...base, price: 80000 }).success).toBe(true)
  })

  it('빈 이름·공백 이름·너무 긴 이름은 거부한다', () => {
    expect(catalogServiceCreateSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(catalogServiceCreateSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })

  it('이름 앞뒤 공백은 제거하고 빈 문자열 선택 항목은 null로 정리한다', () => {
    const parsed = catalogServiceCreateSchema.parse({ name: '  컷  ', resourceName: '  ', cancellationPolicy: '' })
    expect(parsed.name).toBe('컷')
    expect(parsed.resourceName).toBeNull()
    expect(parsed.cancellationPolicy).toBeNull()
  })

  it('유효기간 종료는 시작보다 뒤여야 하고 시간대 없는 날짜는 거부한다', () => {
    expect(catalogServiceCreateSchema.safeParse({
      ...base, validFrom: '2026-11-01T00:00:00+09:00', validUntil: '2026-10-01T00:00:00+09:00',
    }).success).toBe(false)
    expect(catalogServiceCreateSchema.safeParse({ ...base, validFrom: '2026-11-01' }).success).toBe(false)
    expect(catalogServiceCreateSchema.safeParse({
      ...base, validFrom: '2026-11-01T00:00:00+09:00', validUntil: '2026-12-01T00:00:00+09:00',
    }).success).toBe(true)
  })

  it('알 수 없는 필드(workspaceId 등)는 거부한다 — 클라이언트가 테넌트를 지정할 수 없다', () => {
    expect(catalogServiceCreateSchema.safeParse({ ...base, workspaceId: 'x' }).success).toBe(false)
  })
})

describe('catalogServiceUpdateSchema', () => {
  it('expectedUpdatedAt이 없으면 거부한다(동시 수정 보호)', () => {
    expect(catalogServiceUpdateSchema.safeParse({ price: 1000 }).success).toBe(false)
  })

  it('변경 필드가 하나도 없으면 거부한다', () => {
    expect(catalogServiceUpdateSchema.safeParse({ expectedUpdatedAt: '2026-10-22T00:00:00.000Z' }).success).toBe(false)
  })

  it('일부 필드만 보내도 통과하고 null로 값을 비울 수 있다', () => {
    const parsed = catalogServiceUpdateSchema.parse({ expectedUpdatedAt: '2026-10-22T00:00:00.000Z', durationMinutes: null })
    expect(parsed.durationMinutes).toBeNull()
    expect('price' in parsed).toBe(false)
  })
})

describe('bookingReadiness', () => {
  const ready: CatalogServiceRecord = {
    id: 's1', workspaceId: 'w1', name: '컷', price: 30000, durationMinutes: 60, resourceName: null,
    cancellationPolicy: null, validFrom: null, validUntil: null, active: true,
    updatedAt: '2026-10-22T00:00:00.000Z', knowledgeFactId: null,
  }
  const now = '2026-10-22T09:00:00.000Z'

  it('가격·소요시간이 있고 활성이면 준비 완료', () => {
    expect(bookingReadiness(ready, now)).toEqual({ ready: true, missing: [] })
  })
  it('소요시간이 없으면 DURATION 누락을 알린다', () => {
    expect(bookingReadiness({ ...ready, durationMinutes: null }, now)).toEqual({ ready: false, missing: ['DURATION'] })
  })
  it('가격이 없으면 PRICE 누락', () => {
    expect(bookingReadiness({ ...ready, price: null }, now).missing).toEqual(['PRICE'])
  })
  it('비활성이면 INACTIVE', () => {
    expect(bookingReadiness({ ...ready, active: false }, now).missing).toEqual(['INACTIVE'])
  })
  it('유효기간 종료 후는 EXPIRED, 시작 전은 NOT_STARTED', () => {
    expect(bookingReadiness({ ...ready, validUntil: '2026-10-01T00:00:00.000Z' }, now).missing).toEqual(['EXPIRED'])
    expect(bookingReadiness({ ...ready, validFrom: '2026-11-01T00:00:00.000Z' }, now).missing).toEqual(['NOT_STARTED'])
  })
})
