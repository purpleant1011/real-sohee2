import { describe, expect, it } from 'vitest'
import { usableMemory, type MemoryItem } from './credit-model'
import {
  applyApproval,
  classifyMemory,
  memoryPreview,
  memoryReadiness,
  type MemoryCandidate,
} from './memory-approval'

const candidate = (o: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  key: 'price:ext',
  kind: 'price',
  proposalId: 'mp1',
  proposedValue: '속눈썹 연장 5만원',
  currentValue: null,
  origin: 'owner_stated',
  source: { label: '사장님 카카오톡', href: null, observedAt: '2026-10-22T09:00:00Z' },
  customerVisible: true,
  ...o,
})

const approved = (o: Partial<MemoryItem> = {}): MemoryItem => ({
  key: 'price:ext', value: '속눈썹 연장 4만원', state: 'confirmed', approvedAt: '2026-10-01T00:00:00Z', ...o,
})

describe('기억 종류 구분', () => {
  it('기존 값과 다르면 변경 제안', () => {
    expect(classifyMemory(candidate({ currentValue: '속눈썹 연장 4만원' }))).toBe('change_proposal')
  })
  it('출처 없는 소희 값은 추측', () => {
    expect(classifyMemory(candidate({ origin: 'sohee_inferred', source: null }))).toBe('inferred')
  })
  it('사장님이 말한 값은 확정', () => {
    expect(classifyMemory(candidate())).toBe('confirmed')
  })
})

describe('승인 준비', () => {
  it('출처가 없으면 승인 불가', () => {
    const r = memoryReadiness(candidate({ source: null }))
    expect(r.allowed).toBe(false)
    expect(r.blockers.map(b => b.code)).toContain('missing_source')
  })

  it('추측을 고객 노출 값으로 승인할 수 없다', () => {
    const r = memoryReadiness(candidate({ origin: 'sohee_inferred', source: { label: '사진', href: null, observedAt: '2026-10-22T09:00:00Z' } }))
    expect(r.allowed).toBe(false)
    expect(r.blockers.map(b => b.code)).toContain('inferred_not_customer_visible')
  })

  it('가격이 상충하면 재확인 전에는 승인 불가', () => {
    const change = candidate({ currentValue: '속눈썹 연장 4만원' })
    expect(memoryReadiness(change).requiresReconfirm).toBe(true)
    expect(memoryReadiness(change).allowed).toBe(false)
    expect(memoryReadiness(change, { reconfirmed: true }).allowed).toBe(true)
  })

  it('내부 전용 추측은 고객 노출만 끄면 저장 가능', () => {
    const r = memoryReadiness(candidate({ origin: 'sohee_inferred', customerVisible: false }))
    expect(r.allowed).toBe(true)
  })
})

describe('승인 화면 문구', () => {
  it('출처·업데이트 시각·가격 영향 안내를 함께 준다', () => {
    const preview = memoryPreview(candidate({ currentValue: '속눈썹 연장 4만원' }))
    expect(preview.kindLabel).toBe('변경 제안')
    expect(preview.sourceLabel).toBe('사장님 카카오톡')
    expect(preview.observedAt).toBe('2026-10-22T09:00:00Z')
    expect(preview.impactNote).toContain('가격')
  })
})

describe('승인 반영', () => {
  it('승인 전 제안은 사용 가능한 기억이 아니다', () => {
    const items: MemoryItem[] = [approved({ key: 'price:ext', value: '4만원' }), { key: 'price:new', value: '5만원', state: 'suggested', approvedAt: null }]
    expect(usableMemory(items).map(i => i.key)).toEqual(['price:ext'])
  })

  it('승인하면 확정되고 이전 값이 대체됐음을 돌려준다', () => {
    const at = '2026-10-22T10:00:00Z'
    const { applied, items, superseded } = applyApproval([approved()], candidate({ currentValue: '속눈썹 연장 4만원' }), at)
    expect(applied).toBe(true)
    expect(superseded).toEqual({ key: 'price:ext', previousValue: '속눈썹 연장 4만원' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'price:ext', value: '속눈썹 연장 5만원', state: 'confirmed', approvedAt: at })
    expect(usableMemory(items)).toHaveLength(1)
  })

  it('같은 값 재승인은 대체 이력이 없다', () => {
    expect(applyApproval([approved({ value: '속눈썹 연장 5만원' })], candidate(), '2026-10-22T10:00:00Z').superseded).toBeNull()
  })
})

describe('확인 불가 값은 확정 기억이 되지 않는다', () => {
  const at = '2026-10-22T10:00:00Z'

  it('빈 값은 반영하지 않고 기존 기억을 그대로 둔다', () => {
    const before: MemoryItem[] = [approved()]
    const result = applyApproval(before, candidate({ proposedValue: '   ' }), at)

    expect(result.applied).toBe(false)
    expect(result.items).toEqual(before)
    expect(result.blockers.map(b => b.code)).toContain('empty_value')
    expect(usableMemory(result.items)).toHaveLength(1)
  })

  it('출처를 확인하지 못한 값은 확정 기억으로 저장되지 않는다', () => {
    const result = applyApproval([], candidate({ key: 'price:new', source: null }), at)

    expect(result.applied).toBe(false)
    expect(result.items).toEqual([])
    expect(result.blockers.map(b => b.code)).toContain('missing_source')
    expect(usableMemory(result.items)).toHaveLength(0)
  })

  it('소희 추측을 고객 노출 값으로 확정할 수 없다', () => {
    const result = applyApproval([], candidate({
      key: 'price:guess', origin: 'sohee_inferred', customerVisible: true,
      source: { label: '사진', href: null, observedAt: '2026-10-22T09:00:00Z' },
    }), at)

    expect(result.applied).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('inferred_not_customer_visible')
    expect(usableMemory(result.items)).toHaveLength(0)
  })

  it('확인된 값은 그대로 반영한다(회귀)', () => {
    const result = applyApproval([], candidate({ key: 'service:cut', currentValue: null }), at)

    expect(result.applied).toBe(true)
    expect(result.blockers).toEqual([])
    expect(usableMemory(result.items).map(i => i.key)).toEqual(['service:cut'])
  })
})
