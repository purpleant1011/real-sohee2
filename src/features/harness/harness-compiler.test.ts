import { describe, it, expect } from 'vitest'
import { harnessCompiler } from './harness-compiler'
import { crossChannelAdapter } from './cross-channel-adapter'

describe('HarnessCompiler & CrossChannelAdapter (v1.1)', () => {
  it('AC-03 & AC-18: Compiles 5 distinct modules and assigns 5-state Evidence labels', () => {
    const compiled = harnessCompiler.compile({
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      captions: ['출근길 눈썹 씨름 고민', '1:1 골격 맞춤 시술 후기'],
      commentSamples: ['가격 문의드려요', '예약 가능한가요?']
    })

    expect(compiled.textJson).toBeDefined()
    expect(compiled.visualJson).toBeDefined()
    expect(compiled.operationsJson).toBeDefined()
    expect(compiled.communityJson).toBeDefined()
    expect(compiled.platformJson).toBeDefined()

    expect(compiled.rules.length).toBeGreaterThanOrEqual(4)

    // AC-19: Tone vector must be RECOMMENDED_DEFAULT, not OBSERVED
    const toneRule = compiled.rules.find(r => r.ruleKey === 'tone_vector')
    expect(toneRule?.evidenceState).toBe('RECOMMENDED_DEFAULT')

    const hookRule = compiled.rules.find(r => r.ruleKey === 'hook_style')
    expect(hookRule?.evidenceState).toBe('OBSERVED')
    expect(hookRule?.supportingSampleCount).toBe(2)
  })

  it('AC-10: CrossChannelAdapter adapts Instagram DNA into Threads and Naver Blog structures', () => {
    const compiled = harnessCompiler.compile({
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      captions: ['출근길 눈썹 씨름 고민']
    })

    // 1. Threads
    const threadsOutput = crossChannelAdapter.adapt({
      targetPlatform: 'threads',
      textHarness: compiled.textJson,
      brandName: '바이름 청라점',
      location: '인천 청라',
      topic: '퍼스널 눈썹 디자인'
    })
    expect(threadsOutput.platform).toBe('threads')
    expect(threadsOutput.body).toContain('댓글로 편하게 알려주세요')

    // 2. Naver Blog (H2/H3 Structured)
    const blogOutput = crossChannelAdapter.adapt({
      targetPlatform: 'naver_blog',
      textHarness: compiled.textJson,
      brandName: '바이름 청라점',
      location: '인천 청라',
      topic: '퍼스널 눈썹 디자인',
      currentPromo: '화/수 첫 방문 15% 할인'
    })
    expect(blogOutput.platform).toBe('naver_blog')
    expect(blogOutput.title).toContain('인천 청라')
    expect(blogOutput.headings?.length).toBe(3)
    expect(blogOutput.body).toContain('15% 할인')
  })
})
