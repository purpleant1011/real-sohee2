import { describe, expect, it } from 'vitest'
import { generateCommentToneOptions } from './comment-tones'

describe('generateCommentToneOptions', () => {
  it('generates 3 distinct tone options (witty, polite, friendly) with non-empty text', () => {
    const options = generateCommentToneOptions({
      commentText: '샵 사진 너무 좋아서 힐링되는 것 같네요!',
      authorHandle: 'vesta_beautyapp',
      baseDraftText: '반가워요 vesta님! 힐링되셨다니 저희가 더 힘이 나네요 🌿 청라 오실 일 있으시면 편하게 들러주세요! 좋은 하루 보내세요 ✨',
      businessName: '바이름',
    })

    expect(options).toHaveLength(3)
    const keys = options.map((o) => o.key)
    expect(keys).toEqual(['witty', 'polite', 'friendly'])

    for (const opt of options) {
      expect(opt.label).toBeTruthy()
      expect(opt.text.trim().length).toBeGreaterThan(10)
    }

    // Tones should be meaningfully different
    const witty = options.find((o) => o.key === 'witty')!
    const polite = options.find((o) => o.key === 'polite')!
    const friendly = options.find((o) => o.key === 'friendly')!

    expect(witty.text).not.toBe(polite.text)
    expect(friendly.text).not.toBe(polite.text)
  })

  it('handles empty base draft gracefully with sensible fallbacks', () => {
    const options = generateCommentToneOptions({
      commentText: '안녕하세요',
      authorHandle: 'cust1',
      baseDraftText: '',
      businessName: '바이름',
    })

    expect(options).toHaveLength(3)
    for (const opt of options) {
      expect(opt.text.trim().length).toBeGreaterThan(5)
    }
  })
})
