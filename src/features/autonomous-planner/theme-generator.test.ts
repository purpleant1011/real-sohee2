import { describe, expect, it } from 'vitest'
import { generatePlannedContent, selectNextTheme } from './theme-generator'
import type { GroundedBusinessContext } from '@/features/channel-studio/types'

const mockContext: GroundedBusinessContext = {
  businessName: '바이름',
  industry: '뷰티/속눈썹',
  location: '인천 서구 청라',
  facts: [
    { label: '원장 이력', value: '25년 경력 1인 맞춤 케어', kind: 'text' as any },
    { label: '운영 철학', value: '하루 단 3분 예약제', kind: 'text' as any },
    { label: '대표 시술', value: '통통케라틴펌, 블랙틴팅펌', kind: 'text' as any },
  ],
  tone: { presetKey: null, brandVoice: '다정하고 친절한 어조' },
  knowledgeVersion: 1,
  warnings: [],
}

describe('theme-generator', () => {
  it('rotates themes smoothly avoiding recent themes', () => {
    const next1 = selectNextTheme([])
    expect(next1).toBe('story')

    const next2 = selectNextTheme(['story'])
    expect(next2).toBe('tip')

    const next3 = selectNextTheme(['story', 'tip'])
    expect(next3).toBe('consultation')

    const next4 = selectNextTheme(['story', 'tip', 'consultation'])
    expect(next4).toBe('community')

    const next5 = selectNextTheme(['story', 'tip', 'consultation', 'community'])
    expect(next5).toBe('story')
  })

  it('generates high quality Instagram caption and Threads text tailored to business facts and tone', () => {
    const planned = generatePlannedContent({
      theme: 'tip',
      context: mockContext,
      tone: 'friendly',
      scheduledSlot: '2026-10-20T19:00:00+09:00',
    })

    expect(planned.themeKey).toBe('tip')
    expect(planned.themeTitle).toContain('홈케어')
    expect(planned.instagramCaption).toContain('바이름')
    expect(planned.threadsText).toContain('바이름')
    expect(planned.threadsText.length).toBeLessThanOrEqual(500)
    expect(planned.hashtags).toContain('#바이름')
    expect(planned.hashtags).toContain('#청라뷰티')
  })

  it('does not inject beauty/eyebrow copy or beauty hashtags for non-Byreum and non-beauty business (e.g. cafe)', () => {
    const cafeContext: GroundedBusinessContext = {
      businessName: '성수 로스터리 카페',
      industry: '카페',
      location: '서울 성수동',
      facts: [
        { label: '대표 메뉴', value: '시그니처 아인슈페너, 핸드드립', kind: 'text' as any },
      ],
      tone: { presetKey: null, brandVoice: '친절하고 따뜻한 어조' },
      knowledgeVersion: 1,
      warnings: [],
    }

    const themes: readonly ('story' | 'tip' | 'consultation' | 'community')[] = [
      'story',
      'tip',
      'consultation',
      'community',
    ]

    for (const theme of themes) {
      const planned = generatePlannedContent({
        theme,
        context: cafeContext,
        tone: 'friendly',
        scheduledSlot: '2026-10-20T19:00:00+09:00',
      })

      // 업종/상호 확인
      expect(planned.instagramCaption).toContain('성수 로스터리 카페')
      expect(planned.threadsText).toContain('성수 로스터리 카페')

      // 뷰티/시술/눈썹/바이름 고정 단어 일체 미주입 검증
      expect(planned.instagramCaption).not.toContain('바이름')
      expect(planned.instagramCaption).not.toContain('청라')
      expect(planned.instagramCaption).not.toContain('시술')
      expect(planned.instagramCaption).not.toContain('눈썹')
      expect(planned.instagramCaption).not.toContain('뷰티')
      expect(planned.instagramCaption).not.toContain('컬링')
      expect(planned.instagramCaption).not.toContain('모근')
      expect(planned.instagramCaption).not.toContain('골격')
      expect(planned.instagramCaption).not.toContain('공장형')

      expect(planned.threadsText).not.toContain('바이름')
      expect(planned.threadsText).not.toContain('청라')
      expect(planned.threadsText).not.toContain('시술')
      expect(planned.threadsText).not.toContain('눈썹')
      expect(planned.threadsText).not.toContain('뷰티')
      expect(planned.threadsText).not.toContain('컬링')
      expect(planned.threadsText).not.toContain('골격')

      expect(planned.themeTitle).not.toContain('시술')
      expect(planned.themeTitle).not.toContain('눈썹')

      // 해시태그 검증: 청라뷰티/청라눈썹 등 미주입
      for (const tag of planned.hashtags) {
        expect(tag).not.toContain('뷰티')
        expect(tag).not.toContain('눈썹')
        expect(tag).not.toContain('청라')
      }
    }
  })

  it('omits location hashtags when location is missing or empty', () => {
    const noLocContext: GroundedBusinessContext = {
      businessName: '소프트웨어 연구소',
      industry: 'IT/소프트웨어',
      location: '',
      facts: [],
      tone: { presetKey: null, brandVoice: '담백한 어조' },
      knowledgeVersion: 1,
      warnings: [],
    }

    const planned = generatePlannedContent({
      theme: 'story',
      context: noLocContext,
      tone: 'friendly',
      scheduledSlot: '2026-10-20T19:00:00+09:00',
    })

    expect(planned.hashtags).not.toContain('#청라뷰티')
    expect(planned.hashtags).not.toContain('#청라눈썹')
    expect(planned.hashtags).not.toContain('#청라')
    expect(planned.hashtags).toContain('#소프트웨어연구소')
  })
})
