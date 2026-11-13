import { describe, expect, it } from 'vitest'
import { resolveWritingStyle } from './resolve-writing-style'

describe('resolveWritingStyle', () => {
  it('combines brandVoice summary and toneAndManner style guide without losing 1200 chars instructions', () => {
    const brandVoice = '차분하고 정중한 어조로 고객에게 신뢰를 주는 목소리입니다.'
    const toneAndManner = ('1. 첫 문장은 계절감 있는 인사로 시작합니다.\n' + '2. 상세 설명은 다음과 같습니다. '.repeat(60)).trim()
    expect(toneAndManner.length).toBeGreaterThan(1000)

    const resolved = resolveWritingStyle({ brandVoice, toneAndManner })

    expect(resolved).toContain(brandVoice)
    expect(resolved).toContain(toneAndManner)
    expect(resolved).toContain('[글 구조·말투 지시]')
    expect(resolved.length).toBeGreaterThan(1100)
  })

  it('accepts wrapped structured_rule or structuredRule property', () => {
    const res1 = resolveWritingStyle({ structured_rule: { brandVoice: '보이스 A', toneAndManner: '지시문 A' } })
    expect(res1).toContain('보이스 A')
    expect(res1).toContain('지시문 A')

    const res2 = resolveWritingStyle({ structuredRule: { brandVoice: '보이스 B', toneAndManner: '지시문 B' } })
    expect(res2).toContain('보이스 B')
    expect(res2).toContain('지시문 B')
  })

  it('is valid when only toneAndManner exists without brandVoice', () => {
    const toneAndManner = '친근하고 발랄한 이모지와 함께 핵심만 짧게 전달하는 지침'
    const resolved = resolveWritingStyle({ toneAndManner })
    expect(resolved).toBe(toneAndManner)
  })

  it('is valid when only brandVoice exists without toneAndManner', () => {
    const brandVoice = '따뜻하고 정갈한 어조'
    const resolved = resolveWritingStyle({ brandVoice })
    expect(resolved).toBe(brandVoice)
  })

  it('preserves existing knowledge fallback when rule has no style', () => {
    expect(resolveWritingStyle(null, '기존 지식 보이스')).toBe('기존 지식 보이스')
    expect(resolveWritingStyle({}, { brandVoice: '지식 객체 보이스' })).toBe('지식 객체 보이스')
    expect(resolveWritingStyle({ brandVoice: '', toneAndManner: '   ' }, { text: '지식 텍스트 보이스' })).toBe('지식 텍스트 보이스')
    expect(resolveWritingStyle(undefined, undefined)).toBe('')
  })

  it('enforces 2000 chars upper bound safely slicing excess DB content', () => {
    const brandVoice = 'A'.repeat(500)
    const toneAndManner = 'B'.repeat(1800)
    const resolved = resolveWritingStyle({ brandVoice, toneAndManner })
    expect(resolved.length).toBe(2000)
  })

  it('safely handles non-string unknown inputs and trims control characters while keeping newlines', () => {
    const dirty = '\u0000차분한 목소리\r\n다음 줄 지시문\u0007   '
    const resolved = resolveWritingStyle({ brandVoice: dirty })
    expect(resolved).toBe('차분한 목소리\r\n다음 줄 지시문')
    expect(resolveWritingStyle(12345 as unknown)).toBe('')
  })
})
