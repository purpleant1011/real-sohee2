import { describe, expect, it } from 'vitest'
import { computeLevel } from '../level'
import { evaluateRequirements } from '../requirements'
import { EMPTY, FULL, PARTIAL } from './fixtures'

describe('computeLevel', () => {
  it('아무것도 못 채우면 입사 준비(0)', () => {
    const info = computeLevel(evaluateRequirements(EMPTY))
    expect(info).toMatchObject({ level: 0, name: '입사 준비', nextName: '신입' })
    expect(info.ladder.map((s) => s.state)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('1단계(신입)만 채우면 레벨 1', () => {
    const e = { ...EMPTY, profile: { ...EMPTY.profile, nameValid: true, industryValid: true, summaryValid: true, voiceValid: true } }
    expect(computeLevel(evaluateRequirements(e))).toMatchObject({ level: 1, name: '신입', nextName: '사원' })
  })

  it('이미지 기준이 빠져 2단계를 못 채운 PARTIAL 은 레벨 1', () => {
    const info = computeLevel(evaluateRequirements(PARTIAL))
    expect(info.level).toBe(1)
    expect(info.ladder.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('앞 단계를 못 채우면 뒤 단계를 채워도 올라가지 않는다 (연속 충족)', () => {
    const onlyFaq = { ...EMPTY, factCounts: { FAQ: 5 } }
    expect(computeLevel(evaluateRequirements(onlyFaq)).level).toBe(0)
  })

  it('모두 채우면 레벨 4(대리)이고 상담원은 예정으로 남는다', () => {
    const info = computeLevel(evaluateRequirements(FULL))
    expect(info).toMatchObject({ level: 4, name: '대리', nextName: '상담원' })
    expect(info.ladder.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'upcoming'])
    expect(info.ladder[4]).toMatchObject({ name: '상담원', soon: true })
  })

  it('사다리 이름은 신입·사원·주임·대리·상담원', () => {
    expect(computeLevel(evaluateRequirements(EMPTY)).ladder.map((s) => s.name)).toEqual(['신입', '사원', '주임', '대리', '상담원'])
  })
})
