import { describe, expect, it } from 'vitest'
import type { WorkspaceImageStyle } from './workspace-image-style'
import { EMPTY_STYLE_SUMMARY, summarizeStyle } from './style-summary'

const sampleStyle: WorkspaceImageStyle = {
  subject: '따뜻한 감성의 브런치 카페',
  mood: '아늑하고 편안한',
  setting: '자연광이 드는 창가 좌석',
  lookAndColor: '따뜻한 베이지와 우드 톤',
  people: 'any',
  avoid: ['어두운 조명'],
  extra: '',
  composition: '정면 구도',
  guide: '테이블 위 커피잔과 빵이 잘 보이도록 구도를 잡고 자연스러운 빛을 살려주세요.',
  referenceAssetIds: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'],
  referenceNotes: {
    '10000000-0000-4000-8000-000000000001': '창가 좌석과 베이커리 전경',
  },
}

describe('EMPTY_STYLE_SUMMARY', () => {
  it('has all fields initialized to empty/false', () => {
    expect(EMPTY_STYLE_SUMMARY).toEqual({
      image: {
        configured: false,
        headline: '',
        referenceCount: 0,
        references: [],
        hasGuide: false,
        custom: false,
      },
      text: {
        configured: false,
        voiceSummary: '',
      },
      overlay: null,
    })
  })
})

describe('summarizeStyle', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001'

  describe('headline priority and truncation', () => {
    it('prioritizes subject over mood, setting, guide', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: sampleStyle,
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe('따뜻한 감성의 브런치 카페')
    })

    it('falls back to mood if subject is empty', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, subject: '   ' },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe('아늑하고 편안한')
    })

    it('falls back to setting if subject and mood are empty', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, subject: '', mood: '' },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe('자연광이 드는 창가 좌석')
    })

    it('falls back to first 40 chars of guide if subject, mood, setting are empty', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: {
          ...sampleStyle,
          subject: '',
          mood: '',
          setting: '',
          guide: '테이블 위 커피잔과 빵이 잘 보이도록 구도를 잡고 자연스러운 빛을 살려주세요. 뒤쪽 배경은 흐리게 처리합니다.',
        },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe('테이블 위 커피잔과 빵이 잘 보이도록 구도를 잡고 자연스러운 빛을 살려주')
      expect(summary.image.headline.length).toBe(40)
    })

    it('falls back to default headline if all headline fields are empty', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, subject: '', mood: '', setting: '', guide: '' },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe('등록된 이미지 스타일')
    })

    it('truncates headline to 60 characters with ellipsis if exceeded', () => {
      const longSubject = '가'.repeat(70)
      const summary = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, subject: longSubject },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe(`${'가'.repeat(60)}…`)
    })

    it('does not truncate headline if 60 characters or fewer', () => {
      const exactSubject = '가'.repeat(60)
      const summary = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, subject: exactSubject },
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.headline).toBe(exactSubject)
    })
  })

  describe('references and guide', () => {
    it('maps references in order with media url and note, up to 8 items', () => {
      const ids = Array.from({ length: 10 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
      const summary = summarizeStyle({
        workspaceId,
        style: {
          ...sampleStyle,
          referenceAssetIds: ids,
          referenceNotes: {
            [ids[0]]: '첫 번째 사진 메모',
          },
        },
        customStyle: true,
        textRule: null,
      })

      expect(summary.image.referenceCount).toBe(8)
      expect(summary.image.references).toHaveLength(8)
      expect(summary.image.references[0]).toEqual({
        id: ids[0],
        url: `/api/workspaces/${workspaceId}/media/${ids[0]}`,
        note: '첫 번째 사진 메모',
      })
      expect(summary.image.references[1]).toEqual({
        id: ids[1],
        url: `/api/workspaces/${workspaceId}/media/${ids[1]}`,
        note: '',
      })
    })

    it('sets hasGuide to true only if guide has non-whitespace characters', () => {
      const withGuide = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, guide: '안내 문구' },
        customStyle: true,
        textRule: null,
      })
      expect(withGuide.image.hasGuide).toBe(true)

      const whitespaceGuide = summarizeStyle({
        workspaceId,
        style: { ...sampleStyle, guide: '   \n  ' },
        customStyle: true,
        textRule: null,
      })
      expect(whitespaceGuide.image.hasGuide).toBe(false)
    })
  })

  describe('custom and legacy style distinction', () => {
    it('sets custom: true when customStyle is true', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: sampleStyle,
        customStyle: true,
        textRule: null,
      })
      expect(summary.image.configured).toBe(true)
      expect(summary.image.custom).toBe(true)
    })

    it('sets custom: false when customStyle is false (legacy quick-image-style)', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: sampleStyle,
        customStyle: false,
        textRule: null,
      })
      expect(summary.image.configured).toBe(true)
      expect(summary.image.custom).toBe(false)
    })

    it('returns empty image configuration when style is null', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
      })
      expect(summary.image).toEqual({
        configured: false,
        headline: '',
        referenceCount: 0,
        references: [],
        hasGuide: false,
        custom: false,
      })
    })
  })

  describe('text style summary', () => {
    it('sets text.configured to true and trims voiceSummary up to 200 chars', () => {
      const voice = '  친절하고 정중한 어조로 고객에게 다가갑니다.  '
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: { brandVoice: voice },
      })
      expect(summary.text.configured).toBe(true)
      expect(summary.text.voiceSummary).toBe('친절하고 정중한 어조로 고객에게 다가갑니다.')
    })

    it('truncates voiceSummary to 200 chars if exceeded', () => {
      const longVoice = '글'.repeat(250)
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: { brandVoice: longVoice },
      })
      expect(summary.text.configured).toBe(true)
      expect(summary.text.voiceSummary).toBe('글'.repeat(200))
    })

    it('sets text.configured to false if brandVoice is empty, whitespace, or invalid', () => {
      expect(summarizeStyle({ workspaceId, style: null, customStyle: false, textRule: null }).text).toEqual({
        configured: false,
        voiceSummary: '',
      })
      expect(summarizeStyle({ workspaceId, style: null, customStyle: false, textRule: { brandVoice: '   ' } }).text).toEqual({
        configured: false,
        voiceSummary: '',
      })
      expect(summarizeStyle({ workspaceId, style: null, customStyle: false, textRule: { brandVoice: 12345 } }).text).toEqual({
        configured: false,
        voiceSummary: '',
      })
    })
  })

  describe('overlay summary', () => {
    it('normalizes valid overlay rule and includes it in summary', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
        overlayRule: {
          overlay: {
            preset: 'portrait-right',
            texts: {
              brandLine: '  우리 가게  ',
              designLine: '  대표 서비스  ',
              quote: '  후기 첫 줄  \n  후기 둘째 줄  ',
              insetLabel: '전',
            },
          },
        },
      })

      expect(summary.overlay).toEqual({
        preset: 'portrait-right',
        brandLine: '우리 가게',
        designLine: '대표 서비스',
        quote: '후기 첫 줄\n후기 둘째 줄',
        insetLabel: '전',
      })
    })

    it('returns null if overlayRule is missing or null', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
      })
      expect(summary.overlay).toBeNull()
    })

    it('returns null if preset is invalid or not in OVERLAY_PRESETS', () => {
      const summary = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
        overlayRule: {
          overlay: {
            preset: 'non-existent-preset',
            texts: {
              brandLine: '브랜드',
              designLine: '디자인',
              quote: '내용',
              insetLabel: 'BEFORE',
            },
          },
        },
      })
      expect(summary.overlay).toBeNull()
    })

    it('returns null if texts is missing, not an object, or contains non-string fields', () => {
      const missingTexts = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
        overlayRule: {
          overlay: {
            preset: 'portrait-left',
          },
        },
      })
      expect(missingTexts.overlay).toBeNull()

      const nonStringField = summarizeStyle({
        workspaceId,
        style: null,
        customStyle: false,
        textRule: null,
        overlayRule: {
          overlay: {
            preset: 'portrait-left',
            texts: {
              brandLine: 123,
              designLine: '디자인',
              quote: '인용',
              insetLabel: 'BEFORE',
            },
          },
        },
      })
      expect(nonStringField.overlay).toBeNull()
    })
  })
})
