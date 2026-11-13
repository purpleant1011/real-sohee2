import { describe, it, expect } from 'vitest'
import { OFFICIAL_CHANNELS } from '../channel-registry'

describe('Channel Registry Policy & Copy Audit', () => {
  it('does not contain automated publishing claims for Naver Blog or Daangn', () => {
    const naver = OFFICIAL_CHANNELS.NAVER_BLOG
    expect(naver.description).not.toContain('스마트에디터 자동 발행')
    expect(naver.description).toContain('원고 준비')

    const daangn = OFFICIAL_CHANNELS.DAANGN
    expect(daangn.description).not.toContain('자율 응대')
    expect(daangn.description).toContain('원고 준비')

    const insta = OFFICIAL_CHANNELS.INSTAGRAM
    expect(insta.description).not.toContain('자율 응대')
  })
})
