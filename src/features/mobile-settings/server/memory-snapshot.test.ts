// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildMemorySnapshot,
  isMemoryApiSnapshot,
  memoryKindOf,
  type MemoryFactRow,
  type MemoryProposalRow,
} from './memory-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-24T05:00:00.000Z'

const ok = <T,>(value: T) => ({ ok: true, value })
const failed = <T,>() => ({ ok: false, value: null as T | null })

const proposal = (o: Partial<MemoryProposalRow> = {}): MemoryProposalRow => ({
  id: 'p-1',
  category: '가격',
  content: '커트 35,000원',
  createdAt: '2026-10-22T01:00:00.000Z',
  sourceMessageId: 'm-1',
  ...o,
})

const fact = (o: Partial<MemoryFactRow> = {}): MemoryFactRow => ({
  id: 'f-1',
  category: '가격',
  content: '커트 30,000원',
  approvedAt: '2026-09-01T00:00:00.000Z',
  ...o,
})

function input(overrides: Partial<Parameters<typeof buildMemorySnapshot>[0]> = {}) {
  return {
    workspaceId: WS,
    now: NOW,
    proposals: ok([proposal()]),
    facts: ok([fact()]),
    ...overrides,
  }
}

describe('가게 기억(M22) 스냅샷 조립', () => {
  it('확인 대기 제안을 후보로 만들고 같은 분류의 확정값을 "지금" 값으로 붙인다', () => {
    const snap = buildMemorySnapshot(input())

    expect(snap.loadState).toBe('ready')
    expect(snap.complete).toBe(true)
    expect(snap.checkedAt).toBe(NOW)
    expect(snap.workspaceId).toBe(WS)
    expect(snap.candidates).toHaveLength(1)
    expect(snap.candidates[0]).toMatchObject({
      key: 'price:가격',
      kind: 'price',
      proposalId: 'p-1',
      proposedValue: '커트 35,000원',
      currentValue: '커트 30,000원',
      origin: 'owner_stated',
      customerVisible: true,
    })
    expect(snap.candidates[0].source).toEqual({
      label: '소희와의 대화',
      href: null,
      observedAt: '2026-10-22T01:00:00.000Z',
    })
  })

  it('출처 대화가 없는 제안은 소희 추측으로 두고 고객 안내에 쓰지 않는다', () => {
    const snap = buildMemorySnapshot(input({
      proposals: ok([proposal({ sourceMessageId: null })]),
      facts: ok([]),
    }))

    expect(snap.candidates[0]).toMatchObject({
      origin: 'sohee_inferred',
      source: null,
      currentValue: null,
      customerVisible: false,
    })
  })

  it('확정값이 없으면 currentValue 를 null 로 두고 값을 지어내지 않는다', () => {
    const snap = buildMemorySnapshot(input({ facts: ok([]) }))
    expect(snap.candidates[0].currentValue).toBeNull()
  })

  it('같은 분류의 확정값이 여럿이면 가장 최근 승인된 값만 쓴다', () => {
    const snap = buildMemorySnapshot(input({
      facts: ok([
        fact({ id: 'f-old', content: '예전 값', approvedAt: '2026-08-01T00:00:00.000Z' }),
        fact({ id: 'f-new', content: '최근 값', approvedAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    }))
    expect(snap.candidates[0].currentValue).toBe('최근 값')
  })

  it('같은 분류의 제안이 여럿이면 최신 제안 한 줄만 남긴다', () => {
    const snap = buildMemorySnapshot(input({
      proposals: ok([
        proposal({ id: 'p-old', content: '예전 제안', createdAt: '2026-10-01T00:00:00.000Z' }),
        proposal({ id: 'p-new', content: '최신 제안', createdAt: '2026-10-20T00:00:00.000Z' }),
      ]),
    }))
    expect(snap.candidates).toHaveLength(1)
    expect(snap.candidates[0].proposalId).toBe('p-new')
    expect(snap.candidates[0].proposedValue).toBe('최신 제안')
  })

  it('띄어쓰기·대소문자만 다른 분류도 같은 항목으로 묶는다', () => {
    const snap = buildMemorySnapshot(input({
      proposals: ok([proposal({ category: '영업 시간' })]),
      facts: ok([fact({ category: '영업시간', content: '평일 10:00–20:00' })]),
    }))
    expect(snap.candidates[0].kind).toBe('hours')
    expect(snap.candidates[0].currentValue).toBe('평일 10:00–20:00')
  })

  it('확정 지식을 못 읽으면 후보를 만들지 않는다 — currentValue=null 을 "기억 없음"으로 표시하지 않기 위해', () => {
    const snap = buildMemorySnapshot(input({ facts: failed() }))

    expect(snap.loadState).toBe('ready')
    expect(snap.complete).toBe(false)
    expect(snap.candidates).toEqual([])
    expect(snap.checkedAt).toBe(NOW)
  })

  it('제안을 못 읽어도 후보를 만들지 않고 partial 로 남긴다', () => {
    const snap = buildMemorySnapshot(input({ proposals: failed() }))

    expect(snap.complete).toBe(false)
    expect(snap.candidates).toEqual([])
  })

  it('두 원천이 모두 실패하면 error 이고 확인 시각은 없다', () => {
    const snap = buildMemorySnapshot(input({ proposals: failed(), facts: failed() }))

    expect(snap.loadState).toBe('error')
    expect(snap.complete).toBe(false)
    expect(snap.checkedAt).toBeNull()
    expect(snap.candidates).toEqual([])
  })

  it('형식이 깨진 제안 줄은 버리고 완전하지 않다고 알린다', () => {
    const snap = buildMemorySnapshot(input({
      proposals: ok([proposal(), proposal({ id: 'p-bad', content: '   ' })]),
    }))

    expect(snap.candidates).toHaveLength(1)
    expect(snap.complete).toBe(false)
  })
})

describe('분류 → 화면 라벨', () => {
  it('확실한 낱말이 있을 때만 좁히고 애매하면 가게 정보로 남긴다', () => {
    expect(memoryKindOf('가격표')).toBe('price')
    expect(memoryKindOf('영업시간')).toBe('hours')
    expect(memoryKindOf('취소 규정')).toBe('policy')
    expect(memoryKindOf('대표 시술')).toBe('service')
    expect(memoryKindOf('브랜드 소개')).toBe('other')
  })
})

describe('isMemoryApiSnapshot', () => {
  it('다른 가게 스냅샷·형식 불일치는 거부한다', () => {
    const snap = buildMemorySnapshot(input())
    expect(isMemoryApiSnapshot(snap, WS)).toBe(true)
    expect(isMemoryApiSnapshot(snap, 'other')).toBe(false)
    expect(isMemoryApiSnapshot({ ...snap, candidates: null }, WS)).toBe(false)
    expect(isMemoryApiSnapshot(null, WS)).toBe(false)
  })
})
