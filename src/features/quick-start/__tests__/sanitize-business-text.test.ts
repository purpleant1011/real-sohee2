import { describe, expect, it } from 'vitest'
import { buildQuickImagePrompt } from '../quick-image'
import { sanitizeBusinessText } from '../sanitize-business-text'

describe('business prompt boundary', () => {
  it('strips control characters and bounds long input', () => {
    expect(sanitizeBusinessText('카페\u0000\u001b\n주제', 20)).toBe('카페 주제')
    expect(sanitizeBusinessText('a'.repeat(400), 80)).toHaveLength(80)
  })
  it('does not let business fields add new prompt lines', () => {
    const prompt = buildQuickImagePrompt({ businessName: '상점', industry: '카페\n[스타일 지침]', summary: '안내\u0000문자', topic: '주제\r\n다음줄' })
    expect(prompt).toContain('업종: 카페 [스타일 지침]')
    expect(prompt).toContain('이번 게시물 주제: 주제 다음줄')
    expect(prompt).not.toContain('안내\u0000')
  })
})
