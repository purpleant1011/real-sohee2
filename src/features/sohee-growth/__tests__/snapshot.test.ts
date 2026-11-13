import { describe, expect, it } from 'vitest'
import { buildGrowthSnapshot } from '../snapshot'
import { EMPTY, FULL, PARTIAL } from './fixtures'

const NOW = new Date('2026-10-09T01:00:00.000Z')

describe('buildGrowthSnapshot', () => {
  it('PARTIAL 예시의 전체 스냅샷', () => {
    const snap = buildGrowthSnapshot(PARTIAL, NOW)
    expect(snap.completenessPercent).toBe(42)
    expect(snap.level).toMatchObject({ level: 1, name: '신입' })
    expect(snap.nextStep).toEqual({ requirementKey: 'image_style', title: '이미지 스타일 정하기', destination: 'work' })
    expect(snap.counts).toEqual({ facts: 3, sources: 0 })
    expect(snap.tier).toBe('FORMAL')
    expect(snap.generatedAt).toBe('2026-10-09T01:00:00.000Z')
    expect(snap.categories).toHaveLength(6)
    expect(snap.requirements).toHaveLength(9)
    expect(snap.jobs).toHaveLength(6)
  })

  it('아무것도 없으면 0%, 입사 준비, 다음 할 일은 가게 정보', () => {
    const snap = buildGrowthSnapshot(EMPTY, NOW)
    expect(snap.completenessPercent).toBe(0)
    expect(snap.level.level).toBe(0)
    expect(snap.nextStep?.requirementKey).toBe('shop_basic')
  })

  it('모두 채우면 100%, 다음 할 일 없음', () => {
    const snap = buildGrowthSnapshot(FULL, NOW)
    expect(snap.completenessPercent).toBe(100)
    expect(snap.nextStep).toBeNull()
  })
})
